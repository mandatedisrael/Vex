/**
 * consolidateCandidate decision-pipeline unit tests — deterministic stage + judge
 * verdict → DecisionPlan mapping, fully stubbed IO (no DB, no real OpenRouter).
 *
 * Exercises the rubric→decision_type mapping and the calibration that the
 * judge's verdict carries straight into the plan (sourceTier, regimeTags), plus
 * the supersede target resolution.
 */

import { describe, it, expect } from "vitest";

import {
  consolidateCandidate,
  clampSourceTier,
  type ConsolidateDeps,
} from "@vex-agent/memory/manager/consolidate.js";
import type { JudgeVerdict } from "@vex-agent/memory/manager/judge-schema.js";
import { makeCandidate } from "./_fixtures.js";

const EMB = { embedding: [0, 0, 0, 0, 0, 0, 0, 1], embeddingModel: "test-model", embeddingDim: 8 };

function deps(overrides: Partial<ConsolidateDeps> = {}): ConsolidateDeps {
  return {
    recallKnowledge: async () => [],
    recallClusterAnchors: async () => [],
    exactDuplicateExists: async () => false,
    getExecutionSession: async () => ({ sessionId: "sess-1" }),
    isSessionSoftDeleted: async () => false,
    judge: async () => ({
      verdict: {
        verdict: "promote",
        rubric: { grounding: 3, durability: 3, novelty: 3, generalizability: 4, processNotOutcome: 4 },
        sourceTier: "observed",
        regimeTags: ["bull"],
      },
      llmCalls: 1,
      costUsd: 0.001,
    }),
    // S5: default to no resolvable outcome (S4-equivalent ceiling). Tests that
    // exercise the outcome-aware 'strong' path override this.
    resolveOutcome: async () => null,
    getExecutionTime: async () => ({ createdAt: new Date().toISOString() }),
    // S8: extraction stubbed to fail-open (null plan) — the seam tests override.
    buildGraphPlan: async () => null,
    inferenceProvider: "openrouter",
    inferenceModel: "test/model",
    ...overrides,
  };
}

/** Make the cluster carry 2 distinct executions so a generalization can promote. */
function twoExecCluster(): ConsolidateDeps["recallClusterAnchors"] {
  return async () => [[{ executionId: 5 }], [{ executionId: 6 }]];
}

