/**
 * Memory v2 — candidate buffer bounded-vocabulary enums. The SINGLE SOURCE OF
 * TRUTH for the five bounded-vocab columns added to `memory_candidates` (S1b):
 * `proposed_by`, `sensitivity`, `evidence_strength`, `retrieval_visibility`,
 * `status`.
 *
 * NOT redefined here:
 * - `source` — candidates REUSE the `knowledge_entries` provenance vocabulary
 *   owned by `memory/long-memory-source-policy.ts` (`KNOWLEDGE_SOURCES` /
 *   `knowledgeSourceSchema`). Its CHECK is `mc_source_valid`.
 * - `kind` — open snake_case validated by the shared `isValidKind` regex at the
 *   Zod boundary (`memory-candidate.ts`), matching `knowledge_entries.kind`.
 *
 * LOCKSTEP CONTRACT (rules/20 §4): each `as const` tuple here is mirrored by a
 * named CHECK constraint in `db/migrations/001_initial.sql`
 * (`mc_proposed_by_valid` / `mc_sensitivity_valid` / `mc_evidence_strength_valid`
 * / `mc_retrieval_visibility_valid` / `mc_status_valid`). The drift guard in
 * `__tests__/vex-agent/memory/schema/memory-candidate-enums.test.ts` parses the
 * SQL CHECK value lists and asserts they equal BOTH these arrays AND the
 * matching `z.enum(...).options`, so SQL and TS can never silently diverge.
 *
 * Advisory-only doctrine (memory-system-v2 §6): candidates carry NO influence /
 * sizing / approval vocabulary. The forbidden execution-coupling values
 * (`execution_constraint`, `sizing_hint`) appear on neither this table nor these
 * enums — they were removed from the platform permanently.
 *
 * Pure module: `as const` tuples + Zod schemas + derived types. No DB, no I/O.
 */

import { z } from "zod";

// ── proposed_by ─────────────────────────────────────────────────
// Which agent role proposed the candidate. Locked in lockstep with the
// `mc_proposed_by_valid` DB CHECK (001_initial.sql). `"subagent"` is a
// dormant legal value retained for CHECK parity — the subagent subsystem
// was removed (S1b) and nothing writes it; narrowing this array requires
// a matching CHECK migration.
export const CANDIDATE_PROPOSED_BY = ["parent", "subagent"] as const;

export const candidateProposedBySchema = z.enum(CANDIDATE_PROPOSED_BY);
export type CandidateProposedBy = z.infer<typeof candidateProposedBySchema>;

// ── sensitivity ─────────────────────────────────────────────────
// System-derived handling tier. `sensitive` candidates get stricter retrieval /
// retention treatment downstream (S3/S4); `normal` is the default.
export const CANDIDATE_SENSITIVITY = ["normal", "sensitive"] as const;

export const candidateSensitivitySchema = z.enum(CANDIDATE_SENSITIVITY);
export type CandidateSensitivity = z.infer<typeof candidateSensitivitySchema>;

// ── evidence_strength ───────────────────────────────────────────
// How well-anchored the candidate is in immutable evidence (S5 deref). Ordered
// weakest → strongest; `none` is the default until evidence is dereferenced.
export const CANDIDATE_EVIDENCE_STRENGTH = [
  "none",
  "weak",
  "moderate",
  "strong",
] as const;

export const candidateEvidenceStrengthSchema = z.enum(CANDIDATE_EVIDENCE_STRENGTH);
export type CandidateEvidenceStrength = z.infer<typeof candidateEvidenceStrengthSchema>;

// ── retrieval_visibility ────────────────────────────────────────
// Dual-trace gate (memory-system-v2 §2 layer 5). A fresh candidate is
// `not_consolidated` (visible at lower weight before the manager consolidates);
// `suppressed` hides it from retrieval entirely. NEVER a hard execution gate.
export const CANDIDATE_RETRIEVAL_VISIBILITY = [
  "not_consolidated",
  "suppressed",
] as const;

export const candidateRetrievalVisibilitySchema = z.enum(CANDIDATE_RETRIEVAL_VISIBILITY);
export type CandidateRetrievalVisibility = z.infer<typeof candidateRetrievalVisibilitySchema>;

// ── status ──────────────────────────────────────────────────────
// Candidate lifecycle. `pending` is the write-buffer state; the async
// memory_manager (S4) DECIDES the terminal state. The partial unique index
// `uniq_mc_pending_hash` keys off `pending` for loop-prevention.
export const CANDIDATE_STATUS = [
  "pending",
  "promoted",
  "superseded",
  "merged",
  "rejected",
  "expired",
  "retained",
] as const;

export const candidateStatusSchema = z.enum(CANDIDATE_STATUS);
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;
