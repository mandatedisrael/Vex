/**
 * PR-13 S-2 regression — every resume path refreshes tool_output_blob TTLs
 * up front so long paused_wake / paused_approval windows don't leave the
 * model with expired overflow pointers.
 *
 * Covered here: `resumeMissionRun` and `resumeFullAutonomousSession`. The
 * mirror path via `approveAndResume` goes through `resumeMissionRun`, so
 * it's covered transitively.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveProvider = vi.fn();
const mockHydrate = vi.fn();
const mockRunTurnLoop = vi.fn();
const mockGetRun = vi.fn();
const mockGetActiveFullRun = vi.fn();
const mockGetFullRun = vi.fn();
const mockGetMission = vi.fn();
const mockUpdateStatus = vi.fn();
const mockRefreshBlobTtl = vi.fn();

vi.mock("@vex-agent/inference/registry.js", () => ({
  resolveProvider: () => mockResolveProvider(),
}));

vi.mock("../../../../../vex-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: (...a: unknown[]) => mockHydrate(...a),
}));

vi.mock("../../../../../vex-agent/engine/core/turn-loop.js", () => ({
  runTurnLoop: (...a: unknown[]) => mockRunTurnLoop(...a),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getRun: (...a: unknown[]) => mockGetRun(...a),
  updateStatus: (...a: unknown[]) => mockUpdateStatus(...a),
}));

vi.mock("@vex-agent/db/repos/full-autonomous-runs.js", () => ({
  getActiveRunBySession: (...a: unknown[]) => mockGetActiveFullRun(...a),
  getRun: (...a: unknown[]) => mockGetFullRun(...a),
  updateStatus: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMission: (...a: unknown[]) => mockGetMission(...a),
}));

vi.mock("../../../../../vex-agent/engine/wake/blob-refresh.js", () => ({
  refreshBlobTtlForRecentMessages: (...a: unknown[]) => mockRefreshBlobTtl(...a),
}));

const { resumeMissionRun } = await import(
  "../../../../../vex-agent/engine/core/runner/mission.js"
);
const { resumeFullAutonomousSession } = await import(
  "../../../../../vex-agent/engine/core/runner/full-autonomous.js"
);

const config = { provider: "test", model: "m", contextLimit: 1000, maxOutputTokens: 512, inputPricePerM: 0, outputPricePerM: 0, priceCurrency: "USD" as const, cachePricePerM: null, reasoningPricePerM: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveProvider.mockResolvedValue({ loadConfig: vi.fn().mockResolvedValue(config) });
  mockHydrate.mockResolvedValue({
    context: {
      sessionId: "s1",
      sessionKind: "mission",
      loopMode: "restricted",
      missionId: "m1",
      missionRunId: "run-1",
      isSubagent: false,
      loadedDocuments: new Map(),
      memoryScopeKey: "s1",
    },
    messages: [],
    summary: null,
    tokenCount: 0,
  });
  mockRunTurnLoop.mockResolvedValue({ text: "done", toolCallsMade: 0, pendingApprovals: [], stopReason: null });
  mockGetRun.mockResolvedValue({
    id: "run-1",
    missionId: "m1",
    sessionId: "s1",
    status: "paused_wake",
    loopMode: "restricted",
    iterationCount: 1,
    contractSnapshotJson: null,
  });
  const fullRun = {
    id: "farun-1",
    sessionId: "s2",
    status: "running",
    loopMode: "full",
    iterationCount: 1,
  };
  mockGetActiveFullRun.mockResolvedValue(fullRun);
  mockGetFullRun.mockResolvedValue(fullRun);
  mockGetMission.mockResolvedValue({
    id: "m1",
    status: "running",
    rootSessionId: "s1",
    title: "test",
    goal: "test",
    riskProfile: "moderate",
    allowedWallets: [],
    allowedChains: [],
    allowedProtocols: [],
    constraintsJson: {},
    successCriteriaJson: [],
    stopConditionsJson: [],
    capitalSourceJson: {},
  });
  mockRefreshBlobTtl.mockResolvedValue(0);
});

describe("PR-13 S-2 — resume paths refresh blob TTLs", () => {
  it("resumeMissionRun calls refreshBlobTtlForRecentMessages before entering the loop", async () => {
    await resumeMissionRun("run-1");

    expect(mockRefreshBlobTtl).toHaveBeenCalledWith("s1");
    const refreshOrder = mockRefreshBlobTtl.mock.invocationCallOrder[0]!;
    const loopOrder = mockRunTurnLoop.mock.invocationCallOrder[0]!;
    expect(refreshOrder).toBeLessThan(loopOrder);
  });

  it("resumeFullAutonomousSession calls refreshBlobTtlForRecentMessages before entering the loop", async () => {
    mockHydrate.mockResolvedValue({
      context: {
        sessionId: "s2",
        sessionKind: "full_autonomous",
        loopMode: "full",
        missionId: null,
        missionRunId: null,
        isSubagent: false,
        loadedDocuments: new Map(),
        memoryScopeKey: "s2",
      },
      messages: [],
      summary: null,
      tokenCount: 0,
    });

    await resumeFullAutonomousSession("s2");

    expect(mockRefreshBlobTtl).toHaveBeenCalledWith("s2");
    const refreshOrder = mockRefreshBlobTtl.mock.invocationCallOrder[0]!;
    const loopOrder = mockRunTurnLoop.mock.invocationCallOrder[0]!;
    expect(refreshOrder).toBeLessThan(loopOrder);
  });
});
