/**
 * Reconcile policy unit tests (S7 §4.3) — the pure F1 consequence map, the
 * semantic outcome delta, the quench math, the F2 tier-raise trigger +
 * upward-only clamp, and the verdict→final-action mapping. The 4×4 signal
 * matrix is pinned as EXPLICIT tables per status (the spec, not a re-derived
 * formula) so a future rule reorder is caught as a diff, never absorbed.
 */

import { describe, it, expect } from "vitest";

import {
  OUTCOME_QUENCH_ACTIVATION,
  outcomeDelta,
  consequenceFor,
  quenchedActivation,
  shouldConsultTierRaise,
  tierRaiseTarget,
  resolveFinalAction,
  reconcileVerdictSchema,
  type ReconcileConsequence,
  type ReconcileVerdict,
} from "@vex-agent/memory/manager/reconcile-policy.js";
import {
  DECAY_FLOOR,
  DECAY_TO_DECAYED_THRESHOLD,
} from "@vex-agent/memory/manager/maturity-policy.js";
import type {
  MemoryOutcomeSummary,
  OutcomeLessonSignal,
  OutcomeStatus,
} from "@vex-agent/memory/schema/memory-outcome.js";

function outcome(overrides: Partial<MemoryOutcomeSummary> = {}): MemoryOutcomeSummary {
  return {
    status: "open",
    lessonSignal: "neutral",
    evidenceQuality: "weak",
    pointInTimeChecked: true,
    outcomeComputedBy: "memory_manager",
    outcomeVersion: 0,
    needsReconciliation: true,
    pnlSource: "none",
    ...overrides,
  };
}

const SIGNALS: readonly OutcomeLessonSignal[] = ["positive", "negative", "mixed", "neutral"];

// ── Tunable invariants ────────────────────────────────────────────

describe("OUTCOME_QUENCH_ACTIVATION", () => {
  it("sits below the decayed-tier threshold and above the decay floor", () => {
    expect(OUTCOME_QUENCH_ACTIVATION).toBeLessThan(DECAY_TO_DECAYED_THRESHOLD);
    expect(OUTCOME_QUENCH_ACTIVATION).toBeGreaterThan(DECAY_FLOOR);
  });
});

// ── outcomeDelta (semantic compare) ───────────────────────────────

describe("outcomeDelta", () => {
  it("is unchanged for identical lesson-bearing fields", () => {
    expect(outcomeDelta(outcome(), outcome())).toBe("unchanged");
  });

  it("ignores version counters and audit stamps (no bookkeeping loop)", () => {
    const a = outcome();
    const b = outcome({
      outcomeVersion: 3,
      outcomeLastChangedAt: "2026-06-09T00:00:00.000Z",
      outcomeComputedBy: "deterministic_replay",
      pointInTimeChecked: false,
      productType: "spot",
    });
    expect(outcomeDelta(a, b)).toBe("unchanged");
  });

  it.each([
    ["status", outcome({ status: "closed" })],
    ["lessonSignal", outcome({ lessonSignal: "positive" })],
    ["evidenceQuality", outcome({ evidenceQuality: "strong" })],
    ["pnlSource", outcome({ pnlSource: "pnl_matches" })],
    ["needsReconciliation", outcome({ needsReconciliation: false })],
  ] as const)("flags a %s change", (_field, changed) => {
    expect(outcomeDelta(outcome(), changed)).toBe("changed");
  });

  it("treats absent pnlSource as 'none' and absent needsReconciliation as false", () => {
    const withDefaults = outcome({ pnlSource: "none", needsReconciliation: false });
    const { pnlSource: _p, needsReconciliation: _n, ...absent } = outcome();
    expect(outcomeDelta(withDefaults, absent)).toBe("unchanged");
  });
});

// ── consequenceFor (F1 ordered rules — explicit matrix tables) ────

type Kind = ReconcileConsequence["kind"];

function matrixAt(status: OutcomeStatus, table: Record<OutcomeLessonSignal, Record<OutcomeLessonSignal, Kind>>): void {
  for (const oldSignal of SIGNALS) {
    for (const newSignal of SIGNALS) {
      const got = consequenceFor(
        outcome({ lessonSignal: oldSignal }),
        outcome({ status, lessonSignal: newSignal }),
      );
      expect(got.kind, `${oldSignal}→${newSignal} @ ${status}`).toBe(table[oldSignal][newSignal]);
    }
  }
}

describe("consequenceFor — full 4×4 matrix per status", () => {
  it.each(["closed", "settled"] as const)("realized close (%s)", (status) => {
    matrixAt(status, {
      positive: { positive: "reinforce", negative: "flip_judge", mixed: "bookkeep", neutral: "bookkeep" },
      negative: { positive: "flip_judge", negative: "quench", mixed: "bookkeep", neutral: "bookkeep" },
      mixed: { positive: "reinforce", negative: "quench", mixed: "bookkeep", neutral: "bookkeep" },
      neutral: { positive: "reinforce", negative: "quench", mixed: "bookkeep", neutral: "bookkeep" },
    });
  });

  it("failed: quench territory; failed+positive is incoherent → bookkeep (flip still fires)", () => {
    matrixAt("failed", {
      positive: { positive: "bookkeep", negative: "flip_judge", mixed: "bookkeep", neutral: "bookkeep" },
      negative: { positive: "flip_judge", negative: "quench", mixed: "bookkeep", neutral: "bookkeep" },
      mixed: { positive: "bookkeep", negative: "quench", mixed: "bookkeep", neutral: "bookkeep" },
      neutral: { positive: "bookkeep", negative: "quench", mixed: "bookkeep", neutral: "bookkeep" },
    });
  });

  it.each(["open", "invalidated"] as const)(
    "non-terminal / %s: EVERY combination is the conservative bookkeep default",
    (status) => {
      const all: Record<OutcomeLessonSignal, Kind> = {
        positive: "bookkeep", negative: "bookkeep", mixed: "bookkeep", neutral: "bookkeep",
      };
      matrixAt(status, { positive: all, negative: all, mixed: all, neutral: all });
    },
  );

  it("ordered-rule exclusivity: a terminal flip NEVER resolves as reinforce/quench", () => {
    // Rule 1 must eat both flip directions BEFORE rules 2/3 can match.
    expect(
      consequenceFor(outcome({ lessonSignal: "negative" }), outcome({ status: "closed", lessonSignal: "positive" })).kind,
    ).toBe("flip_judge");
    expect(
      consequenceFor(outcome({ lessonSignal: "positive" }), outcome({ status: "settled", lessonSignal: "negative" })).kind,
    ).toBe("flip_judge");
  });
});