describe("consolidateCandidate decision pipeline", () => {
  it("terminal-rejects on soft-deleted evidence WITHOUT calling the judge (D2)", async () => {
    let judgeCalled = false;
    const d = deps({
      isSessionSoftDeleted: async () => true,
      judge: async () => {
        judgeCalled = true;
        throw new Error("judge must not be called");
      },
    });
    const out = await consolidateCandidate(makeCandidate(), EMB, d);
    expect(out.plan).toEqual({ type: "reject", reason: "insufficient_evidence" });
    expect(judgeCalled).toBe(false);
    expect(out.llmCalls).toBe(0);
  });

  it("retains a generalization at recurrence n=1 WITHOUT the judge (D-REC)", async () => {
    const out = await consolidateCandidate(makeCandidate(), EMB, deps());
    // No cluster anchors → only the candidate's own execution → recurrence 1.
    expect(out.plan.type).toBe("retain");
    expect(out.llmCalls).toBe(0);
  });

  it("promotes a generalization at recurrence n>=2 carrying the judge's tier + regime", async () => {
    const out = await consolidateCandidate(
      makeCandidate(),
      EMB,
      deps({ recallClusterAnchors: twoExecCluster() }),
    );
    expect(out.plan.type).toBe("promote");
    if (out.plan.type === "promote") {
      expect(out.plan.sourceTier).toBe("observed");
      expect(out.plan.regimeTags).toEqual(["bull"]);
    }
    expect(out.llmCalls).toBe(1);
  });

  it("dedupes repeated valid regime tags in the plan (S6b canonicalization, not an error)", async () => {
    const out = await consolidateCandidate(
      makeCandidate(),
      EMB,
      deps({
        recallClusterAnchors: twoExecCluster(),
        judge: async () => ({
          verdict: {
            verdict: "promote",
            rubric: { grounding: 3, durability: 3, novelty: 3, generalizability: 4, processNotOutcome: 4 },
            sourceTier: "observed",
            regimeTags: ["bull", "bull", "high_vol"],
          },
          llmCalls: 1,
          costUsd: null,
        }),
      }),
    );
    expect(out.plan.type).toBe("promote");
    if (out.plan.type === "promote") {
      expect(out.plan.regimeTags).toEqual(["bull", "high_vol"]);
    }
  });

  it("maps a judge reject verdict to a reject plan with its reason", async () => {
    const verdict: JudgeVerdict = {
      verdict: "reject",
      rubric: { grounding: 1, durability: 1, novelty: 2, generalizability: 1, processNotOutcome: 3 },
      sourceTier: "hypothesis",
      regimeTags: [],
      rejectReason: "insufficient_evidence",
    };
    const out = await consolidateCandidate(
      makeCandidate(),
      EMB,
      deps({
        recallClusterAnchors: twoExecCluster(),
        judge: async () => ({ verdict, llmCalls: 1, costUsd: null }),
      }),
    );
    expect(out.plan).toEqual({ type: "reject", reason: "insufficient_evidence" });
  });

  it("downgrades a supersede verdict with no predecessor to retain (never blind supersede)", async () => {
    const verdict: JudgeVerdict = {
      verdict: "supersede",
      rubric: { grounding: 4, durability: 4, novelty: 3, generalizability: 3, processNotOutcome: 3 },
      sourceTier: "observed",
      regimeTags: [],
      // No previousKnowledgeId AND no deterministic conflict id.
      previousKnowledgeId: 0 as unknown as number, // schema would block; simulate missing via mapping
    };
    // Force the mapping path: judge returns supersede but with no usable id.
    const out = await consolidateCandidate(
      makeCandidate(),
      EMB,
      deps({
        recallClusterAnchors: twoExecCluster(),
        judge: async () => ({
          verdict: { ...verdict, previousKnowledgeId: undefined } as JudgeVerdict,
          llmCalls: 1,
          costUsd: null,
        }),
      }),
    );
    expect(out.plan.type).toBe("retain");
  });

  it("maps a supersede verdict to a supersede plan with the predecessor id", async () => {
    const verdict: JudgeVerdict = {
      verdict: "supersede",
      rubric: { grounding: 4, durability: 4, novelty: 3, generalizability: 3, processNotOutcome: 3 },
      sourceTier: "observed",
      regimeTags: [],
      previousKnowledgeId: 99,
    };
    const out = await consolidateCandidate(
      makeCandidate(),
      EMB,
      deps({
        recallClusterAnchors: twoExecCluster(),
        judge: async () => ({ verdict, llmCalls: 1, costUsd: null }),
      }),
    );
    expect(out.plan.type).toBe("supersede");
    if (out.plan.type === "supersede") expect(out.plan.previousKnowledgeId).toBe(99);
  });

  it("hard-clamps an over-claimed judge tier down to the grounding ceiling", async () => {
    // A non-generalization candidate with one existing anchor (recurrence 1) has a
    // 'weak' ceiling and escapes the D-REC retain gate, so it reaches the judge.
    // The default judge over-claims 'observed'; the clamp must lower it to 'inferred'.
    const out = await consolidateCandidate(makeCandidate({ kind: "market_note" }), EMB, deps());
    expect(out.plan.type).toBe("promote");
    if (out.plan.type === "promote") {
      expect(out.plan.sourceTier).toBe("inferred");
    }
  });
});

// ── S8 graph-extraction seam (F1: second LLM call ONLY on promote/supersede) ──

