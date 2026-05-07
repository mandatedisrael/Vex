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
  event: { senderFrame?: { url?: string } },
  raw: unknown
) => unknown;

const handlers = new Map<string, Handler>();
const errorMock = vi.fn();

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

async function load() {
  vi.resetModules();
  const mod = await import("../register-handler.js");
  return mod.registerHandler;
}

const trustedSender = { senderFrame: { url: "app://vex/index.html" } };

describe("registerHandler", () => {
  beforeEach(() => {
    handlers.clear();
    errorMock.mockReset();
  });

  afterEach(() => {
    handlers.clear();
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
      { senderFrame: { url: "https://evil.com/" } },
      { requestId: "r", payload: {} }
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_sender");
    expect(result.error.redacted).toBe(true);
    // Sender URL must NOT appear in the public error payload.
    expect(JSON.stringify(result.error)).not.toContain("evil.com");
    expect(errorMock).toHaveBeenCalled();
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
});
