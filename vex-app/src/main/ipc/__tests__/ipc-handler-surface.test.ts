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
} from "./test-sender.js";

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

vi.mock("../../database/messages-db.js", () => ({
  getMessageTail: mocks.getMessageTail,
  getMessageAround: mocks.getMessageAround,
  listMessages: mocks.listMessages,
}));

vi.mock("../../database/usage-db.js", () => ({
  getSessionTotals: mocks.getSessionTotals,
  getLastTurn: mocks.getLastTurn,
  getContextWindow: mocks.getContextWindow,
}));

vi.mock("../../database/compaction-db.js", () => ({
  getCompactionStatus: mocks.getCompactionStatus,
  listCompactionHistory: mocks.listCompactionHistory,
  probeCompactJobsReady: vi.fn(),
}));

vi.mock("../../database/knowledge-db.js", () => ({
  listKnowledge: mocks.listKnowledge,
}));

vi.mock("../../database/memory-db.js", () => ({
  listSessionMemories: mocks.listSessionMemories,
  getMemoryStats: mocks.getMemoryStats,
}));

vi.mock("../../database/mission-runs-db.js", () => ({
  getActiveRunForSession: mocks.getActiveRunForSession,
}));

vi.mock("../../database/approvals-db.js", () => ({
  listPendingForSession: mocks.listPendingForSession,
  getApprovalById: mocks.getApprovalById,
  getHistoryForSession: mocks.getHistoryForSession,
}));

vi.mock("../../database/missions-db.js", () => ({
  getDraftForSession: mocks.getDraftForSession,
}));

vi.mock("../../logger/index.js", () => ({ log: mocks.log }));

const { registerMessagesHandlers } = await import("../messages.js");
const { registerUsageHandlers } = await import("../usage.js");
const { registerCompactionHandlers } = await import("../compaction.js");
const { registerKnowledgeHandlers } = await import("../knowledge.js");
const { registerMemoryHandlers } = await import("../memory.js");
const { registerRuntimeHandlers } = await import("../runtime.js");
const { registerMissionHandlers } = await import("../mission.js");
const { registerApprovalsHandlers } = await import("../approvals.js");
const { registerWalletsSessionHandlers } = await import("../wallets-session.js");
const { registerModelsHandlers } = await import("../models.js");
const { registerSessionsGetModelHandler } = await import("../sessions/get-model.js");
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

describe("compaction handler", () => {
  it("getStatus returns the mapped status DTO", async () => {
    mocks.getCompactionStatus.mockResolvedValueOnce({
      ok: true,
      data: {
        sessionId: SESSION,
        latest: {
          status: "running",
          checkpointGeneration: 2,
          updatedAt: "2026-05-21T10:00:00.000Z",
        },
        activeCount: 1,
      },
    });
    const result = await call(CH.compaction.getStatus, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect(mocks.getCompactionStatus).toHaveBeenCalledWith(SESSION);
  });

  it("getStatus returns a null result for a missing/foreign-scope session", async () => {
    mocks.getCompactionStatus.mockResolvedValueOnce({ ok: true, data: null });
    const result = await call(CH.compaction.getStatus, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });

  it("getStatus rejects a non-uuid sessionId", async () => {
    const result = await call(CH.compaction.getStatus, { sessionId: "nope" });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
  });

  it("preserves a compaction-domain DB error (not downgraded)", async () => {
    mocks.getCompactionStatus.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "internal.unexpected",
        domain: "compaction",
        message: "Unable to load compaction status.",
        retryable: true,
        userActionable: false,
        redacted: true,
      },
    });
    const result = await call(CH.compaction.getStatus, { sessionId: SESSION });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error?.code).toBe("internal.unexpected");
    expect(result.error?.domain).toBe("compaction");
  });

  it("listHistory returns the timeline array", async () => {
    mocks.listCompactionHistory.mockResolvedValueOnce({ ok: true, data: [] });
    const result = await call(CH.compaction.listHistory, {
      sessionId: SESSION,
      limit: 50,
    });
    expect(result.ok).toBe(true);
    expect(mocks.listCompactionHistory).toHaveBeenCalledWith(SESSION, 50);
  });

  it("listHistory returns null for a missing/foreign session", async () => {
    mocks.listCompactionHistory.mockResolvedValueOnce({ ok: true, data: null });
    const result = await call(CH.compaction.listHistory, {
      sessionId: SESSION,
      limit: 50,
    });
    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });
});

