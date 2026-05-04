/**
 * PR-10 — full-autonomous runner integration smoke tests.
 *
 * Covers:
 *   - `processFullAutonomousTurn` saves the user message, hydrates, and
 *     runs the loop with sessionKind="full_autonomous" + loopMode="full".
 *   - `resumeFullAutonomousSession` does NOT save a user message (the wake
 *     banner persisted by PR-7 is the trigger).
 *   - Defense-in-depth — runner refuses to execute when hydrated session
 *     kind isn't `full_autonomous`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveProvider = vi.fn();
const mockHydrate = vi.fn();
const mockRunTurnLoop = vi.fn();
const mockAddMessage = vi.fn();
const mockAddEngineMessage = vi.fn();
const mockEnqueueWake = vi.fn();
const mockCreateFullRun = vi.fn();
const mockGetActiveFullRun = vi.fn();
const mockGetFullRun = vi.fn();
const mockUpdateFullRunStatus = vi.fn();

vi.mock("@vex-agent/inference/registry.js", () => ({
  resolveProvider: () => mockResolveProvider(),
}));

vi.mock("../../../../../vex-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: (...a: unknown[]) => mockHydrate(...a),
}));

vi.mock("../../../../../vex-agent/engine/core/turn-loop.js", () => ({
  runTurnLoop: (...a: unknown[]) => mockRunTurnLoop(...a),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: (...a: unknown[]) => mockAddEngineMessage(...a),
  // `resumeMissionRun` / `resumeFullAutonomousSession` call
  // refreshBlobTtlForRecentMessages which walks live messages — keep the
  // mock deterministic.
  getLiveMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("@vex-agent/db/repos/loop-wake.js", () => ({
  enqueue: (...a: unknown[]) => mockEnqueueWake(...a),
}));

vi.mock("@vex-agent/db/repos/full-autonomous-runs.js", () => ({
  createRun: (...a: unknown[]) => mockCreateFullRun(...a),
  getActiveRunBySession: (...a: unknown[]) => mockGetActiveFullRun(...a),
  getRun: (...a: unknown[]) => mockGetFullRun(...a),
  updateStatus: (...a: unknown[]) => mockUpdateFullRunStatus(...a),
}));

const { processFullAutonomousTurn, resumeFullAutonomousSession } = await import(
  "../../../../../vex-agent/engine/core/runner/full-autonomous.js"
);

const config = { provider: "test", model: "m", contextLimit: 1000, maxOutputTokens: 512, inputPricePerM: 0, outputPricePerM: 0, priceCurrency: "USD" as const, cachePricePerM: null, reasoningPricePerM: null };
const fullRun = {
  id: "farun-1",
  sessionId: "s1",
  status: "running" as const,
  loopMode: "full" as const,
  startedAt: "2026-03-29T00:00:00.000Z",
  endedAt: null,
  lastCheckpointAt: null,
  stopReason: null,
  stopSummary: null,
  stopEvidenceJson: null,
  iterationCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveProvider.mockResolvedValue({ loadConfig: vi.fn().mockResolvedValue(config) });
  mockCreateFullRun.mockResolvedValue(undefined);
  mockGetActiveFullRun.mockResolvedValue(fullRun);
  mockGetFullRun.mockResolvedValue(fullRun);
  mockUpdateFullRunStatus.mockResolvedValue(undefined);
  mockEnqueueWake.mockResolvedValue({
    id: "wake-1",
    sessionId: "s1",
    missionRunId: null,
    kind: "full_autonomous",
    dueAt: "2026-03-29T00:00:05.000Z",
    status: "pending",
    reason: "iteration_limit: runtime slice exhausted; continue autonomously",
    payload: { trigger: "iteration_limit", automatic: true },
    createdAt: "2026-03-29T00:00:00.000Z",
    consumedAt: null,
    cancelledAt: null,
    cancelledReason: null,
  });
  mockHydrate.mockResolvedValue({
    context: {
      sessionId: "s1",
      sessionKind: "full_autonomous",
      loopMode: "full",
      missionId: null,
      missionRunId: null,
      isSubagent: false,
      loadedDocuments: new Map(),
      memoryScopeKey: "s1",
    },
    messages: [],
    summary: null,
    tokenCount: 0,
  });
  mockRunTurnLoop.mockResolvedValue({
    text: "full-auto turn result",
    toolCallsMade: 1,
    pendingApprovals: [],
    stopReason: "waiting_for_wake",
  });
});

describe("full-autonomous runner", () => {
  it("processFullAutonomousTurn saves the user message then enters the loop", async () => {
    mockGetActiveFullRun.mockResolvedValueOnce(null);
    const result = await processFullAutonomousTurn("s1", "start autonomous mode");

    expect(mockAddMessage).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ role: "user", content: "start autonomous mode" }),
      expect.objectContaining({ source: "user", messageType: "chat" }),
    );
    expect(mockRunTurnLoop).toHaveBeenCalled();
    const loopCtx = mockRunTurnLoop.mock.calls[0]![0];
    expect(loopCtx.sessionKind).toBe("full_autonomous");
    expect(loopCtx.loopMode).toBe("full");
    expect(loopCtx.fullAutonomousRunId).toMatch(/^farun-/);
    expect(result.stopReason).toBe("waiting_for_wake");
    expect(result.missionStatus).toBeNull();
    expect(mockUpdateFullRunStatus).toHaveBeenCalledWith(
      expect.stringMatching(/^farun-/),
      "paused_wake",
      "waiting_for_wake",
      undefined,
    );
  });

  it("resumeFullAutonomousSession does NOT save a user message", async () => {
    const result = await resumeFullAutonomousSession("s1");

    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockRunTurnLoop).toHaveBeenCalled();
    expect(result.stopReason).toBe("waiting_for_wake");
  });

  it("throws when the hydrated session is not full_autonomous (defense in depth)", async () => {
    mockHydrate.mockResolvedValue({
      context: {
        sessionId: "s1",
        sessionKind: "chat",
        loopMode: "off",
        missionId: null,
        missionRunId: null,
        isSubagent: false,
        loadedDocuments: new Map(),
        memoryScopeKey: "s1",
      },
      messages: [],
      summary: null,
      tokenCount: 0,
    });

    await expect(resumeFullAutonomousSession("s1")).rejects.toThrow(/non-full_autonomous/);
  });

  it("throws when the session is missing", async () => {
    mockGetActiveFullRun.mockResolvedValueOnce(null);
    mockHydrate.mockResolvedValue(null);
    await expect(processFullAutonomousTurn("ghost", "hi")).rejects.toThrow(/not found/);
  });

  it("schedules wake continuation when a runtime slice hits iteration_limit", async () => {
    mockRunTurnLoop.mockResolvedValueOnce({
      text: "still working",
      toolCallsMade: 50,
      pendingApprovals: [],
      stopReason: "iteration_limit",
    });

    const result = await resumeFullAutonomousSession("s1");

    expect(result.stopReason).toBe("iteration_limit");
    expect(mockEnqueueWake).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "s1",
      missionRunId: null,
      kind: "full_autonomous",
      payload: { trigger: "iteration_limit", automatic: true },
    }));
    expect(mockAddEngineMessage).toHaveBeenCalledWith(
      "s1",
      expect.stringContaining("runtime_yield"),
      expect.objectContaining({
        messageType: "runtime_yield",
        payload: expect.objectContaining({ trigger: "iteration_limit" }),
      }),
    );
    expect(mockUpdateFullRunStatus).toHaveBeenCalledWith(
      "farun-1",
      "paused_wake",
      "waiting_for_wake",
      expect.objectContaining({
        evidence: { trigger: "iteration_limit" },
      }),
    );
  });
});
