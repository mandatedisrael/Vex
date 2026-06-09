/**
 * Deterministic stage (S4 §6, D1–D11). The CHEAP pre-judge filter: rule-based,
 * no LLM. The FIRST terminal rule wins; if none fires the candidate ESCALATES to
 * the judge carrying the signals the rules computed (near-dup top-K, conflict
 * flag, evidence-strength ceiling, recurrence count, anchor existence).
 *
 * Pure decision core: this module takes ALREADY-COMPUTED inputs (live-state scan
 * result, the deref/recurrence outputs, the knowledge near-dup matches) and
 * returns a discriminated `DeterministicVerdict`. The IO (recall, deref) is done
 * by `consolidate.ts` and handed in — so the rule logic is unit-testable without
 * a DB or embeddings (rules/10 §3 functional core).
 *
 * NOTHING here promotes — promotion is the judge's exclusive authority (Fork C).
 * A deterministic terminal is always one of reject / expire / retain.
 */

import type { MemoryCandidate } from "@vex-agent/db/repos/memory-candidates/index.js";
import type { MemoryDecisionRejectReason } from "@vex-agent/memory/schema/memory-decision-enums.js";
import type { CandidateEvidenceStrength } from "@vex-agent/memory/schema/memory-candidate-enums.js";
import {
  CONFLICT_COSINE,
  LOW_CONFIDENCE_FLOOR,
  MUNDANE_IMPORTANCE_MAX,
  NEAR_DUP_COSINE,
  RECURRENCE_PROMOTE_MIN,
} from "@vex-agent/engine/memory-manager/policy.js";
import { isGeneralizationKind } from "./kind-families.js";

// ── Near-dup / conflict match shapes (computed by consolidate.ts) ──

/** A near-duplicate match against an ACTIVE knowledge entry (D4/D5/D6). */
export interface KnowledgeMatch {
  knowledgeId: number;
  kind: string;
  /** Cosine similarity in [0,1]. */
  similarity: number;
  /** The matched entry's title + summary, for the Graphiti number/date guardrail. */
  text: string;
}

// ── Verdict ─────────────────────────────────────────────────────────

/** Signals carried to the judge when no deterministic terminal fires. */
export interface EscalationSignals {
  nearDupTopK: readonly KnowledgeMatch[];
  conflictFlag: boolean;
  conflictKnowledgeId: number | null;
  evidenceStrengthCeiling: CandidateEvidenceStrength;
  recurrenceCount: number;
  anchorExists: boolean;
  isUserAffirmed: boolean;
  isGeneralization: boolean;
}

export type DeterministicVerdict =
  | {
      kind: "reject";
      reason: MemoryDecisionRejectReason;
      /**
       * S6a reinforcement seam: when a `duplicate` reject was caused by a match
       * against a SPECIFIC active knowledge entry (D5 near-dup), its id is carried
       * here so consolidate can reinforce that entry (2nd confirmation) instead of
       * dropping the candidate silently. D4 (exact content-hash dup) does NOT carry
       * an id — the matched row is resolved by content-hash in consolidate
       * (`findActiveByContentHash`). Absent for every non-duplicate reject.
       */
      reinforcesKnowledgeId?: number;
    }
  | { kind: "expire"; reason: MemoryDecisionRejectReason }
  | { kind: "retain"; reason: string }
  | { kind: "escalate"; signals: EscalationSignals };

// ── Inputs (everything is precomputed by consolidate.ts) ────────────

export interface DeterministicInput {
  candidate: MemoryCandidate;
  /** D1 — live-state re-scan rejected (≥ threshold) on the redacted aggregate. */
  liveStateRejected: boolean;
  /** D2 — an evidence anchor traces to a soft-deleted session (OD-3). */
  evidenceSoftDeleted: boolean;
  /** D3 — at least one evidence anchor (execution) still exists. */
  anchorExists: boolean;
  /** D3 ceiling — none|weak|moderate (NEVER strong in S4). */
  evidenceStrengthCeiling: CandidateEvidenceStrength;
  /** D4 — an EXACT content-hash duplicate already exists in knowledge_entries. */
  exactDuplicate: boolean;
  /** D5/D6 — near-dup matches against active knowledge (cosine-ordered desc). */
  knowledgeMatches: readonly KnowledgeMatch[];
  /** D7 — distinct-execution recurrence count across the cluster. */
  recurrenceCount: number;
  /** §6 — user affirmation present in the transcript (judge-derived tier hint). */
  isUserAffirmed: boolean;
  /** Evaluation clock (injectable for deterministic tests). */
  now?: Date;
}

// ── Number / date extraction for the Graphiti guardrail ─────────────

const NUMBER_RE = /\d+(?:[.,]\d+)?%?/g;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;

function extractTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.match(NUMBER_RE) ?? []) out.add(m.replace(",", "."));
  for (const m of text.match(DATE_RE) ?? []) out.add(m);
  return out;
}

/**
 * Graphiti guardrail (Fork D): two texts that DIFFER on a number, date, or
 * qualifier are NOT duplicates even at high cosine. Returns true iff the
 * candidate carries a number/date the matched entry does not (a meaningful
 * difference) — in which case near-dup MUST NOT reject.
 */
