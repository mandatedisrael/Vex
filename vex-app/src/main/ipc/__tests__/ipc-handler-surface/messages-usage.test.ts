/**
 * IPC handler surface smoke tests — sender validation, payload validation,
 * read-only success paths, and mutation handler registration. One file
 * bundles the broad surface to keep CI run-time tight.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestWebContents,
  createTrustedSender,
  type TestIpcEvent,
} from "../test-sender.js";

type Handler = (
  event: TestIpcEvent,
  raw: unknown,
) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());
const mocks = vi.hoisted(() => ({
  // messages-db
  getMessageTail: vi.fn(),
  getMessageAround: vi.fn(),
  listMessages: vi.fn(),
  // usage-db
  getSessionTotals: vi.fn(),
  getLastTurn: vi.fn(),
  getContextWindow: vi.fn(),
  // compaction-db
  getCompactionStatus: vi.fn(),
  listCompactionHistory: vi.fn(),
  // knowledge-db
  listKnowledge: vi.fn(),
  // memory-db
  listSessionMemories: vi.fn(),
  getMemoryStats: vi.fn(),
  // mission-runs-db
  getActiveRunForSession: vi.fn(),
  // approvals-db
  listPendingForSession: vi.fn(),
  getApprovalById: vi.fn(),
  getHistoryForSession: vi.fn(),
  // missions-db
  getDraftForSession: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
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

vi.mock("../../../database/messages-db.js", () => ({
  getMessageTail: mocks.getMessageTail,
  getMessageAround: mocks.getMessageAround,
  listMessages: mocks.listMessages,
}));

vi.mock("../../../database/usage-db.js", () => ({
  getSessionTotals: mocks.getSessionTotals,
  getLastTurn: mocks.getLastTurn,
  getContextWindow: mocks.getContextWindow,
}));

vi.mock("../../../database/compaction-db.js", () => ({
  getCompactionStatus: mocks.getCompactionStatus,
  listCompactionHistory: mocks.listCompactionHistory,
  getRetryableCompactJob: vi.fn(),
  probeCompactJobsReady: vi.fn(),
}));

vi.mock("../../../database/knowledge-db.js", () => ({
  listKnowledge: mocks.listKnowledge,
}));

vi.mock("../../../database/memory-db.js", () => ({
  listSessionMemories: mocks.listSessionMemories,
  getMemoryStats: mocks.getMemoryStats,
}));

vi.mock("../../../database/mission-runs-db.js", () => ({
  getActiveRunForSession: mocks.getActiveRunForSession,
}));

vi.mock("../../../database/approvals-db.js", () => ({
  listPendingForSession: mocks.listPendingForSession,
  getApprovalById: mocks.getApprovalById,
  getHistoryForSession: mocks.getHistoryForSession,
}));

vi.mock("../../../database/missions-db.js", () => ({
  getDraftForSession: mocks.getDraftForSession,
}));

vi.mock("../../../logger/index.js", () => ({ log: mocks.log }));

const { registerMessagesHandlers } = await import("../../messages.js");
const { registerUsageHandlers } = await import("../../usage.js");
const { registerCompactionHandlers } = await import("../../compaction.js");
const { registerKnowledgeHandlers } = await import("../../knowledge.js");
const { registerMemoryHandlers } = await import("../../memory.js");
const { registerRuntimeHandlers } = await import("../../runtime.js");
const { registerMissionHandlers } = await import("../../mission.js");
const { registerApprovalsHandlers } = await import("../../approvals.js");
const { registerWalletsSessionHandlers } = await import("../../wallets-session.js");
const { registerModelsHandlers } = await import("../../models.js");
const { registerSessionsGetModelHandler } = await import("../../sessions/get-model.js");
const { CH } = await import("@shared/ipc/channels.js");

const trustedSender = createTrustedSender({ sender: createTestWebContents() });
const SESSION = "00000000-0000-4000-8000-00000000fff1";

function untrustedSender(): TestIpcEvent {
  return {
    senderFrame: {
      url: "https://evil.example",
      parent: null,
      top: null as never,
    },
    sender: createTestWebContents(),
  };
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  registerMessagesHandlers();
  registerUsageHandlers();
  registerCompactionHandlers();
  registerKnowledgeHandlers();
  registerMemoryHandlers();
  registerRuntimeHandlers();
  registerMissionHandlers();
  registerApprovalsHandlers();
  registerWalletsSessionHandlers();
  registerModelsHandlers();
  registerSessionsGetModelHandler();
});

afterEach(() => {
  handlers.clear();
  delete process.env.AGENT_PROVIDER;
  delete process.env.AGENT_MODEL;
  delete process.env.AGENT_CONTEXT_LIMIT;
});

type ResultShape = { ok: boolean; data?: unknown; error?: { code: string; domain: string } };

async function call(channel: string, payload: unknown): Promise<ResultShape> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`Handler not registered: ${channel}`);
  return (await fn(trustedSender, { requestId: "test-corr", payload })) as ResultShape;
}

async function callUntrusted(channel: string, payload: unknown): Promise<ResultShape> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`Handler not registered: ${channel}`);
  return (await fn(untrustedSender(), {
    requestId: "test-corr",
    payload,
  })) as ResultShape;
}

describe("messages handlers", () => {
  it("getTail returns mapped page from db helper", async () => {
    mocks.getMessageTail.mockResolvedValueOnce({
      ok: true,
      data: { items: [], nextCursor: null, hasMore: false },
    });
    const result = await call(CH.messages.getTail, {
      sessionId: SESSION,
      limit: 5,
    });
    expect(result.ok).toBe(true);
    expect(mocks.getMessageTail).toHaveBeenCalledWith(SESSION, 5);
  });

  it("getTail rejects invalid payload (non-uuid sessionId)", async () => {
    const result = await call(CH.messages.getTail, {
      sessionId: "not-a-uuid",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
  });

  it("getTail rejects untrusted sender frame URL", async () => {
    const result = await callUntrusted(CH.messages.getTail, {
      sessionId: SESSION,
      limit: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_sender");
  });

  it("list passes cursor + limit to db helper", async () => {
    mocks.listMessages.mockResolvedValueOnce({
      ok: true,
      data: { items: [], nextCursor: null, hasMore: false },
    });
    await call(CH.messages.list, {
      sessionId: SESSION,
      cursor: { createdAt: "2026-05-21T10:00:00.000Z", id: 5 },
      limit: 25,
    });
    expect(mocks.listMessages).toHaveBeenCalledWith(
      SESSION,
      { createdAt: "2026-05-21T10:00:00.000Z", id: 5 },
      25,
    );
  });
});

describe("usage handlers", () => {
  it("getSessionTotals returns mapped totals", async () => {
    mocks.getSessionTotals.mockResolvedValueOnce({
      ok: true,
      data: {
        sessionId: SESSION,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCost: null,
        currency: "USD",
        requestCount: 0,
        lastRequestAt: null,
      },
    });
    const result = await call(CH.usage.getSessionTotals, {
      sessionId: SESSION,
      currency: "USD",
    });
    expect(result.ok).toBe(true);
  });

  it("getLastTurn rejects payload without sessionId", async () => {
    const result = await call(CH.usage.getLastTurn, { currency: "USD" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
  });

  it("getContextWindow passes the resolved env limit to the db helper", async () => {
    process.env.AGENT_CONTEXT_LIMIT = "200000";
    mocks.getContextWindow.mockResolvedValueOnce({
      ok: true,
      data: { sessionId: SESSION, tokensUsed: 1234, contextLimit: 200000 },
    });
    const result = await call(CH.usage.getContextWindow, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect(mocks.getContextWindow).toHaveBeenCalledWith(SESSION, 200000);
  });

  it("getContextWindow passes a null limit when AGENT_CONTEXT_LIMIT is invalid (no faked default)", async () => {
    process.env.AGENT_CONTEXT_LIMIT = "not-a-number";
    mocks.getContextWindow.mockResolvedValueOnce({ ok: true, data: null });
    const result = await call(CH.usage.getContextWindow, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect(mocks.getContextWindow).toHaveBeenCalledWith(SESSION, null);
  });

  it("getContextWindow returns a null result for a missing/deleted session", async () => {
    mocks.getContextWindow.mockResolvedValueOnce({ ok: true, data: null });
    const result = await call(CH.usage.getContextWindow, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });

  it("getContextWindow rejects a non-uuid sessionId", async () => {
    const result = await call(CH.usage.getContextWindow, { sessionId: "nope" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
  });
});
