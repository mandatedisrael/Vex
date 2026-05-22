import { describe, it, expect } from "vitest";

import {
  acceptedStopReasonsForMission,
  areStopConditionsAcceptedByUser,
  authorizeMissionStopReason,
  normalizeStopConditionReason,
} from "../../../../vex-agent/engine/mission/stop-contract.js";
import type { Mission } from "../../../../vex-agent/db/repos/missions.js";

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission-1",
    rootSessionId: "session-1",
    status: "draft",
    title: "Mission",
    goal: "Goal",
    constraintsJson: {},
    successCriteriaJson: ["goal"],
    stopConditionsJson: [],
    riskProfile: "aggressive",
    capitalSourceJson: { type: "wallet", amount: "$10" },
    allowedProtocols: ["solana"],
    allowedChains: ["solana"],
    allowedWallets: ["wallet"],
    createdAt: "2026-05-02T00:00:00Z",
    updatedAt: "2026-05-02T00:00:00Z",
    approvedAt: null,
    // Puzzle 04: acceptance authority moved to dedicated columns.
    acceptedContractHash: null,
    acceptedContractAt: null,
    acceptedContractBy: null,
    contractHashVersion: null,
    renewedFromMissionId: null,
    ...overrides,
  };
}

// Puzzle 04: `areStopConditionsAcceptedByUser` now reads
// `mission.acceptedContractHash !== null` instead of the legacy
// `constraints_json.stopConditionsAccepted` boolean. Hash content does
// not matter for the test — only its non-nullness signals acceptance.
const ACCEPTED_HASH = "0".repeat(64);

describe("mission stop contract", () => {
  it("normalizes canonical and natural-language stop conditions", () => {
    expect(normalizeStopConditionReason("deadline_reached")).toBe("deadline_reached");
    expect(normalizeStopConditionReason("6 hours elapsed")).toBe("deadline_reached");
    expect(normalizeStopConditionReason("wallet empty")).toBe("capital_depleted");
    expect(normalizeStopConditionReason("total USD <= $5")).toBe("max_loss_hit");
    expect(normalizeStopConditionReason("no pumps after 24h inactivity")).toBe("no_viable_opportunity");
  });

  it("requires explicit host acceptance (acceptedContractHash) for stop conditions", () => {
    const mission = makeMission({
      stopConditionsJson: ["capital_depleted"],
    });

    expect(areStopConditionsAcceptedByUser(mission)).toBe(false);
    expect(acceptedStopReasonsForMission(mission)).toEqual([]);
  });

  it("returns accepted canonical reasons after host acceptance writes the hash", () => {
    const mission = makeMission({
      acceptedContractHash: ACCEPTED_HASH,
      stopConditionsJson: ["capital_depleted", "no pumps after 24h inactivity"],
    });

    expect(acceptedStopReasonsForMission(mission)).toEqual([
      "capital_depleted",
      "no_viable_opportunity",
    ]);
  });

  it("ignores legacy constraints_json.stopConditionsAccepted boolean (puzzle 04)", () => {
    // A pre-puzzle-04 mission row carrying `stopConditionsAccepted=true`
    // inside constraints_json must NOT be treated as accepted. Only the
    // `acceptedContractHash` column counts.
    const mission = makeMission({
      constraintsJson: { stopConditionsAccepted: true },
      stopConditionsJson: ["max_loss_hit"],
    });

    expect(areStopConditionsAcceptedByUser(mission)).toBe(false);
    expect(acceptedStopReasonsForMission(mission)).toEqual([]);
  });

  it("authorizes success and emergency outside configured stop conditions", () => {
    const mission = makeMission();

    expect(authorizeMissionStopReason(mission, "goal_reached").allowed).toBe(true);
    expect(authorizeMissionStopReason(mission, "emergency_stop").allowed).toBe(true);
  });

  it("rejects unaccepted stop reasons", () => {
    const mission = makeMission({
      acceptedContractHash: ACCEPTED_HASH,
      stopConditionsJson: ["deadline_reached"],
    });

    const authorization = authorizeMissionStopReason(mission, "no_viable_opportunity");

    expect(authorization.allowed).toBe(false);
    expect(authorization.message).toContain("not in the accepted mission stop conditions");
  });
});
