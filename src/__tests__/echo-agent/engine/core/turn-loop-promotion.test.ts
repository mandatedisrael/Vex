/**
 * turn-loop post-checkpoint promotion hook — invariant pinning (plan §4e).
 *
 * Covers the seam introduced in PR4 Fase IV (`runPromotionForSession`
 * called after `executeCheckpoint` commits) and the PR3 observability
 * contract (a thrown promotion surfaces as a `logger.warn` and is
 * swallowed — the loop continues, the checkpoint stays committed).
 *
 * We verify:
 *   1. After a `prefix` checkpoint, promotion IS called with the session
 *      context, and ordered strictly AFTER `executeCheckpoint` returns.
 *   2. After a `giant_tool` checkpoint, promotion IS called.
 *   3. After a `noop` checkpoint, promotion is NOT called.
 *   4. A throwing promotion does not break the loop and logs the expected
 *      warn event with `sessionId` + error context.
 *
 * The test is deliberately narrow — it only drives ONE checkpoint cycle
 * via an over-threshold token count + a single assistant reply. The
 * broader loop semantics live in `turn-loop.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import logger from "@utils/logger.js";

// ── Mocks ─────────────────────────────────────────────────────

const mockAddEngineMessage = vi.fn();
const mockGetLiveMessages = vi.fn().mockResolvedValue([]);
const mockDispatchTool = vi.fn();
const mockUpdateTokenCount = vi.fn().mockResolvedValue(undefined);
const mockSetRollingSummary = vi.fn().mockResolvedValue(undefined);
const mockArchivePrefix = vi.fn().mockResolvedValue(undefined);
const mockForkToolMessageToArchive = vi.fn().mockResolvedValue(undefined);
const mockSetMemoryScopeKey = vi.fn().mockResolvedValue(undefined);
const mockGetSession = vi.fn();

vi.mock("@echo-agent/db/repos/messages.js", () => ({
  addMessage: vi.fn(),
  addEngineMessage: (...a: unknown[]) => mockAddEngineMessage(...a),
  getLiveMessages: (...a: unknown[]) => mockGetLiveMessages(...a),
}));

vi.mock("@echo-agent/db/repos/mission-runs.js", () => ({
  incrementIterations: vi.fn().mockResolvedValue(1),
  updateStatus: vi.fn(),
  setLastCheckpoint: vi.fn(),
}));

vi.mock("@echo-agent/tools/dispatcher.js", () => ({
  dispatchTool: (...a: unknown[]) => mockDispatchTool(...a),
}));

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  updateTokenCount: (...a: unknown[]) => mockUpdateTokenCount(...a),
  setRollingSummary: (...a: unknown[]) => mockSetRollingSummary(...a),
  archivePrefix: (...a: unknown[]) => mockArchivePrefix(...a),
  forkToolMessageToArchive: (...a: unknown[]) => mockForkToolMessageToArchive(...a),
  setMemoryScopeKey: (...a: unknown[]) => mockSetMemoryScopeKey(...a),
  getSession: (...a: unknown[]) => mockGetSession(...a),
}));

const mockExecuteCheckpoint = vi.fn();
vi.mock("@echo-agent/engine/core/checkpoint.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../echo-agent/engine/core/checkpoint.js")>(
    "@echo-agent/engine/core/checkpoint.js",
  );
  return {
    ...actual,
    executeCheckpoint: (...a: unknown[]) => mockExecuteCheckpoint(...a),
  };
});

vi.mock("@echo-agent/db/repos/approvals.js", () => ({
  enqueue: vi.fn(),
}));

vi.mock("@echo-agent/db/repos/usage.js", () => ({
  logUsage: vi.fn(),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

vi.mock("@echo-agent/tools/protocols/catalog.js", () => ({
  PROTOCOL_TOOLS: [],
  PROTOCOL_NAMESPACE_ALLOWLIST: [],
}));

const mockRunPromotion = vi.fn();
vi.mock("@echo-agent/knowledge/promotion.js", () => ({
  runPromotionForSession: (...a: unknown[]) => mockRunPromotion(...a),
}));

const { runTurnLoop } = await import("../../../../echo-agent/engine/core/turn-loop.js");

// ── Helpers ───────────────────────────────────────────────────

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-1",
    sessionKind: "chat" as const,
    loopMode: "off" as const,
    missionId: null,
    missionRunId: null,
    isSubagent: false,
    loadedDocuments: new Map<string, string>(),
    memoryScopeKey: "session-1",
    ...overrides,
  };
}

function makeProvider() {
  return {
    chatCompletion: vi.fn().mockResolvedValue({
      content: "ok",
      toolCalls: null,
      usage: { promptTokens: 1_000, completionTokens: 200, cachedTokens: 0, reasoningTokens: 0 },
    }),
    calculateCost: vi.fn().mockReturnValue({ totalCost: 0.001, currency: "USD" }),
  };
}

function makeConfig() {
  return {
    provider: "openrouter",
    model: "test-model",
    contextLimit: 1_000, // tiny — any token count trips the 90% threshold
    maxOutputTokens: 4_096,
    temperature: 0.5,
    agentPersona: "test",
  };
}

const LOOP_CONFIG = {
  maxIterations: 1,
  timeoutMs: 10_000,
  contextLimit: 1_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Session has token_count high enough to cross the 90% checkpoint threshold.
  mockGetSession.mockResolvedValue({ id: "session-1", tokenCount: 950, summary: null });
  mockRunPromotion.mockResolvedValue({
    sessionId: "session-1",
    scopeKey: "session-1",
    considered: 0,
    inserted: 0,
    alreadyPromoted: 0,
    skipped: {},
  });
});

describe("turn-loop post-checkpoint promotion hook", () => {
  it("mode=prefix: promotion runs AFTER executeCheckpoint returns and receives (sessionId, provider, config)", async () => {
    const callOrder: string[] = [];
    mockExecuteCheckpoint.mockImplementation(async () => {
      callOrder.push("checkpoint");
      return { mode: "prefix", summary: "new rolling", episodeIds: [] };
    });
    mockRunPromotion.mockImplementation(async (sid: string) => {
      callOrder.push(`promotion(${sid})`);
      return {
        sessionId: sid,
        scopeKey: sid,
        considered: 0,
        inserted: 0,
        alreadyPromoted: 0,
        skipped: {},
      };
    });

    const provider = makeProvider();
    const config = makeConfig();
    await runTurnLoop(
      makeContext(),
      [],
      null,
      950,
      provider as never,
      config,
      [],
      LOOP_CONFIG,
    );

    expect(mockExecuteCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockRunPromotion).toHaveBeenCalledTimes(1);
    expect(mockRunPromotion).toHaveBeenCalledWith("session-1", provider, config);
    expect(callOrder).toEqual(["checkpoint", "promotion(session-1)"]);
  });

  it("mode=giant_tool: promotion still runs", async () => {
    mockExecuteCheckpoint.mockResolvedValue({
      mode: "giant_tool",
      summary: null,
      episodeIds: [],
    });

    await runTurnLoop(
      makeContext(),
      [],
      null,
      950,
      makeProvider() as never,
      makeConfig(),
      [],
      LOOP_CONFIG,
    );

    expect(mockExecuteCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockRunPromotion).toHaveBeenCalledTimes(1);
  });

  it("mode=noop: promotion is NOT called (no checkpoint fired)", async () => {
    // Session at 0 tokens — shouldCheckpoint returns false before any
    // executeCheckpoint call, so the promotion hook is never reached.
    mockGetSession.mockResolvedValue({ id: "session-1", tokenCount: 0, summary: null });

    await runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      makeProvider() as never,
      makeConfig(),
      [],
      LOOP_CONFIG,
    );

    expect(mockExecuteCheckpoint).not.toHaveBeenCalled();
    expect(mockRunPromotion).not.toHaveBeenCalled();
  });

  it("executeCheckpoint returns noop: promotion is NOT called", async () => {
    // Over threshold so we enter maybeRunCheckpoint, but executeCheckpoint
    // itself decides nothing is compactable (cooldown or empty prefix).
    mockExecuteCheckpoint.mockResolvedValue({ mode: "noop", summary: null, episodeIds: [] });

    await runTurnLoop(
      makeContext(),
      [],
      null,
      950,
      makeProvider() as never,
      makeConfig(),
      [],
      LOOP_CONFIG,
    );

    expect(mockExecuteCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockRunPromotion).not.toHaveBeenCalled();
  });

  it("promotion throws: warn logged, loop still completes", async () => {
    mockExecuteCheckpoint.mockResolvedValue({
      mode: "prefix",
      summary: "new rolling",
      episodeIds: [],
    });
    mockRunPromotion.mockRejectedValue(new Error("promotion blew up"));

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    const result = await runTurnLoop(
      makeContext(),
      [],
      null,
      950,
      makeProvider() as never,
      makeConfig(),
      [],
      LOOP_CONFIG,
    );

    expect(mockRunPromotion).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined(); // loop didn't throw out of the top frame

    const call = warnSpy.mock.calls.find(([event]) => event === "turn_loop.promotion.failed");
    expect(call, "expected turn_loop.promotion.failed warn").toBeDefined();
    expect(call?.[1]).toMatchObject({
      sessionId: "session-1",
      error: "promotion blew up",
    });

    warnSpy.mockRestore();
  });
});
