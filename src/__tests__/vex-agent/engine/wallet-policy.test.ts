/**
 * Hydrate wallet policy derivation (puzzle 5 phase 5B).
 *
 * `resolveWalletPolicy` keys off the ACTIVE run's frozen contract snapshot
 * (not the live mission row). buildSessionWalletResolution maps a hydrated
 * selection to a session-scoped WalletResolution.
 */

import { describe, it, expect } from "vitest";
import type { Mission } from "../../../vex-agent/db/repos/missions.js";
import type { MissionRun } from "../../../vex-agent/db/repos/mission-runs.js";

const { resolveWalletPolicy, buildSessionWalletResolution } = await import(
  "../../../vex-agent/engine/core/hydrate.js"
);

// Minimal shapes — resolveWalletPolicy only reads mission truthiness +
// activeRun.contractSnapshotJson.frozenMission.allowedWallets.
const MISSION = { id: "m1" } as unknown as Mission;
function run(snapshot: unknown): MissionRun {
  return { contractSnapshotJson: snapshot } as unknown as MissionRun;
}
const A = "0xabcdef1234567890abcdef1234567890abcdef12";

describe("resolveWalletPolicy", () => {
  it("no mission, no run → none", () => {
    expect(resolveWalletPolicy(null, null)).toEqual({ kind: "none" });
  });

  it("mission in setup (no active run) → invalid (no accepted snapshot)", () => {
    expect(resolveWalletPolicy(MISSION, null)).toEqual({
      kind: "invalid",
      reason: "mission_without_active_run",
    });
  });

  it("active run with snapshot allowedWallets → mission_allowed", () => {
    const policy = resolveWalletPolicy(MISSION, run({ frozenMission: { allowedWallets: [A] } }));
    expect(policy).toEqual({ kind: "mission_allowed", allowedWallets: [A] });
  });

  it("active run with EMPTY allowedWallets → invalid (drift)", () => {
    expect(resolveWalletPolicy(MISSION, run({ frozenMission: { allowedWallets: [] } }))).toEqual({
      kind: "invalid",
      reason: "empty_allowed_wallets",
    });
  });

  it("active run with missing/malformed snapshot → invalid", () => {
    expect(resolveWalletPolicy(MISSION, run(null))).toEqual({
      kind: "invalid",
      reason: "missing_or_malformed_snapshot",
    });
    expect(resolveWalletPolicy(MISSION, run({ frozenMission: 42 }))).toEqual({
      kind: "invalid",
      reason: "missing_or_malformed_snapshot",
    });
  });

  it("uses snapshot even when the live mission arg is present (snapshot is authoritative)", () => {
    // run keyed first — mission may be null when an active run exists (run-tool).
    const policy = resolveWalletPolicy(null, run({ frozenMission: { allowedWallets: [A] } }));
    expect(policy).toEqual({ kind: "mission_allowed", allowedWallets: [A] });
  });
});

describe("buildSessionWalletResolution", () => {
  it("maps selection to a session-scoped resolution", () => {
    expect(
      buildSessionWalletResolution({
        selectedEvmWallet: { id: "evm_x", address: A },
        selectedSolanaWallet: null,
      }),
    ).toEqual({ source: "session", evm: { id: "evm_x", address: A }, solana: null });
  });

  it("null selections still produce source:session (→ fail closed downstream, never primary)", () => {
    expect(
      buildSessionWalletResolution({ selectedEvmWallet: null, selectedSolanaWallet: null }),
    ).toEqual({ source: "session", evm: null, solana: null });
  });
});
