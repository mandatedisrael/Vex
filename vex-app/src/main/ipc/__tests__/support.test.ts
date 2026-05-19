/**
 * IPC contract tests for vex.support.createBugReport.
 *
 * Mirrors the register-handler test scaffolding: mock electron + logger +
 * cleanup + (here) the support service, then re-load the handler module.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

type Handler = (
  event: { senderFrame?: MockFrame },
  raw: unknown,
) => unknown;

interface MockFrame {
  readonly url: string;
  readonly parent: MockFrame | null;
  readonly top: MockFrame | null;
}

const handlers = new Map<string, Handler>();
const cleanupTasks = new Set<() => void | Promise<void>>();
const serviceMock = vi.fn();

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
    isPackaged: true,
  },
}));

vi.mock("../../logger/index.js", () => ({
  log: {
    error: vi.fn(),
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

vi.mock("../../support/bug-report-service.js", () => ({
  createBugReport: (input: unknown) => serviceMock(input),
}));

function senderFrame(url: string): { senderFrame: MockFrame } {
  const frame: MockFrame & { parent: MockFrame | null; top: MockFrame | null } = {
    url,
    parent: null,
    top: null,
  };
  frame.top = frame;
  return { senderFrame: frame };
}

const trustedSender = senderFrame("app://vex/index.html");

const validPayload = {
  reportKind: "manual" as const,
  source: "user" as const,
  category: "user_reported_bug",
  severity: "error" as const,
  title: "Something broke",
  description: "",
  context: {},
  refs: {},
};

async function loadAndRegister(): Promise<Handler> {
  vi.resetModules();
  const mod = await import("../support.js");
  mod.registerSupportHandler();
  const fn = handlers.get("vex:support:createBugReport");
  if (!fn) throw new Error("handler not registered");
  return fn;
}

// Real UUIDs because the output schema enforces `z.string().uuid()` — the
// envelope tolerates any non-empty requestId, but the success path's
// outputSchema validation runs on the handler's reply and will reject a
// non-UUID `reportId`.
const REQ_1 = "11111111-1111-4111-8111-111111111111";
const REQ_2 = "22222222-2222-4222-8222-222222222222";
const REQ_3 = "33333333-3333-4333-8333-333333333333";
const REQ_4 = "44444444-4444-4444-8444-444444444444";
const REPORT_UUID = "55555555-5555-4555-8555-555555555555";

describe("registerSupportHandler", () => {
  beforeEach(() => {
    handlers.clear();
    cleanupTasks.clear();
    serviceMock.mockReset();
  });

  it("returns ok with the service result on valid input", async () => {
    serviceMock.mockResolvedValueOnce({
      reportId: REPORT_UUID,
      recorded: true,
      uploadState: "not_configured",
    });
    const fn = await loadAndRegister();
    const result = await fn(trustedSender, {
      requestId: REQ_1,
      payload: validPayload,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        reportId: REPORT_UUID,
        recorded: true,
        uploadState: "not_configured",
      },
    });
    expect(serviceMock).toHaveBeenCalledTimes(1);
    const arg = serviceMock.mock.calls[0]?.[0] as { correlationIdFromIpc: string };
    expect(arg.correlationIdFromIpc).toBe(REQ_1);
  });

  it("rejects an invalid category at the schema boundary", async () => {
    const fn = await loadAndRegister();
    const result = (await fn(trustedSender, {
      requestId: REQ_2,
      payload: { ...validPayload, category: "Bug" },
    })) as { ok: false; error: { code: string; domain: string; correlationId: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_input");
    expect(result.error.domain).toBe("support");
    // registerHandler stamps a fresh fallback correlationId when the whole
    // envelope (incl. payload) fails to parse — `requestId` is not recovered
    // from a partially-valid envelope. Assert shape, not equality.
    expect(typeof result.error.correlationId).toBe("string");
    expect(result.error.correlationId.length).toBeGreaterThan(0);
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it("rejects an untrusted sender frame", async () => {
    const fn = await loadAndRegister();
    const result = (await fn(senderFrame("https://evil.example/"), {
      requestId: REQ_3,
      payload: validPayload,
    })) as { ok: false; error: { code: string; domain: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_sender");
    expect(result.error.domain).toBe("support");
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it("maps a thrown service error to support.persist_failed", async () => {
    serviceMock.mockRejectedValueOnce(new Error("db down"));
    const fn = await loadAndRegister();
    const result = (await fn(trustedSender, {
      requestId: REQ_4,
      payload: validPayload,
    })) as { ok: false; error: { code: string; domain: string; correlationId: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("support.persist_failed");
    expect(result.error.domain).toBe("support");
    expect(result.error.correlationId).toBe(REQ_4);
  });
});
