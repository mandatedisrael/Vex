/**
 * PR-13 S-2 regression — every resume path refreshes tool_output_blob TTLs
 * up front so long paused_wake / paused_approval windows don't leave the
 * model with expired overflow pointers.
 *
 * Phase 2 collapse removed `resumeFullAutonomousSession`; only the mission
 * resume path remains. The approval-resume mirror path goes through
 * `resumeMissionRun`, so it's covered transitively.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveProvider = vi.fn();
const mockHydrate = vi.fn();
const mockRunTurnLoop = vi.fn();
const mockGetRun = vi.fn();
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

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMission: (...a: unknown[]) => mockGetMission(...a),
}));

vi.mock("../../../../../vex-agent/engine/wake/blob-refresh.js", () => ({
  refreshBlobTtlForRecentMessages: (...a: unknown[]) => mockRefreshBlobTtl(...a),
}));

const { resumeMissionRun } = await import(
  "../../../../../vex-agent/engine/core/runner/mission.js"
);

const config = { provider: "test", model: "m", contextLimit: 1000, maxOutputTokens: 512, inputPricePerM: 0, outputPricePerM: 0, priceCurrency: "USD" as const, cachePricePerM: null, cacheWritePricePerM: null, reasoningPricePerM: null, supportsReasoningEffort: false };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveProvider.mockResolvedValue({ loadConfig: vi.fn().mockResolvedValue(config) });
  mockHydrate.mockResolvedValue({
    context: {
      sessionId: "s1",
      sessionKind: "mission",
      sessionPermission: "restricted",
      missionId: "m1",
      missionRunId: "run-1",
      loadedDocuments: new Map(),
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
    iterationCount: 1,
    contractSnapshotJson: null,
  });
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
});
