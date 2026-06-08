/**
 * Long-memory influence enums — the SINGLE SOURCE OF TRUTH for the three
 * bounded-vocabulary columns added to `knowledge_entries` in memory v2:
 * `maturity_state`, `influence_scope`, `decay_policy`.
 *
 * LOCKSTEP CONTRACT (rules/20 §4): each `as const` tuple here is mirrored by a
 * named CHECK constraint in `db/migrations/001_initial.sql`
 * (`ke_maturity_state_valid` / `ke_influence_scope_valid` /
 * `ke_decay_policy_valid`). The drift guard in
 * `__tests__/vex-agent/memory/schema/long-memory-enums.test.ts` parses the SQL
 * CHECK value lists and asserts they equal BOTH these arrays AND the matching
 * `z.enum(...).options`, so SQL and TS can never silently diverge.
 *
 * Pure module: `as const` tuples + Zod schemas + derived types. No DB, no I/O.
 */

import { z } from "zod";

// ── maturity_state ──────────────────────────────────────────────
// Lesson-confidence lifecycle axis — SEPARATE from `status` (lineage). A fresh
// promotion starts `probationary`; `established` is the legacy/default tier.
export const MATURITY_STATES = [
  "probationary",
  "established",
  "reinforced",
  "decayed",
] as const;

export const maturityStateSchema = z.enum(MATURITY_STATES);
export type MaturityState = z.infer<typeof maturityStateSchema>;

// ── influence_scope ─────────────────────────────────────────────
// Advisory-only by doctrine. `retrieval_boost` raises recall rank; neither value
// ever feeds execution / sizing / approval (OD-1; memory-poisoning guard).
// `execution_constraint` and `sizing_hint` are intentionally NOT modelled.
export const INFLUENCE_SCOPES = ["advisory", "retrieval_boost"] as const;

export const influenceScopeSchema = z.enum(INFLUENCE_SCOPES);
export type InfluenceScope = z.infer<typeof influenceScopeSchema>;

// ── decay_policy ────────────────────────────────────────────────
// How `activation_strength` erodes over time / regime / outcome. Applied by the
// memory-manager worker (S6); `none` is the legacy/default (no decay).
export const DECAY_POLICIES = [
  "none",
  "time",
  "regime_aware",
  "outcome_aware",
] as const;

export const decayPolicySchema = z.enum(DECAY_POLICIES);
export type DecayPolicy = z.infer<typeof decayPolicySchema>;
