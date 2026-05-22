import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTestContext } from "../_test-context.js";

const mockApplyMissionPatch = vi.fn();
const mockGetRunBySession = vi.fn();
const mockGetMission = vi.fn();

vi.mock("@vex-agent/engine/mission/setup.js", () => ({
  applyMissionPatch: (...a: unknown[]) => mockApplyMissionPatch(...a),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getRunBySession: (...a: unknown[]) => mockGetRunBySession(...a),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMission: (...a: unknown[]) => mockGetMission(...a),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(), query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null),
}));

const { handleMissionDraftUpdate, handleMissionStop } = await import("../../../../vex-agent/tools/internal/mission.js");

const baseContext = makeTestContext({
  sessionId: "session-1",
  sessionPermission: "restricted",
  missionRunId: "run-1",
  missionId: "mission-1",
  sessionKind: "mission",
});

beforeEach(() => {
  mockApplyMissionPatch.mockReset();
  mockGetRunBySession.mockReset();
  mockGetMission.mockReset();
  mockGetRunBySession.mockResolvedValue(null);
  mockGetMission.mockResolvedValue({
    id: "mission-1",
    status: "running",
    stopConditionsJson: [
      "deadline_reached",
      "capital_depleted",
      "max_loss_hit",
      "no_viable_opportunity",
    ],
    // Puzzle 04: acceptance reads `acceptedContractHash !== null`.
    // Hash content is opaque to the authorizer.
    acceptedContractHash: "0".repeat(64),
  });
});

describe("mission_draft_update tool", () => {
  it("applies a draft patch in mission setup", async () => {
    mockApplyMissionPatch.mockResolvedValueOnce({
      missionId: "mission-1",
      status: "ready",
      currentDraft: { title: "SOL Flip" },
      missingFields: [],
      ready: true,
    });

    const result = await handleMissionDraftUpdate(
      { title: "SOL Flip", goal: "Double wallet value" },
      { ...baseContext, missionRunId: null },
    );

    expect(result.success).toBe(true);
    expect(mockApplyMissionPatch).toHaveBeenCalledWith("mission-1", {
      title: "SOL Flip",
      goal: "Double wallet value",
    });
    expect(result.data).toEqual(expect.objectContaining({
      ready: true,
      nextCommand: "/mission start",
    }));
  });

  it("passes stop condition updates through the setup boundary", async () => {
    // Puzzle 04: draft can be `ready` once the list is non-empty —
    // acceptance is a separate host gate (mission.acceptContract → mig
    // 023 `accepted_contract_hash`). The setup boundary surfaces the
    // current draft as-is; no model-facing acceptance flag is exposed.
    mockApplyMissionPatch.mockResolvedValueOnce({
      missionId: "mission-1",
      status: "ready",
      currentDraft: { stopConditions: ["capital_depleted"] },
      missingFields: [],
      ready: true,
    });

    const result = await handleMissionDraftUpdate(
      { stopConditions: ["capital_depleted"] },
      { ...baseContext, missionRunId: null },
    );

    expect(result.success).toBe(true);
    expect(mockApplyMissionPatch).toHaveBeenCalledWith("mission-1", {
      stopConditions: ["capital_depleted"],
    });
  });

  it("returns /mission continue when a prior run exists", async () => {
    mockApplyMissionPatch.mockResolvedValueOnce({
      missionId: "mission-1",
      status: "ready",
      currentDraft: { title: "SOL Flip" },
      missingFields: [],
      ready: true,
    });
    mockGetRunBySession.mockResolvedValueOnce({ id: "run-prior" });

    const result = await handleMissionDraftUpdate(
      { title: "SOL Flip" },
      { ...baseContext, missionRunId: null },
    );

    expect(result.success).toBe(true);
    expect(result.data?.nextCommand).toBe("/mission continue");
  });

  it("rejects outside mission setup", async () => {
    const result = await handleMissionDraftUpdate(
      { title: "SOL Flip" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("only valid during mission setup or edit");
  });

  it("rejects invalid patch shape", async () => {
    const result = await handleMissionDraftUpdate(
      { allowedWallets: ["ok", ""] },
      { ...baseContext, missionRunId: null },
    );
    expect(result.success).toBe(false);
    expect(mockApplyMissionPatch).not.toHaveBeenCalledWith("mission-1", expect.objectContaining({
      allowedWallets: expect.anything(),
    }));
  });
});

describe("mission_stop tool", () => {
  it("returns engineSignal with valid reason", async () => {
    const result = await handleMissionStop(
      { reason: "goal_reached", summary: "Accumulated target SOL" },
      baseContext,
    );
    expect(result.success).toBe(true);
    expect(result.engineSignal).toBeDefined();
    expect(result.engineSignal!.type).toBe("stop_mission");
    expect(result.engineSignal!.reason).toBe("goal_reached");
    expect(result.engineSignal!.summary).toBe("Accumulated target SOL");
  });

  it("accepts all valid stop reasons", async () => {
    const reasons = ["goal_reached", "deadline_reached", "capital_depleted", "max_loss_hit", "no_viable_opportunity", "emergency_stop"];
    for (const reason of reasons) {
      const result = await handleMissionStop({ reason, summary: "test" }, baseContext);
      expect(result.success).toBe(true);
      expect(result.engineSignal!.reason).toBe(reason);
    }
  });

  it("rejects invalid reason", async () => {
    const result = await handleMissionStop(
      { reason: "bored", summary: "I'm bored" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid stop reason");
  });

  it("requires reason", async () => {
    const result = await handleMissionStop({ summary: "test" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: reason");
  });

  it("requires summary", async () => {
    const result = await handleMissionStop({ reason: "goal_reached" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required: summary");
  });

  it("includes optional evidence", async () => {
    const result = await handleMissionStop(
      { reason: "capital_depleted", summary: "No funds left", evidence: { balanceUsd: 0.12 } },
      baseContext,
    );
    expect(result.engineSignal!.evidence).toEqual({ balanceUsd: 0.12 });
  });

  it("rejects unaccepted user-configurable stop reasons", async () => {
    mockGetMission.mockResolvedValueOnce({
      id: "mission-1",
      status: "running",
      stopConditionsJson: ["deadline_reached"],
      acceptedContractHash: "0".repeat(64),
    });

    const result = await handleMissionStop(
      { reason: "no_viable_opportunity", summary: "No setup right now" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("not in the accepted mission stop conditions");
  });

  it("allows emergency_stop without a configured stop condition", async () => {
    mockGetMission.mockReset();
    const result = await handleMissionStop(
      { reason: "emergency_stop", summary: "Wallet state cannot be verified" },
      baseContext,
    );

    expect(result.success).toBe(true);
    expect(mockGetMission).not.toHaveBeenCalled();
    expect(result.engineSignal!.reason).toBe("emergency_stop");
  });

  it("rejects when no active mission run (missionRunId null)", async () => {
    const result = await handleMissionStop(
      { reason: "goal_reached", summary: "Done" },
      { ...baseContext, missionRunId: null },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("only valid during an active mission run");
  });

  it("rejects user_stopped (not a model-driven reason)", async () => {
    const result = await handleMissionStop(
      { reason: "user_stopped", summary: "user asked" },
      baseContext,
    );
    expect(result.success).toBe(false);
  });
});
