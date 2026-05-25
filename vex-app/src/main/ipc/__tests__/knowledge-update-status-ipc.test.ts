/**
 * Focused contract test for `knowledge.updateStatus` (stage 7-2b).
 *
 * Mocks `ensureEngineDbUrl` (ok) + the engine knowledge repo `updateStatus`
 * so we can assert the Result mapping without a live DB:
 *   ok            → { id, status }
 *   not_found     → knowledge.not_found
 *   not_active    → knowledge.invalid_state
 *   repo/import throw → internal.unexpected (knowledge), NOT contract_violation
 *   bad input     → validation.invalid_input (before the engine is touched)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestWebContents,
  createTrustedSender,
  type TestIpcEvent,
} from "./test-sender.js";

type Handler = (event: TestIpcEvent, raw: unknown) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());
const mocks = vi.hoisted(() => ({
  ensureEngineDbUrl: vi.fn(),
  updateStatus: vi.fn(),
  listKnowledge: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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

vi.mock("../runtime/_ensure-engine-db-url.js", () => ({
  ensureEngineDbUrl: mocks.ensureEngineDbUrl,
}));
vi.mock("@vex-agent/db/repos/knowledge.js", () => ({
  updateStatus: mocks.updateStatus,
}));
vi.mock("../../database/knowledge-db.js", () => ({
  listKnowledge: mocks.listKnowledge,
}));
vi.mock("../../logger/index.js", () => ({ log: mocks.log }));

const { registerKnowledgeHandlers } = await import("../knowledge.js");
const { CH } = await import("@shared/ipc/channels.js");

const trustedSender = createTrustedSender({ sender: createTestWebContents() });

type ResultShape = {
  ok: boolean;
  data?: unknown;
  error?: { code: string; domain: string };
};

async function call(channel: string, payload: unknown): Promise<ResultShape> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`Handler not registered: ${channel}`);
  return (await fn(trustedSender, {
    requestId: "test-corr",
    payload,
  })) as ResultShape;
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  mocks.ensureEngineDbUrl.mockResolvedValue({ ok: true, data: undefined });
  registerKnowledgeHandlers();
});

afterEach(() => {
  handlers.clear();
});

describe("knowledge.updateStatus handler", () => {
  it("maps ok → { id, status }; no reason → forwards undefined", async () => {
    mocks.updateStatus.mockResolvedValueOnce({ ok: true });
    const r = await call(CH.knowledge.updateStatus, { id: 5, status: "archived" });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ id: 5, status: "archived" });
    expect(mocks.updateStatus).toHaveBeenCalledWith(5, "archived", undefined);
  });

  it("forwards a provided reason to the repo but never logs it", async () => {
    mocks.updateStatus.mockResolvedValueOnce({ ok: true });
    const r = await call(CH.knowledge.updateStatus, {
      id: 3,
      status: "invalidated",
      reason: "duplicate-of-7",
    });
    expect(r.ok).toBe(true);
    expect(mocks.updateStatus).toHaveBeenCalledWith(
      3,
      "invalidated",
      "duplicate-of-7",
    );
    // reason is free-text — it must not appear in any audit log line.
    const logged = mocks.log.info.mock.calls.flat().join(" ");
    expect(logged).not.toContain("duplicate-of-7");
  });

  it("maps not_found → knowledge.not_found", async () => {
    mocks.updateStatus.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    const r = await call(CH.knowledge.updateStatus, {
      id: 9,
      status: "invalidated",
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("knowledge.not_found");
    expect(r.error?.domain).toBe("knowledge");
  });

  it("maps not_active → knowledge.invalid_state", async () => {
    mocks.updateStatus.mockResolvedValueOnce({
      ok: false,
      reason: "not_active",
      currentStatus: "archived",
    });
    const r = await call(CH.knowledge.updateStatus, { id: 9, status: "archived" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("knowledge.invalid_state");
    expect(r.error?.domain).toBe("knowledge");
  });

  it("maps a repo/import throw → internal.unexpected (knowledge), not contract_violation", async () => {
    mocks.updateStatus.mockRejectedValueOnce(new Error("db down"));
    const r = await call(CH.knowledge.updateStatus, { id: 9, status: "archived" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("internal.unexpected");
    expect(r.error?.domain).toBe("knowledge");
  });

  it("returns the db-url error when the engine DB is unavailable (no repo call)", async () => {
    mocks.ensureEngineDbUrl.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "internal.unexpected",
        domain: "data",
        message: "db unavailable",
        retryable: true,
        userActionable: true,
        redacted: true,
        correlationId: "c",
      },
    });
    const r = await call(CH.knowledge.updateStatus, { id: 9, status: "archived" });
    expect(r.ok).toBe(false);
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it("rejects bad input before touching the engine", async () => {
    const r = await call(CH.knowledge.updateStatus, { id: 0, status: "archived" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("validation.invalid_input");
    expect(mocks.ensureEngineDbUrl).not.toHaveBeenCalled();
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it("rejects a non-updatable status (active) before touching the engine", async () => {
    const r = await call(CH.knowledge.updateStatus, { id: 1, status: "active" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("validation.invalid_input");
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });
});
