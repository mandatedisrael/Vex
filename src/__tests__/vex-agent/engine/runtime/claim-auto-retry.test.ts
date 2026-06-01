/**
 * Phase 4d — claimRunForAutoRetry atomic safety re-check. A consumed wake can't
 * be cancelled, so this claim is the authority: every predicate is re-verified
 * under the row lock before flipping to running. DB client/repos are mocked.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const queryOneWith = vi.fn();
const executeWith = vi.fn().mockResolvedValue(1);
const acquireLease = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  withTransaction: async <T>(cb: (client: unknown) => Promise<T>): Promise<T> =>
    cb({}),
  queryOneWith: (...a: unknown[]) => queryOneWith(...a),
  executeWith: (...a: unknown[]) => executeWith(...a),
}));
vi.mock("@vex-agent/db/repos/runner-leases.js", () => ({
  acquireLease: (...a: unknown[]) => acquireLease(...a),
}));

const { claimRunForAutoRetry } = await import(
  "../../../../vex-agent/engine/runtime/lease-and-status/claim-auto-retry.js"
);

const OPT_IN = { version: 1, frozenMission: { constraintsJson: { autoRetryEnabled: true } } };
const LEASE = { sessionId: "s1", ownerId: "auto-retry-w1", expiresAt: new Date(Date.now() + 60_000) };

function runRow(over: Record<string, unknown> = {}) {
  return {
    status: "paused_error",
    session_id: "s1",
    stop_reason: "provider_error",
    error_retry_count: 2,
    auto_retry_unsafe: false,
    contract_snapshot_json: OPT_IN,
    permission: "full",
    ...over,
  };
}

const INPUT = {
  sessionId: "s1",
  missionRunId: "run-1",
  expectedAttempt: 2,
  ownerId: "auto-retry-w1",
  processKind: "electron_main" as const,
  ttlMs: 300_000,
};

afterEach(() => vi.clearAllMocks());

describe("claimRunForAutoRetry", () => {
  it("CLAIMED: all predicates hold + lease free → flips to running, acquires lease", async () => {
    queryOneWith.mockResolvedValueOnce(runRow()); // run row
    queryOneWith.mockResolvedValueOnce(null); // no existing lease
    acquireLease.mockResolvedValueOnce(LEASE);
    const out = await claimRunForAutoRetry(INPUT);
    expect(out.outcome).toBe("claimed");
    expect(executeWith).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("status = 'running'"),
      ["run-1"],
    );
    expect(acquireLease).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["run_missing", null],
    ["session_mismatch", runRow({ session_id: "other" })],
    ["status_changed", runRow({ status: "running" })],
    ["unsafe", runRow({ auto_retry_unsafe: true })],
    ["stop_reason", runRow({ stop_reason: "user_paused" })],
    ["attempt_mismatch", runRow({ error_retry_count: 3 })],
    ["not_full", runRow({ permission: "restricted" })],
    ["opt_out", runRow({ contract_snapshot_json: {} })],
  ])("INELIGIBLE (%s) → no flip, no lease", async (reason, row) => {
    queryOneWith.mockResolvedValueOnce(row);
    const out = await claimRunForAutoRetry(INPUT);
    expect(out).toEqual({ outcome: "ineligible", reason });
    expect(executeWith).not.toHaveBeenCalled();
    expect(acquireLease).not.toHaveBeenCalled();
  });

  it("LEASE_BUSY: a live lease owned by another runner blocks the claim", async () => {
    queryOneWith.mockResolvedValueOnce(runRow()); // eligible run
    queryOneWith.mockResolvedValueOnce({
      session_id: "s1",
      mission_run_id: "run-1",
      owner_id: "someone-else",
      process_kind: "electron_main",
      acquired_at: new Date(),
      heartbeat_at: new Date(),
      expires_at: new Date(Date.now() + 60_000),
    });
    const out = await claimRunForAutoRetry(INPUT);
    expect(out.outcome).toBe("lease_busy");
    expect(executeWith).not.toHaveBeenCalled();
  });
});
