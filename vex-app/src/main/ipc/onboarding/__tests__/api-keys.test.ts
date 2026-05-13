/**
 * vex.onboarding.apiKeysSet IPC handler smoke tests (M9).
 *
 * Verifies trusted-sender flow + Zod parse + writer call + Result
 * envelope + secret-not-logged assertion. Mocks the writer so we
 * don't touch the filesystem.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (
  event: { senderFrame?: { url?: string }; sender?: unknown },
  raw: unknown,
) => Promise<unknown>;

const handlers = new Map<string, Handler>();
const logInfo = vi.fn();
const mockWriter = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  app: { isPackaged: true },
}));

vi.mock("../../../onboarding/api-keys-writer.js", () => ({
  writeApiKeys: (input: unknown) => mockWriter(input),
}));

vi.mock("../../../onboarding/env-write-mutex.js", () => ({
  withEnvWriteLock: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("../../../logger/index.js", () => ({
  log: { info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerApiKeysHandler } = await import("../api-keys.js");
const { CH } = await import("@shared/ipc/channels.js");

const trustedSender = {
  senderFrame: { url: "app://vex/index.html" },
  sender: { send: vi.fn(), isDestroyed: () => false },
};

beforeEach(() => {
  handlers.clear();
  mockWriter.mockReset();
  logInfo.mockReset();
});

afterEach(() => {
  handlers.clear();
  vi.clearAllMocks();
});

describe("apiKeysSet handler", () => {
  it("calls writer with parsed input, returns ok envelope", async () => {
    mockWriter.mockResolvedValue({
      ok: true,
      data: { fieldsWritten: ["JUPITER_API_KEY"] },
    });
    registerApiKeysHandler();
    const fn = handlers.get(CH.onboarding.apiKeysSet)!;
    const result = (await fn(trustedSender, {
      requestId: "r1",
      payload: { jupiterApiKey: "sk-jup" },
    })) as { ok: boolean; data?: { fieldsWritten: string[] } };
    expect(result.ok).toBe(true);
    expect(result.data?.fieldsWritten).toEqual(["JUPITER_API_KEY"]);
    expect(mockWriter).toHaveBeenCalledWith({ jupiterApiKey: "sk-jup" });
  });

  it("propagates writer err unchanged", async () => {
    mockWriter.mockResolvedValue({
      ok: false,
      error: {
        code: "onboarding.env_persist_failed",
        domain: "onboarding",
        message: "disk full",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });
    registerApiKeysHandler();
    const fn = handlers.get(CH.onboarding.apiKeysSet)!;
    const result = (await fn(trustedSender, {
      requestId: "r2",
      payload: {},
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("onboarding.env_persist_failed");
  });

  it("rejects payload carrying an unknown API key at the schema boundary", async () => {
    registerApiKeysHandler();
    const fn = handlers.get(CH.onboarding.apiKeysSet)!;
    const result = (await fn(trustedSender, {
      requestId: "r3",
      payload: { legacyApiKey: "should-fail" },
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
    expect(mockWriter).not.toHaveBeenCalled();
  });

  it("rejects polymarket trio when only 1-2 fields supplied (Zod strict)", async () => {
    registerApiKeysHandler();
    const fn = handlers.get(CH.onboarding.apiKeysSet)!;
    const result = (await fn(trustedSender, {
      requestId: "r4",
      payload: { polymarket: { apiKey: "k" } },
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
    expect(mockWriter).not.toHaveBeenCalled();
  });

  it("does NOT log the secret values — only canonical key names + correlationId", async () => {
    mockWriter.mockResolvedValue({
      ok: true,
      data: { fieldsWritten: ["JUPITER_API_KEY", "TAVILY_API_KEY"] },
    });
    registerApiKeysHandler();
    const fn = handlers.get(CH.onboarding.apiKeysSet)!;
    await fn(trustedSender, {
      requestId: "corr-xyz",
      payload: { jupiterApiKey: "SECRET_VALUE_1", tavilyApiKey: "SECRET_VALUE_2" },
    });
    const allLogStrings = logInfo.mock.calls.flat().map(String).join(" | ");
    expect(allLogStrings).toContain("JUPITER_API_KEY");
    expect(allLogStrings).toContain("TAVILY_API_KEY");
    expect(allLogStrings).toContain("corr-xyz");
    expect(allLogStrings).not.toContain("SECRET_VALUE_1");
    expect(allLogStrings).not.toContain("SECRET_VALUE_2");
  });
});