describe("knowledge handler", () => {
  it("list returns the sanitized array and passes the parsed input", async () => {
    mocks.listKnowledge.mockResolvedValueOnce({ ok: true, data: [] });
    const result = await call(CH.knowledge.list, { limit: 100 });
    expect(result.ok).toBe(true);
    expect(mocks.listKnowledge).toHaveBeenCalledWith({ limit: 100 });
  });

  it("list rejects an out-of-range limit (bounded input)", async () => {
    const result = await call(CH.knowledge.list, { limit: 100_000 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
  });
});

describe("memory handlers", () => {
  it("listSession returns null for a missing/foreign session", async () => {
    mocks.listSessionMemories.mockResolvedValueOnce({ ok: true, data: null });
    const result = await call(CH.memory.listSession, {
      sessionId: SESSION,
      limit: 50,
    });
    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
    expect(mocks.listSessionMemories).toHaveBeenCalledWith(SESSION, 50);
  });

  it("listSession rejects a non-uuid sessionId", async () => {
    const result = await call(CH.memory.listSession, {
      sessionId: "nope",
      limit: 50,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
  });

  it("getStats returns the stats DTO", async () => {
    mocks.getMemoryStats.mockResolvedValueOnce({
      ok: true,
      data: {
        activeCount: 2,
        compactCount: 3,
        unresolvedOutstandingCount: 1,
        recentThemes: ["t"],
      },
    });
    const result = await call(CH.memory.getStats, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect(mocks.getMemoryStats).toHaveBeenCalledWith(SESSION);
  });
});

describe("runtime handlers", () => {
  it("getState returns mission run state with lease and pending-control fields", async () => {
    mocks.getActiveRunForSession.mockResolvedValueOnce({
      ok: true,
      data: {
        sessionId: SESSION,
        hasActiveRun: false,
        missionRunId: null,
        status: null,
        stopReason: null,
        lastCheckpointAt: null,
        startedAt: null,
        iterationCount: null,
        leaseActive: false,
        leaseExpiresAt: null,
        pendingControlKind: null,
      },
    });
    const result = await call(CH.runtime.getState, { sessionId: SESSION });
    expect(result.ok).toBe(true);
  });

  it("requestPause/Stop/Resume/cancelWake reach the DB-backed control handlers", async () => {
    // In this unit test environment there is no
    // Postgres connection, so the handlers fail at `ensureEngineDbUrl`
    // and surface `internal.unexpected`. This confirms the handlers
    // are no longer fail-closed by contract — they actually run.
    for (const ch of [
      CH.runtime.requestPause,
      CH.runtime.requestStop,
      CH.runtime.requestResume,
      CH.runtime.cancelWake,
    ]) {
      const result = await call(ch, { sessionId: SESSION });
      expect(result.ok).toBe(false);
      // `runtime.feature_unavailable` would mean the stub still runs.
      expect(result.error?.code).not.toBe("runtime.feature_unavailable");
    }
  });
});

describe("mission handlers", () => {
  it("getDraft returns null when no draft for session", async () => {
    mocks.getDraftForSession.mockResolvedValueOnce({ ok: true, data: null });
    const result = await call(CH.mission.getDraft, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });

  // Mission command coverage (per-command schema validation +
  // updateDraft fail-closed) lives in the focused files
  // under `__tests__/mission/` so this suite does not exceed the
  // 350-LOC budget.
});

describe("approvals handlers", () => {
  it("listPending returns mapped DTO array", async () => {
    mocks.listPendingForSession.mockResolvedValueOnce({ ok: true, data: [] });
    const result = await call(CH.approvals.listPending, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  // Approve/reject fail-closed assertions moved out.
  // Focused decision behavior is pinned in `approvals-decision-ipc.test.ts`; this
  // file keeps the smoke-level "handlers registered" coverage only.
  it("approve / reject handlers are registered", () => {
    // `handlers` map is the registered-handler shape from the `electron`
    // mock; presence here means register{Approve,Reject}Handler ran.
    expect(handlers.has(CH.approvals.approve)).toBe(true);
    expect(handlers.has(CH.approvals.reject)).toBe(true);
  });
});

describe("wallets-session handlers", () => {
  // listSessionWallets returns the DB-backed scope DTO.
  // setSessionWalletScope resolves ids and fails closed on unknown id. The
  // focused contract lives in `session-wallet-scope-ipc.test.ts`, `wallet-refs.test.ts`
  // (resolveWalletRef + invalid_selection), and `database/__tests__/
  // sessions-wallet-scope.test.ts` (CAS + allowed_wallets). Here we only check
  // the handlers exist after registration (smoke regression).
  it("listSessionWallets / setSessionWalletScope handlers are registered", () => {
    expect(handlers.has(CH.wallets.listSessionWallets)).toBe(true);
    expect(handlers.has(CH.wallets.setSessionWalletScope)).toBe(true);
  });

  // getPreparedIntent / cancelPreparedIntent are covered in
  // `wallet-prepared-intents-ipc.test.ts`. Here we only check
  // that the handlers exist after registration (smoke regression).
  it("getPreparedIntent / cancelPreparedIntent handlers are registered", () => {
    expect(handlers.has(CH.wallets.getPreparedIntent)).toBe(true);
    expect(handlers.has(CH.wallets.cancelPreparedIntent)).toBe(true);
  });
});

describe("models handler", () => {
  it("returns unconfigured when AGENT_PROVIDER / AGENT_MODEL are absent", async () => {
    delete process.env.AGENT_PROVIDER;
    delete process.env.AGENT_MODEL;
    const result = await call(CH.models.listAvailable, {});
    expect(result.ok).toBe(true);
    expect((result.data as { source: string }).source).toBe("unconfigured");
    expect((result.data as { models: unknown[] }).models).toEqual([]);
  });

  it("returns global_default with single option when env present", async () => {
    process.env.AGENT_PROVIDER = "openrouter";
    process.env.AGENT_MODEL = "anthropic/claude-opus-4.7";
    const result = await call(CH.models.listAvailable, {});
    expect(result.ok).toBe(true);
    const data = result.data as { source: string; models: { modelId: string }[] };
    expect(data.source).toBe("global_default");
    expect(data.models).toHaveLength(1);
    expect(data.models[0]!.modelId).toBe("anthropic/claude-opus-4.7");
  });
});

describe("DB helper errors preserve intended VexError shape", () => {
  it("DB helper error (internal.unexpected, no correlationId) survives registerHandler — code preserved, correlationId stamped", async () => {
    // Helpers must omit `correlationId` from error literals. An empty-string
    // correlationId is rejected by
    // `isValidVexErrorShape` (length === 0) and downgrades the public
    // error to `internal.contract_violation` — masking real DB faults.
    //
    // This test pins the contract: when a DB helper returns
    // `{ code: "internal.unexpected", domain: "messages", ... }` WITHOUT
    // a correlationId, the handler must:
    //   1. NOT downgrade the code to `internal.contract_violation`,
    //   2. stamp `ctx.requestId` into the final result.
    mocks.getMessageTail.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "internal.unexpected",
        domain: "messages",
        message: "Database unavailable. Verify services are running and retry.",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });
    const result = await call(CH.messages.getTail, {
      sessionId: SESSION,
      limit: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error?.code).toBe("internal.unexpected");
    expect(result.error?.domain).toBe("messages");
    // registerHandler auto-stamps the request id when correlationId is missing.
    expect((result.error as { correlationId?: string }).correlationId).toBe(
      "test-corr",
    );
  });

  it("approvals DB helper error preserves approvals domain (not downgraded)", async () => {
    mocks.listPendingForSession.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "internal.unexpected",
        domain: "approvals",
        message: "Unable to load approvals.",
        retryable: true,
        userActionable: false,
        redacted: true,
      },
    });
    const result = await call(CH.approvals.listPending, { sessionId: SESSION });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error?.code).toBe("internal.unexpected");
    expect(result.error?.domain).toBe("approvals");
  });
});

describe("sessions.getModel handler", () => {
  it("getModel returns global_default when env present", async () => {
    process.env.AGENT_PROVIDER = "openrouter";
    process.env.AGENT_MODEL = "anthropic/claude-opus-4.7";
    const result = await call(CH.sessions.getModel, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect((result.data as { source: string }).source).toBe("global_default");
  });

  it("getModel returns unconfigured when env absent", async () => {
    delete process.env.AGENT_PROVIDER;
    delete process.env.AGENT_MODEL;
    const result = await call(CH.sessions.getModel, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect((result.data as { source: string }).source).toBe("unconfigured");
  });
});
