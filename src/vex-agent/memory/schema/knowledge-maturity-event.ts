/**
 * Maturity-event bounded-vocabulary enums (S6a). The SINGLE SOURCE OF TRUTH for
 * the closed-enum columns on `knowledge_maturity_events`: `event`, `reason_code`,
 * and `decided_by`. The `from_state`/`to_state` columns REUSE the maturity-state
 * vocabulary (`MATURITY_STATES` from `long-memory-enums.ts`) — they are NOT
 * redefined here.
 *
 * LOCKSTEP CONTRACT (rules/20 §4): each `as const` tuple here is mirrored by a
 * named CHECK constraint in `db/migrations/001_initial.sql` (`kme_event_valid` /
 * `kme_reason_code_valid` / `kme_decided_by_valid`; `kme_from_state_valid` /
 * `kme_to_state_valid` reuse the maturity-state vocab). The drift guard in
 * `__tests__/vex-agent/memory/schema/knowledge-maturity-event-enums.test.ts`
 * parses the SQL CHECK value lists and asserts they equal BOTH these arrays AND
 * the matching `z.enum(...).options`, so SQL and TS can never silently diverge.
 *
 * Doctrine (genesis §950-976 / s6-plan §1): a maturity event is an append-only
 * AUDIT record of a maturity/activation transition — it is never an
 * execution/sizing signal. `event` names the transition kind; `reason_code` is a
 * CLOSED cause vocabulary so an audit row carries no free-text; `decided_by` is
 * `system` (deterministic decay/reinforcement) or `manager` (the async curator) —
 * NEVER the agent (the agent does not mature or decay knowledge).
 *
 * Pure module: `as const` tuples + Zod schemas + derived types. No DB, no I/O.
 */

import { z } from "zod";

import { maturityStateSchema } from "@vex-agent/memory/schema/long-memory-enums.js";

// ── event (transition kind) ─────────────────────────────────────
// `matured`     — probationary → established / established → reinforced (a
//                 recurrence confirmation advanced the FSM one level).
// `reinforced`  — activation bumped on an existing entry whose maturity tier did
//                 NOT change (already at the top tier, or a same-tier reinforce).
// `decayed`     — time-decay eroded activation; the entry may have dropped to the
//                 `decayed` maturity tier (activation floored > 0, NEVER deleted).
// `reactivated` — a decayed entry was resurrected by a new confirmation
//                 (decayed → established; recurrence-driven in S6a, regime-driven
//                 in S6b).
export const MATURITY_EVENTS = [
  "matured",
  "reinforced",
  "decayed",
  "reactivated",
] as const;

export const maturityEventSchema = z.enum(MATURITY_EVENTS);
export type MaturityEvent = z.infer<typeof maturityEventSchema>;

// ── reason_code (cause vocabulary) ──────────────────────────────
// Closed so an audit row never carries free-text (no secret/monetary leak).
// `recurrence_confirmation` — a 2nd real confirmation at consolidation
//                             (reinforcement / reactivation; D-MATURE).
// `time_decay`              — elapsed time eroded activation (the S6a path; also
//                             the gated fallback for regime_aware/outcome_aware).
// `regime_decay`            — market-regime mismatch eroded activation (S6b).
// `outcome_change`          — an outcome reconciliation changed the lesson (S7).
export const MATURITY_REASON_CODES = [
  "recurrence_confirmation",
  "time_decay",
  "regime_decay",
  "outcome_change",
] as const;

export const maturityReasonCodeSchema = z.enum(MATURITY_REASON_CODES);
export type MaturityReasonCode = z.infer<typeof maturityReasonCodeSchema>;

// ── decided_by (actor) ──────────────────────────────────────────
// `system`  — a deterministic system path (the decay sweep, reinforcement at
//             consolidation). `manager` — the async memory_manager worker. NEVER
//             the agent: the agent never matures, decays, or reactivates knowledge.
export const MATURITY_DECIDED_BY = ["system", "manager"] as const;

export const maturityDecidedBySchema = z.enum(MATURITY_DECIDED_BY);
export type MaturityDecidedBy = z.infer<typeof maturityDecidedBySchema>;

// ── trigger_refs (structural pointer bag) ───────────────────────
// Strict pointer-only shape ({candidateId?, executionId?, regimeSnapshotId?}) —
// NEVER raw content. Mirrors the structural-anchor discipline of the audit
// tables (FIX-1): a maturity event points AT the thing that triggered it, it does
// not embed it. `.strict()` rejects any unknown key so free-text cannot slip in.
export const maturityTriggerRefsSchema = z
  .object({
    /** memory_candidates.id (UUID) — the confirming candidate at consolidation. */
    candidateId: z.uuid().optional(),
    /** protocol_executions.id — an immutable execution anchor (outcome-driven). */
    executionId: z.number().int().positive().optional(),
    /** regime_snapshots.id — the regime snapshot that drove a regime decay (S6b). */
    regimeSnapshotId: z.number().int().positive().optional(),
  })
  .strict();

export type MaturityTriggerRefs = z.infer<typeof maturityTriggerRefsSchema>;

// ── recordMaturityEvent input boundary ──────────────────────────
// The trusted, typed shape the maturity-manager hands the repo. NOT an
// agent-facing surface. `fromState`/`toState` reuse the maturity-state vocab so
// they can never diverge from the FSM. `rationale` is optional, length-bounded,
// and MUST be a short structural "why" — redaction is the caller's responsibility
// (the repo memLog never logs it; only enum/num meta is allowlisted).
export const MATURITY_RATIONALE_MAX = 500;

export const recordMaturityEventInputSchema = z
  .object({
    entryId: z.number().int().positive(),
    event: maturityEventSchema,
    fromState: maturityStateSchema,
    toState: maturityStateSchema,
    reasonCode: maturityReasonCodeSchema,
    activationBefore: z.number().min(0).max(1),
    activationAfter: z.number().min(0).max(1),
    triggerRefs: maturityTriggerRefsSchema.default({}),
    decidedBy: maturityDecidedBySchema.default("system"),
    rationale: z.string().max(MATURITY_RATIONALE_MAX).optional(),
  })
  .strict();

/** Caller-facing input (PRE-parse: `triggerRefs`/`decidedBy` defaulted). */
export type RecordMaturityEventInput = z.input<typeof recordMaturityEventInputSchema>;

/** Validated event (POST-parse: defaults applied). */
export type ParsedMaturityEventInput = z.output<typeof recordMaturityEventInputSchema>;
