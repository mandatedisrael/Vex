/**
 * Outcome-reconciliation policy (S7 §4.3) — pure decisions, no DB / I/O.
 * Owns the F1 deterministic consequence map: ordinary outcome changes are
 * resolved by MATH (profit reinforces, loss quenches, more data bumps + audits);
 * the LLM re-judge is consulted ONLY when the lesson signal FLIPS
 * (profit ↔ loss) or when a closed outcome makes a tier raise eligible (F2).
 *
 * D-OUTCOME-AWARE: the outcome is an EVENT applied here at reconcile time, not
 * a continuous decay modulation — between reconciles an `outcome_aware` entry
 * simply time-decays (maturity-policy.ts).
 *
 * Advisory-only (OD-1): every consequence touches activation / maturity /
 * status / provenance tier ONLY — never sizing, approval, or wallet flows.
 *
 * Rule construction (critique L2/L3): the consequence rules are ORDERED and the
 * 4×4 signal matrix is CLOSED by the bookkeep default — the first matching rule
 * wins, so every (old, new, status) combination maps to exactly one consequence
 * and a future signal/status addition falls into the conservative default
 * instead of an unhandled hole.
 */

import { z } from "zod";

import type { CandidateEvidenceStrength } from "@vex-agent/memory/schema/memory-candidate-enums.js";
import type {
  MemoryOutcomeSummary,
  OutcomeStatus,
} from "@vex-agent/memory/schema/memory-outcome.js";
import type { KnowledgeSource } from "@vex-agent/memory/long-memory-source-policy.js";
import { DECAY_FLOOR } from "./maturity-policy.js";
import { clampSourceTier } from "./consolidate.js";

// ── Tunables (D-CONST: tune empirically, do not freeze) ─────────────

/**
 * Activation a QUENCHED lesson is pushed down to (a realized loss resolved
 * against the lesson). Deliberately BELOW `DECAY_TO_DECAYED_THRESHOLD` (0.2) so
 * a quench normally tips the FSM to the `decayed` tier in the same step (the
 * ledger contradicted the lesson — it should lose influence immediately, not
 * over a half-life), and comfortably ABOVE `DECAY_FLOOR` (0.03) so the lesson
 * stays recallable and reactivatable (quench is suppression, never deletion —
 * D-DECAY). tune empirically, do not freeze.
 */
export const OUTCOME_QUENCH_ACTIVATION = 0.15;

// ── Outcome delta (semantic compare) ────────────────────────────────

export type OutcomeDelta = "unchanged" | "changed";

/**
 * Semantic outcome comparison. Only the LESSON-BEARING fields participate:
 * `status`, `lessonSignal`, `evidenceQuality`, `pnlSource` (absent ≡ 'none')
 * and `needsReconciliation` (absent ≡ false). Version counters / audit stamps
 * (`outcomeVersion`, `outcomeLastChangedAt`, `outcomeComputedBy`,
 * `pointInTimeChecked`, `productType`) are deliberately EXCLUDED — bookkeeping
 * churn is not a ledger fact change, and treating it as one would loop
 * (every reconcile bumps the version, which would mark the outcome "changed").
 */
export function outcomeDelta(
  oldOutcome: MemoryOutcomeSummary,
  newOutcome: MemoryOutcomeSummary,
): OutcomeDelta {
  const changed =
    oldOutcome.status !== newOutcome.status ||
    oldOutcome.lessonSignal !== newOutcome.lessonSignal ||
    oldOutcome.evidenceQuality !== newOutcome.evidenceQuality ||
    (oldOutcome.pnlSource ?? "none") !== (newOutcome.pnlSource ?? "none") ||
    (oldOutcome.needsReconciliation ?? false) !== (newOutcome.needsReconciliation ?? false);
  return changed ? "changed" : "unchanged";
}

// ── Consequence map (F1 — ordered rules, first match wins) ──────────

export type ReconcileConsequence =
  | { kind: "flip_judge" }
  | { kind: "reinforce" }
  | { kind: "quench" }
  | { kind: "bookkeep" };

/** Statuses on which a flipped signal is a SETTLED fact (rule 1). */
const FLIP_TERMINAL_STATUSES: ReadonlySet<OutcomeStatus> = new Set(["closed", "settled", "failed"]);

/** Statuses on which a positive signal is a REALIZED win (rule 2). */
const REINFORCE_STATUSES: ReadonlySet<OutcomeStatus> = new Set(["closed", "settled"]);

/**
 * Statuses on which a negative signal is a REALIZED loss (rule 3). `failed` is
 * included here but not in rule 2: a failed execution that resolves negative
 * still contradicts the lesson, while "failed + positive" is incoherent and
 * falls through to the conservative bookkeep default.
 */
