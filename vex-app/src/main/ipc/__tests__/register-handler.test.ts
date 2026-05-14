/**
 * Unit tests for the IPC handler harness — covering the 5 critical paths
 * codex called out: invalid sender, invalid input, valid success, invalid
 * output shape, and thrown handler with redaction.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

// Capture handlers registered by registerHandler so tests can invoke them
// directly with a stubbed IpcMainInvokeEvent.
type Handler = (
  event: { senderFrame?: MockFrame },
  raw: unknown
) => unknown;

interface MockFrame {
  readonly url: string;
  readonly parent: MockFrame | null;
  readonly top: MockFrame | null;
}

const handlers = new Map<string, Handler>();
const errorMock = vi.fn();
const cleanupTasks = new Set<() => void | Promise<void>>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  app: {
    isPackaged: true, // simulate prod — only app://vex/ origin is trusted
  },
}));

vi.mock("../../logger/index.js", () => ({
  log: {
    error: (...args: unknown[]) => errorMock(...args),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
  },
}));

vi.mock("../../lifecycle/cleanup-registry.js", () => ({
  globalCleanup: {
    add: (task: () => void | Promise<void>) => {
      cleanupTasks.add(task);
      return async () => {
        cleanupTasks.delete(task);
        await task();
      };
    },
  },
}));

async function load() {
  vi.resetModules();
  const mod = await import("../register-handler.js");
  return mod.registerHandler;
}

function senderFrame(url: string): { senderFrame: MockFrame } {
  const frame: { url: string; parent: MockFrame | null; top: MockFrame | null } = {
    url,
    parent: null,
    top: null,
  };
  frame.top = frame;
  return { senderFrame: frame };
}

function childSenderFrame(url: string): { senderFrame: MockFrame } {
  const top = senderFrame(url).senderFrame;
  return {
    senderFrame: {
      url,
      parent: top,
      top,
    },
  };
}

const trustedSender = senderFrame("app://vex/index.html");

describe("registerHandler", () => {
  beforeEach(() => {
    handlers.clear();
    cleanupTasks.clear();
    errorMock.mockReset();
  });

  afterEach(() => {
    handlers.clear();
    cleanupTasks.clear();
  });

  it("returns ok on valid input + valid output", async () => {
    const registerHandler = await load();
    registerHandler({
      channel: "vex:test:ok",
      domain: "system",
      inputSchema: z.object({ name: z.string() }).strict(),
      outputSchema: z.object({ greeting: z.string() }).strict(),
      handle: async ({ name }) => ({
        ok: true as const,
        data: { greeting: `hi ${name}` },
      }),
    });
    const fn = handlers.get("vex:test:ok")!;
    const result = await fn(trustedSender, {
      requestId: "req-1",
      payload: { name: "world" },
    });
    expect(result).toEqual({ ok: true, data: { greeting: "hi world" } });
  });

  it("rejects untrusted sender with redacted error", async () => {
    const registerHandler = await load();
    registerHandler({
      channel: "vex:test:sender",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () => ({ ok: true as const, data: undefined }),
    });
    const fn = handlers.get("vex:test:sender")!;
    const result: any = await fn(
      senderFrame("https://evil.com/"),
      { requestId: "r", payload: {} }
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_sender");
    expect(result.error.redacted).toBe(true);
    // Sender URL must NOT appear in the public error payload.
    expect(JSON.stringify(result.error)).not.toContain("evil.com");
    expect(errorMock).toHaveBeenCalled();
  });

  it("rejects trusted-origin subframes", async () => {
    const registerHandler = await load();
    registerHandler({
      channel: "vex:test:subframe",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () => ({ ok: true as const, data: undefined }),
    });
    const fn = handlers.get("vex:test:subframe")!;
    const result: any = await fn(childSenderFrame("app://vex/index.html"), {
      requestId: "r",
      payload: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_sender");
    expect(result.error.redacted).toBe(true);
  });

  it("rejects invalid input shape with redacted error", async () => {
    const registerHandler = await load();
    registerHandler({
      channel: "vex:test:input",
      domain: "system",
      inputSchema: z.object({ name: z.string() }).strict(),
      handle: async () => ({ ok: true as const, data: { greeting: "x" } }),
    });
    const fn = handlers.get("vex:test:input")!;
    const result: any = await fn(trustedSender, {
      requestId: "r",
      payload: { name: 123 },
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_input");
    expect(result.error.redacted).toBe(true);
  });

  it("flags handlers that produce wrong-shape Result.data", async () => {
    const registerHandler = await load();
    registerHandler({
      channel: "vex:test:output",
      domain: "system",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ greeting: z.string() }).strict(),
      // Handler lies and returns wrong shape.
      handle: async () =>
        ({ ok: true, data: { wrong: "field" } }) as unknown as {
          ok: true;
          data: { greeting: string };
        },
    });
    const fn = handlers.get("vex:test:output")!;
    const result: any = await fn(trustedSender, {
      requestId: "r",
      payload: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("internal.contract_violation");
    expect(result.error.redacted).toBe(true);
  });

  it("catches handler throws and returns redacted error (does NOT leak message)", async () => {
    const registerHandler = await load();
    const evmKey = "0x" + "a".repeat(64);
    registerHandler({
      channel: "vex:test:throw",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () => {
        throw new Error(`boom — leaked secret ${evmKey}`);
      },
    });
    const fn = handlers.get("vex:test:throw")!;
    const result: any = await fn(trustedSender, {
      requestId: "r",
      payload: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("internal.contract_violation");
    // Public error must NOT contain the raw message.
    expect(JSON.stringify(result.error)).not.toContain(evmKey);
    expect(JSON.stringify(result.error)).not.toContain("boom");
    // The error WAS logged main-side (with redaction).
    expect(errorMock).toHaveBeenCalled();
    const loggedArgs = errorMock.mock.calls.flat();
    const flat = JSON.stringify(loggedArgs);
    // Logged message must not contain the raw EVM key (redactor scrubs it).
    expect(flat).not.toContain(evmKey);
  });

  it("preserves correlationId from request envelope into error response", async () => {
    const registerHandler = await load();
    registerHandler({
      channel: "vex:test:corr",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () => {
        throw new Error("anything");
      },
    });
    const fn = handlers.get("vex:test:corr")!;
    const result: any = await fn(trustedSender, {
      requestId: "req-correlation-42",
      payload: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error.correlationId).toBe("req-correlation-42");
  });

  it("falls back to a generated UUID when the envelope is unparseable", async () => {
    const registerHandler = await load();
    registerHandler({
      channel: "vex:test:fallback",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () => ({ ok: true as const, data: undefined }),
    });
    const fn = handlers.get("vex:test:fallback")!;
    // No `requestId` field — envelope parse fails.
    const result: any = await fn(trustedSender, { not_an_envelope: true });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_input");
    expect(typeof result.error.correlationId).toBe("string");
    // Fallback must be a non-trivial id, never the legacy "<unknown>" sentinel.
    expect(result.error.correlationId).not.toBe("<unknown>");
    expect(result.error.correlationId.length).toBeGreaterThanOrEqual(8);
  });

  it("normalizes malformed handler errors to contract_violation (foreign keys stripped)", async () => {
    const registerHandler = await load();
    const leakedSecret = "0x" + "f".repeat(64);
    registerHandler({
      channel: "vex:test:malformed",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () =>
        ({
          ok: false,
          // Foreign key `leak` + missing `redacted: true` — must be rejected.
          error: {
            code: "internal.unexpected",
            domain: "system",
            message: "looks valid",
            retryable: false,
            userActionable: false,
            redacted: true,
            leak: leakedSecret,
          },
        }) as never,
    });
    const fn = handlers.get("vex:test:malformed")!;
    const result: any = await fn(trustedSender, {
      requestId: "req-malformed",
      payload: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("internal.contract_violation");
    expect(result.error.correlationId).toBe("req-malformed");
    // Public payload must NEVER carry the leaked field.
    expect(JSON.stringify(result.error)).not.toContain(leakedSecret);
    expect(JSON.stringify(result.error)).not.toContain("leak");
  });

  it("auto-fills missing correlationId on valid handler errors", async () => {
    const registerHandler = await load();
    registerHandler({
      channel: "vex:test:autofill",
      domain: "wallet",
      inputSchema: z.object({}).strict(),
      handle: async () =>
        ({
          ok: false,
          error: {
            code: "wallet.password_invalid",
            domain: "wallet",
            message: "wrong",
            retryable: true,
            userActionable: true,
            redacted: true,
            // No correlationId — handler omitted it. Framework must fill.
          },
        }) as never,
    });
    const fn = handlers.get("vex:test:autofill")!;
    const result: any = await fn(trustedSender, {
      requestId: "req-autofill-99",
      payload: {},
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.password_invalid");
    expect(result.error.correlationId).toBe("req-autofill-99");
  });

  it("logs structural diagnosis only on handler throw (no raw error object)", async () => {
    const registerHandler = await load();
    const secret = "0x" + "b".repeat(64);
    registerHandler({
      channel: "vex:test:structural-log",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () => {
        // Throw an object with a custom field that would carry a secret if
        // the logger ever echoed the raw thrown value.
        const fake: unknown = { customSecret: secret };
        throw fake;
      },
    });
    const fn = handlers.get("vex:test:structural-log")!;
    await fn(trustedSender, { requestId: "req-log", payload: {} });
    expect(errorMock).toHaveBeenCalled();
    const flat = JSON.stringify(errorMock.mock.calls);
    // Critical: the raw secret value must never appear in the log call args.
    expect(flat).not.toContain(secret);
    // The structural summary should mention the type/keys, not the value.
    expect(flat).toContain("type=object");
    expect(flat).toContain("keys=customSecret");
  });

  it("registers an idempotent unregister via globalCleanup on app quit", async () => {
    const registerHandler = await load();
    const unregister = registerHandler({
      channel: "vex:test:cleanup",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () => ({ ok: true as const, data: undefined }),
    });
    expect(handlers.has("vex:test:cleanup")).toBe(true);
    expect(cleanupTasks.size).toBe(1);

    // Manual unregister removes from ipcMain and from globalCleanup.
    unregister();
    expect(handlers.has("vex:test:cleanup")).toBe(false);
    // Idempotent: calling unregister again is a no-op.
    unregister();
    expect(handlers.has("vex:test:cleanup")).toBe(false);
  });

  it("globalCleanup task removes the handler on app quit (without explicit unregister)", async () => {
    const registerHandler = await load();
    registerHandler({
      channel: "vex:test:auto-quit",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () => ({ ok: true as const, data: undefined }),
    });
    expect(handlers.has("vex:test:auto-quit")).toBe(true);
    expect(cleanupTasks.size).toBe(1);

    // Simulate app quit firing the cleanup task.
    const task = [...cleanupTasks][0];
    await task!();
    expect(handlers.has("vex:test:auto-quit")).toBe(false);
  });

  it("rejects error shape with unknown VexErrorCode (closed-by-convention enum)", async () => {
    const registerHandler = await load();
    registerHandler({
      channel: "vex:test:bad-code",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () =>
        ({
          ok: false,
          error: {
            code: "wallet.totally_fabricated_code",
            domain: "system",
            message: "x",
            retryable: false,
            userActionable: false,
            redacted: true,
          },
        }) as never,
    });
    const fn = handlers.get("vex:test:bad-code")!;
    const result: any = await fn(trustedSender, {
      requestId: "req-bad-code",
      payload: {},
    });
    expect(result.error.code).toBe("internal.contract_violation");
    expect(result.error.correlationId).toBe("req-bad-code");
  });

  it("rejects error shape with negative retryAfterMs", async () => {
    const registerHandler = await load();
    registerHandler({
      channel: "vex:test:bad-retry",
      domain: "wallet",
      inputSchema: z.object({}).strict(),
      handle: async () =>
        ({
          ok: false,
          error: {
            code: "wallet.export_throttled",
            domain: "wallet",
            message: "slow down",
            retryable: true,
            userActionable: true,
            redacted: true,
            retryAfterMs: -100,
          },
        }) as never,
    });
    const fn = handlers.get("vex:test:bad-retry")!;
    const result: any = await fn(trustedSender, {
      requestId: "req-bad-retry",
      payload: {},
    });
    expect(result.error.code).toBe("internal.contract_violation");
  });

  it("logs a contract-bug warning when handler attaches mismatched correlationId", async () => {
    const warnMock = vi.fn();
    vi.resetModules();
    vi.doMock("../../logger/index.js", () => ({
      log: {
        error: errorMock,
        warn: warnMock,
        info: vi.fn(),
        debug: vi.fn(),
        verbose: vi.fn(),
        silly: vi.fn(),
      },
    }));
    const { registerHandler } = await import("../register-handler.js");
    registerHandler({
      channel: "vex:test:mismatch",
      domain: "wallet",
      inputSchema: z.object({}).strict(),
      handle: async () =>
        ({
          ok: false,
          error: {
            code: "wallet.password_invalid",
            domain: "wallet",
            message: "wrong",
            retryable: true,
            userActionable: true,
            redacted: true,
            correlationId: "stale-id-from-helper",
          },
        }) as never,
    });
    const fn = handlers.get("vex:test:mismatch")!;
    const result: any = await fn(trustedSender, {
      requestId: "req-actual",
      payload: {},
    });
    // Response carries the actual request id (overridden).
    expect(result.error.correlationId).toBe("req-actual");
    // Mismatch is flagged structurally.
    expect(warnMock).toHaveBeenCalled();
    const flat = JSON.stringify(warnMock.mock.calls);
    expect(flat).toContain("mismatched correlationId=stale-id-from-helper");
    vi.doUnmock("../../logger/index.js");
  });
});