describe("consolidateCandidate — S8 graph-extraction seam", () => {
  const STUB_PLAN = { entities: [], links: [], edges: [] };

  it("calls buildGraphPlan exactly once on a promote plan, with the verdict's regimeTags", async () => {
    const calls: { candidateId: string; regimeTags: readonly string[] }[] = [];
    const candidate = makeCandidate();
    const out = await consolidateCandidate(
      candidate,
      EMB,
      deps({
        recallClusterAnchors: twoExecCluster(),
        buildGraphPlan: async (c, plan) => {
          calls.push({ candidateId: c.id, regimeTags: plan.regimeTags });
          return STUB_PLAN;
        },
      }),
    );
    expect(out.plan.type).toBe("promote");
    expect(calls).toEqual([{ candidateId: candidate.id, regimeTags: ["bull"] }]);
    expect(out.graphPlan).toBe(STUB_PLAN);
  });

  it("never calls buildGraphPlan on a deterministic terminal (retain at n=1 — F1: zero cost)", async () => {
    let called = false;
    const out = await consolidateCandidate(
      makeCandidate(),
      EMB,
      deps({
        buildGraphPlan: async () => {
          called = true;
          return STUB_PLAN;
        },
      }),
    );
    expect(out.plan.type).toBe("retain");
    expect(called).toBe(false);
    expect(out.graphPlan).toBeNull();
  });

  it("never calls buildGraphPlan on a judge reject", async () => {
    let called = false;
    const out = await consolidateCandidate(
      makeCandidate(),
      EMB,
      deps({
        recallClusterAnchors: twoExecCluster(),
        judge: async () => ({
          verdict: {
            verdict: "reject",
            rubric: { grounding: 1, durability: 1, novelty: 2, generalizability: 1, processNotOutcome: 3 },
            sourceTier: "hypothesis",
            regimeTags: [],
            rejectReason: "insufficient_evidence",
          },
          llmCalls: 1,
          costUsd: null,
        }),
        buildGraphPlan: async () => {
          called = true;
          return STUB_PLAN;
        },
      }),
    );
    expect(out.plan.type).toBe("reject");
    expect(called).toBe(false);
    expect(out.graphPlan).toBeNull();
  });

  it("carries a null graph plan on extraction fail-open — the promotion still proceeds", async () => {
    const out = await consolidateCandidate(
      makeCandidate(),
      EMB,
      deps({
        recallClusterAnchors: twoExecCluster(),
        // buildGraphPlan's CONTRACT is fail-open: any internal error → null.
        buildGraphPlan: async () => null,
      }),
    );
    expect(out.plan.type).toBe("promote");
    expect(out.graphPlan).toBeNull();
  });
});

describe("clampSourceTier — hard source-tier ceiling (§6 / D-GROUND)", () => {
  it("caps the evidence tiers by the grounding ceiling and only ever lowers", () => {
    // ceiling 'none' → max hypothesis
    expect(clampSourceTier("observed", "none")).toBe("hypothesis");
    expect(clampSourceTier("inferred", "none")).toBe("hypothesis");
    expect(clampSourceTier("hypothesis", "none")).toBe("hypothesis");
    // ceiling 'weak' → max inferred
    expect(clampSourceTier("observed", "weak")).toBe("inferred");
    expect(clampSourceTier("inferred", "weak")).toBe("inferred");
    expect(clampSourceTier("hypothesis", "weak")).toBe("hypothesis"); // never raises
    // ceiling 'moderate' → max observed (S4 never derives 'strong')
    expect(clampSourceTier("observed", "moderate")).toBe("observed");
    expect(clampSourceTier("inferred", "moderate")).toBe("inferred"); // never raises
    expect(clampSourceTier("hypothesis", "moderate")).toBe("hypothesis");
  });

  it("exempts user_confirmed from the evidence ceiling (the human is the verifier)", () => {
    expect(clampSourceTier("user_confirmed", "none")).toBe("user_confirmed");
    expect(clampSourceTier("user_confirmed", "weak")).toBe("user_confirmed");
    expect(clampSourceTier("user_confirmed", "moderate")).toBe("user_confirmed");
  });
});
