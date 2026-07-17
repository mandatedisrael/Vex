/**
 * `reconcileDraftReadiness` (issue #41) — one-way, row-locked, status-
 * guarded draft → ready promotion.
 *
 * Covers:
 *   - a complete draft promotes to 'ready';
 *   - an incomplete draft stays 'draft' (no write);
 *   - a `ready` mission is NEVER touched (never demotes);
 *   - a missing mission row is a no-op;
 *   - passing a client reuses it (no nested transaction); omitting one
 *     opens `withTransaction` and locks the row itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetMissionForUpdate = vi.fn();
const mockSetStatus = vi.fn();
const mockWithTransaction = vi.fn(
  async (fn: (client: unknown) => unknown) => fn({ __fakeClient: true }),
);

vi.mock("@vex-agent/db/client.js", () => ({
  withTransaction: (fn: (client: unknown) => unknown) =>
    mockWithTransaction(fn),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMissionForUpdate: (...a: unknown[]) => mockGetMissionForUpdate(...a),
  setStatus: (...a: unknown[]) => mockSetStatus(...a),
}));

const { reconcileDraftReadiness } = await import(
  "../../../../vex-agent/engine/mission/draft-readiness.js"
);

const MISSION = "mission-1";

/** A mission row satisfying every `MISSION_DRAFT_REQUIRED_FIELDS` entry. */
function completeMission(overrides: Record<string, unknown> = {}) {
  return {
    id: MISSION,
    rootSessionId: "session-1",
    status: "draft",
    title: "SOL DCA",
    goal: "Accumulate 10 SOL",
    constraintsJson: {},
    successCriteriaJson: ["Accumulated 10 SOL"],
    stopConditionsJson: ["capital_depleted"],
    riskProfile: "conservative",
    capitalSourceJson: { type: "wallet", amount: "500 USDC" },
    allowedProtocols: ["jupiter"],
    allowedChains: ["solana"],
    allowedWallets: ["solana"],
    ...overrides,
  };
}

/** An incomplete draft — missing `goal`. */
function incompleteMission(overrides: Record<string, unknown> = {}) {
  return completeMission({ goal: null, ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWithTransaction.mockImplementation(
    async (fn: (client: unknown) => unknown) => fn({ __fakeClient: true }),
  );
  mockSetStatus.mockResolvedValue(undefined);
});

describe("reconcileDraftReadiness", () => {
  it("promotes a complete draft to ready", async () => {
    mockGetMissionForUpdate.mockResolvedValue(completeMission());

    const result = await reconcileDraftReadiness(MISSION);

    expect(result).toEqual({ promoted: true });
    expect(mockSetStatus).toHaveBeenCalledWith(
      MISSION,
      "ready",
      expect.anything(),
    );
  });

  it("leaves an incomplete draft at draft (no write)", async () => {
    mockGetMissionForUpdate.mockResolvedValue(incompleteMission());

    const result = await reconcileDraftReadiness(MISSION);

    expect(result).toEqual({ promoted: false });
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("never demotes — a ready mission is left untouched even if it were invalid", async () => {
    mockGetMissionForUpdate.mockResolvedValue(
      incompleteMission({ status: "ready" }),
    );

    const result = await reconcileDraftReadiness(MISSION);

    expect(result).toEqual({ promoted: false });
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("is a no-op for a mission in any other status (e.g. running)", async () => {
    mockGetMissionForUpdate.mockResolvedValue(
      completeMission({ status: "running" }),
    );

    const result = await reconcileDraftReadiness(MISSION);

    expect(result).toEqual({ promoted: false });
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("is a no-op when the mission row is missing", async () => {
    mockGetMissionForUpdate.mockResolvedValue(null);

    const result = await reconcileDraftReadiness(MISSION);

    expect(result).toEqual({ promoted: false });
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("reuses the caller's client and does not open its own transaction", async () => {
    mockGetMissionForUpdate.mockResolvedValue(completeMission());
    const callerClient = { __callerClient: true };

    const result = await reconcileDraftReadiness(MISSION, callerClient as never);

    expect(result).toEqual({ promoted: true });
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockGetMissionForUpdate).toHaveBeenCalledWith(callerClient, MISSION);
    expect(mockSetStatus).toHaveBeenCalledWith(MISSION, "ready", callerClient);
  });

  it("opens its own transaction and locks the row when no client is passed", async () => {
    mockGetMissionForUpdate.mockResolvedValue(completeMission());

    await reconcileDraftReadiness(MISSION);

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    const txClient = mockGetMissionForUpdate.mock.calls[0]![0];
    expect(mockSetStatus).toHaveBeenCalledWith(MISSION, "ready", txClient);
  });
});