// ── quenchedActivation (rule 3 math) ──────────────────────────────

describe("quenchedActivation", () => {
  it("pushes a high activation down to the quench level", () => {
    expect(quenchedActivation(0.9)).toBe(OUTCOME_QUENCH_ACTIVATION);
  });

  it("never RAISES an already-suppressed activation back up to the quench level", () => {
    expect(quenchedActivation(0.1)).toBe(0.1);
  });

  it("repairs a sub-floor value UP to the floor (self-healing D-DECAY)", () => {
    expect(quenchedActivation(0.01)).toBe(DECAY_FLOOR);
    expect(quenchedActivation(0)).toBe(DECAY_FLOOR);
  });

  it("degrades non-finite input to the floor (never NaN into the DB)", () => {
    expect(quenchedActivation(Number.NaN)).toBe(DECAY_FLOOR);
    expect(quenchedActivation(Number.POSITIVE_INFINITY)).toBe(DECAY_FLOOR);
  });
});

// ── F2 tier-raise trigger + upward-only clamp ─────────────────────

describe("shouldConsultTierRaise", () => {
  it("fires ONLY at ceiling strong on a hypothesis/inferred entry", () => {
    expect(shouldConsultTierRaise("strong", "hypothesis")).toBe(true);
    expect(shouldConsultTierRaise("strong", "inferred")).toBe(true);
  });

  it("observed / user_confirmed entries never gain (no LLM call)", () => {
    expect(shouldConsultTierRaise("strong", "observed")).toBe(false);
    expect(shouldConsultTierRaise("strong", "user_confirmed")).toBe(false);
  });

  it.each(["none", "weak", "moderate"] as const)("ceiling %s never triggers", (ceiling) => {
    expect(shouldConsultTierRaise(ceiling, "hypothesis")).toBe(false);
    expect(shouldConsultTierRaise(ceiling, "inferred")).toBe(false);
  });
});

describe("tierRaiseTarget", () => {
  it("raises inferred → observed under a strong ceiling", () => {
    expect(tierRaiseTarget("inferred", "observed", "strong")).toBe("observed");
  });

  it("clamps the proposal to the evidence ceiling BEFORE applying (D-GROUND)", () => {
    // ceiling weak ⇒ max 'inferred': an 'observed' proposal on a hypothesis
    // entry lands as 'inferred', never out-claiming the evidence.
    expect(tierRaiseTarget("hypothesis", "observed", "weak")).toBe("inferred");
    // ceiling none ⇒ max 'hypothesis': nothing to raise for a hypothesis entry.
    expect(tierRaiseTarget("hypothesis", "observed", "none")).toBeNull();
  });

  it("applies UPWARD only — a downward / equal proposal is null", () => {
    expect(tierRaiseTarget("inferred", "hypothesis", "strong")).toBeNull();
    expect(tierRaiseTarget("inferred", "inferred", "strong")).toBeNull();
  });

  it("never raises an observed / user_confirmed entry and never without a proposal", () => {
    expect(tierRaiseTarget("observed", "observed", "strong")).toBeNull();
    expect(tierRaiseTarget("user_confirmed", "observed", "strong")).toBeNull();
    expect(tierRaiseTarget("hypothesis", undefined, "strong")).toBeNull();
  });
});

// ── resolveFinalAction (verdict applied directly, not via kind) ───

function verdict(action: ReconcileVerdict["action"]): ReconcileVerdict {
  return reconcileVerdictSchema.parse({ action, rationale: "structural why" });
}

describe("resolveFinalAction", () => {
  it("on a flip the verdict GOVERNS (invalidate / quench / retain)", () => {
    expect(resolveFinalAction({ kind: "flip_judge" }, verdict("invalidate"))).toBe("invalidate");
    expect(resolveFinalAction({ kind: "flip_judge" }, verdict("quench"))).toBe("quench");
    expect(resolveFinalAction({ kind: "flip_judge" }, verdict("retain"))).toBe("retain");
  });

  it("a flip WITHOUT a verdict is a programmer error → throws (never guesses)", () => {
    expect(() => resolveFinalAction({ kind: "flip_judge" }, null)).toThrow(/requires a judge verdict/);
  });

  it("a deterministic consequence executes its own kind — the judge's action is ignored (F2 tier-only consult)", () => {
    expect(resolveFinalAction({ kind: "reinforce" }, verdict("invalidate"))).toBe("reinforce");
    expect(resolveFinalAction({ kind: "quench" }, null)).toBe("quench");
    expect(resolveFinalAction({ kind: "bookkeep" }, verdict("retain"))).toBe("bookkeep");
  });
});
