/**
 * Risk level — ActionKind → RiskLevel mapping coverage + pinning.
 *
 * Puzzle 5 phase 2 (2026-05-23). Codex GREEN LIGHT mapping pinned here so
 * a reclassification surfaces as a failed test id instead of silent
 * approval-policy drift.
 */

import { describe, it, expect } from "vitest";
import { ACTION_KINDS, type ActionKind } from "@vex-agent/tools/taxonomy.js";
import {
  RISK_LEVELS,
  type RiskLevel,
  riskLevelFromActionKind,
} from "@vex-agent/tools/risk-level.js";

describe("RiskLevel taxonomy — coverage", () => {
  it("RISK_LEVELS contains exactly 5 documented variants in severity order", () => {
    expect([...RISK_LEVELS]).toEqual([
      "info",
      "low",
      "medium",
      "high",
      "critical",
    ]);
  });

  it("riskLevelFromActionKind returns a RiskLevel for every ActionKind", () => {
    const validLevels = new Set<RiskLevel>(RISK_LEVELS);
    for (const kind of ACTION_KINDS) {
      const level = riskLevelFromActionKind(kind);
      expect(validLevels.has(level), `${kind} → ${level} not in RISK_LEVELS`).toBe(true);
    }
  });
});

describe("RiskLevel — pinned mappings (Codex GREEN LIGHT puzzle 5/2)", () => {
  const MAPPING: ReadonlyArray<readonly [ActionKind, RiskLevel]> = [
    ["read", "info"],
    ["local_write", "low"],
    ["schedule", "low"],
    ["approval_prepare", "medium"],
    ["external_post", "medium"],
    ["user_wallet_broadcast", "high"],
    ["destructive", "critical"],
  ];

  it.each(MAPPING)("%s → %s", (kind, expected) => {
    expect(riskLevelFromActionKind(kind)).toBe(expected);
  });

  it("approval_prepare is `medium` (signals incoming high-risk confirm — Codex Q1)", () => {
    // Pin the boundary case explicitly: approval_prepare itself does not
    // mutate, but it produces a prepared intent for a follow-up confirm
    // that almost always carries `user_wallet_broadcast` risk. Treating
    // it as `low` would understate the policy impact.
    expect(riskLevelFromActionKind("approval_prepare")).toBe("medium");
  });

  it("destructive is the only `critical` mapping in 1B-era taxonomy", () => {
    const criticals = ACTION_KINDS.filter((k) => riskLevelFromActionKind(k) === "critical");
    expect(criticals).toEqual(["destructive"]);
  });
});