function differsOnNumberOrDate(candidateText: string, matchText: string): boolean {
  const candTokens = extractTokens(candidateText);
  if (candTokens.size === 0) return false;
  const matchTokens = extractTokens(matchText);
  for (const t of candTokens) {
    if (!matchTokens.has(t)) return true;
  }
  return false;
}

// ── Stage ───────────────────────────────────────────────────────────

/**
 * Run D1–D11. The FIRST terminal wins (live-state → stale-evidence → exact-dup →
 * near-dup → mundane → low-confidence → TTL); otherwise escalate with signals.
 * D3/D7 ceiling + recurrence and D6 conflict are computed regardless so they ride
 * along on the escalation signals.
 */
export function runDeterministicStage(input: DeterministicInput): DeterministicVerdict {
  const { candidate } = input;
  const now = input.now ?? new Date();
  const candidateText = `${candidate.title}\n${candidate.summary}`;
  const isGeneralization = isGeneralizationKind(candidate.kind);

  // D1 — live-state re-scan reject (defense-in-depth on the redacted aggregate).
  if (input.liveStateRejected) {
    return { kind: "reject", reason: "secret_or_live_state" };
  }

  // D2 — stale evidence (OD-3): an anchor's session is soft-deleted.
  if (input.evidenceSoftDeleted) {
    return { kind: "reject", reason: "insufficient_evidence" };
  }

  // D4 — exact content-hash duplicate vs knowledge.
  if (input.exactDuplicate) {
    return { kind: "reject", reason: "duplicate" };
  }

  // D6 — conflict flag: a same-kind active entry at cosine ≥ CONFLICT_COSINE that
  // carries a CONTRADICTING number/date. Flagged for the judge (supersede vs
  // reject); NOT a deterministic terminal. The first such match is the conflict
  // target. (A high-cosine match that differs on a number is NOT a near-dup —
  // see D5's guardrail — so it falls through to here / escalation.)
  let conflictFlag = false;
  let conflictKnowledgeId: number | null = null;
  for (const m of input.knowledgeMatches) {
    if (
      m.similarity >= CONFLICT_COSINE &&
      m.kind === candidate.kind &&
      differsOnNumberOrDate(candidateText, m.text)
    ) {
      conflictFlag = true;
      conflictKnowledgeId = m.knowledgeId;
      break;
    }
  }

  // D5 — near-dup (Fork D): max cosine ≥ NEAR_DUP_COSINE AND NOT differing on a
  // number/date/qualifier ⇒ duplicate. A high-cosine match that DOES differ on a
  // number/date is NOT a dup (it may be a conflict/supersede — escalated). The
  // matched entry id rides along (S6a) so consolidate can reinforce it (the
  // candidate is a 2nd confirmation of an existing active lesson).
  for (const m of input.knowledgeMatches) {
    if (m.similarity >= NEAR_DUP_COSINE && !differsOnNumberOrDate(candidateText, m.text)) {
      return { kind: "reject", reason: "duplicate", reinforcesKnowledgeId: m.knowledgeId };
    }
  }

  // D8 — mundane: low importance AND weak/none evidence → retain (recallable,
  // never lost; not worth long-term promotion).
  if (
    candidate.importance <= MUNDANE_IMPORTANCE_MAX &&
    (input.evidenceStrengthCeiling === "none" || input.evidenceStrengthCeiling === "weak")
  ) {
    return { kind: "retain", reason: "mundane" };
  }

  // D9 — low confidence: below the floor AND not a user-confirmed fact → retain
  // (reject only when evidence is ALSO 'none' — nothing to anchor it).
  if (
    candidate.confidence !== null &&
    candidate.confidence < LOW_CONFIDENCE_FLOOR &&
    !input.isUserAffirmed
  ) {
    if (input.evidenceStrengthCeiling === "none") {
      return { kind: "reject", reason: "low_confidence" };
    }
    return { kind: "retain", reason: "low_confidence" };
  }

  // D7 (gate) — a GENERALIZED lesson at recurrence < 2 retains (D-REC). A single
  // anchored fact (non-generalization kind) is exempt — it is judged on merit.
  if (isGeneralization && input.recurrenceCount < RECURRENCE_PROMOTE_MIN) {
    return { kind: "retain", reason: "premature_generalization" };
  }

  // D10 — TTL: past retain_until → expire.
  if (candidate.retainUntil !== null && new Date(candidate.retainUntil).getTime() < now.getTime()) {
    return { kind: "expire", reason: "expired_ttl" };
  }

  // D11 — status guard is handled by consolidate.ts BEFORE this stage runs (a
  // non-pending candidate is never re-judged; idempotent-close path). Reaching
  // here means pending + survived all terminals → escalate to the judge.
  return {
    kind: "escalate",
    signals: {
      nearDupTopK: input.knowledgeMatches,
      conflictFlag,
      conflictKnowledgeId,
      evidenceStrengthCeiling: input.evidenceStrengthCeiling,
      recurrenceCount: input.recurrenceCount,
      anchorExists: input.anchorExists,
      isUserAffirmed: input.isUserAffirmed,
      isGeneralization,
    },
  };
}