const QUENCH_STATUSES: ReadonlySet<OutcomeStatus> = new Set(["closed", "settled", "failed"]);

/**
 * The F1 deterministic consequence for an outcome change. ORDERED — the first
 * matching rule wins:
 *
 *   1. FLIP → judge. The signal REVERSED (positive ↔ negative) and the new
 *      status is terminal: math cannot arbitrate a contradiction — the LLM
 *      re-judge sees old + new facts and rules invalidate/quench/retain.
 *   2. REINFORCE. New signal positive on a realized close (closed/settled).
 *      Rule 1 already consumed the negative→positive flip, so what lands here
 *      is mixed→positive, neutral→positive, or positive→positive (an open
 *      position confirming on close) — all genuine confirmations.
 *   3. QUENCH. New signal negative on closed/settled/failed. Rule 1 consumed
 *      positive→negative, so this is mixed/neutral→negative — a partially-wrong
 *      or signal-less lesson resolved by a realized loss goes quiet (F1 intent).
 *   4. BOOKKEEP (default — closes the matrix). Everything else: new signal
 *      mixed/neutral, non-terminal statuses, `invalidated` outcomes, quality-up
 *      without a signal change, needsReconciliation cleared. Version bump +
 *      audit + decision only; zero activation change (conservative).
 */
export function consequenceFor(
  oldOutcome: MemoryOutcomeSummary,
  newOutcome: MemoryOutcomeSummary,
): ReconcileConsequence {
  const flipped =
    (oldOutcome.lessonSignal === "positive" && newOutcome.lessonSignal === "negative") ||
    (oldOutcome.lessonSignal === "negative" && newOutcome.lessonSignal === "positive");
  if (flipped && FLIP_TERMINAL_STATUSES.has(newOutcome.status)) {
    return { kind: "flip_judge" };
  }
  if (newOutcome.lessonSignal === "positive" && REINFORCE_STATUSES.has(newOutcome.status)) {
    return { kind: "reinforce" };
  }
  if (newOutcome.lessonSignal === "negative" && QUENCH_STATUSES.has(newOutcome.status)) {
    return { kind: "quench" };
  }
  return { kind: "bookkeep" };
}

// ── Quench math (rule 3) ────────────────────────────────────────────

/**
 * Activation AFTER a quench: `max(DECAY_FLOOR, min(current, QUENCH))`. The min
 * never RAISES an already-suppressed lesson back up to the quench level; the
 * floor repairs a sub-floor value upward (D-DECAY is self-healing, mirroring
 * `decayEntry`). Non-finite input degrades to the floor (never NaN into the DB).
 */
export function quenchedActivation(current: number): number {
  const cur = Number.isFinite(current) ? current : DECAY_FLOOR;
  return Math.max(DECAY_FLOOR, Math.min(cur, OUTCOME_QUENCH_ACTIVATION));
}

// ── F2 tier-raise trigger (orthogonal to the consequence map) ───────

/**
 * Whether the re-judge is consulted about a PROVENANCE TIER raise (F2): the
 * NEW outcome's evidence ceiling reached `strong` (closed + strong quality +
 * point-in-time clean — `deriveEvidenceStrengthCeiling`) AND the entry still
 * sits on a sub-observed tier. `observed` / `user_confirmed` entries never gain
 * (nothing above them is evidence-reachable) → no LLM call for them.
 */
export function shouldConsultTierRaise(
  ceiling: CandidateEvidenceStrength,
  entrySource: KnowledgeSource,
): boolean {
  return ceiling === "strong" && (entrySource === "hypothesis" || entrySource === "inferred");
}

/**
 * Rank for the UPWARD-ONLY tier-raise compare. `user_confirmed` is deliberately
 * absent: the reconcile judge rules from LEDGER FACTS only and can never mint a
 * user affirmation (its verdict schema excludes the tier entirely), and an
 * entry already AT `user_confirmed` is never raised (the human-verified tier is
 * not evidence-upgradable).
 */
const TIER_RAISE_RANK: Record<Exclude<KnowledgeSource, "user_confirmed">, number> = {
  hypothesis: 0,
  inferred: 1,
  observed: 2,
};

/**
 * Resolve the judge's proposed tier into a concrete UPWARD raise, or null when
 * nothing should change. Hard order: clamp to the evidence ceiling first
 * (`clampSourceTier`, S4 D-GROUND — the LLM never out-claims the evidence),
 * then apply ONLY upward (a verdict can never demote provenance — invalidate /
 * quench are the demotion paths). A current tier of `observed`/`user_confirmed`
 * always yields null (F2: only hypothesis/inferred entries gain).
 */
