/**
 * Memory v2 — `recordDecision` boundary schema (S1c).
 *
 * `recordDecisionInputSchema` is the trusted, typed shape the async
 * memory_manager (S4) hands to the `memory_decisions` repo. It is NOT an
 * agent-facing surface (the agent never decides — FIX-3); it exists so the
 * one internal write path is validated and so the discriminated XOR mirrors the
 * DB CHECKs exactly.
 *
 * R3-MF3 / R6-MF2 — a discriminated union on `decisionType` enforces, at the
 * boundary, the same invariants the DB enforces via `md_anchor_xor` +
 * `md_reconcile_type` + `md_reconcile_fields` + `md_reject_reason_scope`:
 *   - `reconcile`                       ⇒ `reconcileEntryId` + `outcomeVersion`,
 *                                         NO `candidateId`, NO `rejectReason`.
 *   - `reject` | `expire`               ⇒ `candidateId` + `rejectReason`,
 *                                         NO reconcile fields.
 *   - `promote|supersede|merge|retain`  ⇒ `candidateId`, NO `rejectReason`,
 *                                         NO reconcile fields.
 * Each branch is `.strict()`, so a forbidden field (e.g. `outcomeVersion` on a
 * candidate decision, or `candidateId` on a reconcile) is rejected as an unknown
 * key — the XOR can never be violated.
 *
 * `decisionHash` (MF5) is NOT here: it is computed deterministically by the repo
 * from the decision's semantic payload (anchor id, version, decisionType, target
 * knowledge ids, rejectReason, canonicalized evidenceRefs) — see
 * `db/repos/memory-decisions/decision-hash.ts`. `evidenceRefs` REUSES
 * `evidenceRefsSchema` from `memory-candidate.ts` (FIX-1 immutable anchors).
 *
 * Pure module: Zod schemas + derived types. No DB, no I/O.
 */

import { z } from "zod";

import { evidenceRefsSchema } from "@vex-agent/memory/schema/memory-candidate.js";
import {
  memoryDecisionActorSchema,
  memoryDecisionRejectReasonSchema,
} from "@vex-agent/memory/schema/memory-decision-enums.js";

/** Max length of a stored inference provider / model name (names only, no secrets). */
export const DECISION_INFERENCE_NAME_MAX = 200;

/**
 * Fields shared by every decision branch. `jobId` is REQUIRED (every decision
 * traces to a job — `memory_decisions.job_id NOT NULL`). The knowledge-id
 * targets are the live outcome pointers (`promoted/supersedes/merge_target`),
 * optional on every branch. `decisionVersion` defaults to 0 (the initial
 * decision; the manager bumps it on each re-decision). `decidedBy` defaults to
 * `manager` (the DB column default); S7 reconcile passes `system` when the
 * deterministic consequence map decided without the LLM judge.
 */
const decisionBaseFields = {
  jobId: z.number().int().positive(),
  decisionVersion: z.number().int().min(0).default(0),
  decidedBy: memoryDecisionActorSchema.default("manager"),
  promotedKnowledgeId: z.number().int().positive().optional(),
  supersedesKnowledgeId: z.number().int().positive().optional(),
  mergeTargetKnowledgeId: z.number().int().positive().optional(),
  evidenceRefs: evidenceRefsSchema.default([]),
  inferenceProvider: z.string().min(1).max(DECISION_INFERENCE_NAME_MAX).optional(),
  inferenceModel: z.string().min(1).max(DECISION_INFERENCE_NAME_MAX).optional(),
  costUsd: z.number().nonnegative().optional(),
} as const;

/** promote / supersede / merge / retain — candidate anchor, no rejectReason. */
const candidateDecisionSchema = z
  .object({
    decisionType: z.enum(["promote", "supersede", "merge", "retain"]),
    candidateId: z.uuid(),
    ...decisionBaseFields,
  })
  .strict();

/** reject / expire — candidate anchor + required rejectReason. */
const candidateRejectDecisionSchema = z
  .object({
    decisionType: z.enum(["reject", "expire"]),
    candidateId: z.uuid(),
    rejectReason: memoryDecisionRejectReasonSchema,
    ...decisionBaseFields,
  })
  .strict();

/** reconcile — reconcile anchor + required outcomeVersion, no candidate. */
const reconcileDecisionSchema = z
  .object({
    decisionType: z.literal("reconcile"),
    reconcileEntryId: z.number().int().positive(),
    outcomeVersion: z.number().int().min(0),
    ...decisionBaseFields,
  })
  .strict();

export const recordDecisionInputSchema = z.discriminatedUnion("decisionType", [
  candidateDecisionSchema,
  candidateRejectDecisionSchema,
  reconcileDecisionSchema,
]);

/**
 * Caller-facing input (PRE-parse): `decisionVersion` / `evidenceRefs` are
 * optional here (the schema defaults them). `recordDecision` parses this with
 * `recordDecisionInputSchema` to validate the XOR + apply defaults.
 */
export type RecordDecisionInput = z.input<typeof recordDecisionInputSchema>;

/** Validated decision (POST-parse: XOR enforced, defaults applied). */
export type ParsedDecisionInput = z.output<typeof recordDecisionInputSchema>;