export function tierRaiseTarget(
  currentSource: KnowledgeSource,
  proposed: Exclude<KnowledgeSource, "user_confirmed"> | undefined,
  ceiling: CandidateEvidenceStrength,
): KnowledgeSource | null {
  if (proposed === undefined) return null;
  if (currentSource === "observed" || currentSource === "user_confirmed") return null;
  const clamped = clampSourceTier(proposed, ceiling);
  if (clamped === "user_confirmed") return null; // unreachable (schema excludes it); fail-closed
  return TIER_RAISE_RANK[clamped] > TIER_RAISE_RANK[currentSource] ? clamped : null;
}

// ── Reconcile-judge verdict (Zod boundary — owned by the POLICY) ─────

/**
 * Max length of the judge's structural rationale. Mirrors
 * `MATURITY_RATIONALE_MAX` (knowledge-maturity-event.ts); the rationale is
 * stored on `knowledge_entries.status_reason` for an invalidate and is NEVER
 * logged (memLog allowlists no free-text key).
 */
export const RECONCILE_RATIONALE_MAX = 500;

/**
 * The three actions the reconcile judge may rule on a FLIP (§4.4). Deliberately
 * NO `supersede`/content-bearing verdict: the judge has no candidate to write,
 * and FIX-4 keeps promote as the ONLY content path into knowledge — a
 * contradicted lesson is `invalidate`d (bi-temporal honesty), never rewritten.
 */
export const RECONCILE_VERDICT_ACTIONS = ["invalidate", "quench", "retain"] as const;

/**
 * Tiers the judge may PROPOSE for an F2 raise. `user_confirmed` is excluded
 * from the vocabulary itself: the reconcile judge rules from LEDGER FACTS only
 * and can never mint a user affirmation. The `satisfies` clause keeps the
 * tuple in lockstep with `KNOWLEDGE_SOURCES` at compile time.
 */
export const RECONCILE_TIER_PROPOSALS = [
  "observed",
  "inferred",
  "hypothesis",
] as const satisfies readonly Exclude<KnowledgeSource, "user_confirmed">[];

/**
 * The reconcile judge's verdict (§4.4). This schema lives in the POLICY module
 * (not the judge) so the dependency points imperative-shell → functional-core:
 * `reconcile-judge.ts` (LLM IO) imports the contract from here, and the pure
 * verdict→action mapping below never depends on an IO module. `.strict()`
 * rejects any unknown key; an action outside the enum fails the parse — the
 * judge call THROWS and the job retries (fail-closed, never a guessed action).
 * `sourceTier` is optional at EVERY action (F2 is orthogonal to the flip
 * ruling) and is clamped + upward-only-applied via `tierRaiseTarget`.
 */
export const reconcileVerdictSchema = z
  .object({
    action: z.enum(RECONCILE_VERDICT_ACTIONS),
    sourceTier: z.enum(RECONCILE_TIER_PROPOSALS).optional(),
    rationale: z.string().max(RECONCILE_RATIONALE_MAX),
  })
  .strict();

export type ReconcileVerdict = z.infer<typeof reconcileVerdictSchema>;

// ── Verdict → final action (critique L4: applied directly, not via kind) ─

/**
 * The action the reconcile tx executes (and the bounded `reconcileAction`
 * telemetry vocabulary, minus the orthogonal `tier_raise`). `retain` executes
 * exactly like `bookkeep` (version bump + audit only) but is logged distinctly
 * — it records that the JUDGE examined a flip and chose to keep the lesson.
 */
export type ReconcileAction = "reinforce" | "quench" | "invalidate" | "retain" | "bookkeep";

/**
 * Resolve the final action from the deterministic consequence + the (optional)
 * judge verdict. On a flip the verdict GOVERNS (invalidate / quench / retain
 * applied directly — never re-routed through the deterministic map); on a
 * deterministic consequence the judge — when consulted at all (F2) — rules ONLY
 * on the tier, so its action is ignored and the map's kind executes. A flip
 * without a verdict is a programmer error (the worker must consult the judge
 * before resolving) and throws rather than guessing.
 */
export function resolveFinalAction(
  consequence: ReconcileConsequence,
  verdict: ReconcileVerdict | null,
): ReconcileAction {
  switch (consequence.kind) {
    case "flip_judge": {
      if (verdict === null) {
        throw new Error("resolveFinalAction: flip_judge requires a judge verdict");
      }
      switch (verdict.action) {
        case "invalidate":
          return "invalidate";
        case "quench":
          return "quench";
        case "retain":
          return "retain";
        default: {
          const _exhaustive: never = verdict.action;
          return _exhaustive;
        }
      }
    }
    case "reinforce":
      return "reinforce";
    case "quench":
      return "quench";
    case "bookkeep":
      return "bookkeep";
    default: {
      const _exhaustive: never = consequence;
      return _exhaustive;
    }
  }
}
