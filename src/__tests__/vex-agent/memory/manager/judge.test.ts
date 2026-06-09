/**
 * LLM-judge call + verdict-schema unit tests. Uses a STUB provider that returns
 * a deterministic JudgeVerdict JSON string — the real OpenRouter is never called.
 */

import { describe, it, expect } from "vitest";

import { callJudge, type JudgeProvider } from "@vex-agent/memory/manager/judge.js";
import { judgeVerdictSchema } from "@vex-agent/memory/manager/judge-schema.js";
import type { JudgeContext } from "@vex-agent/memory/manager/context-builder.js";

function ctx(): JudgeContext {
  return {
    candidate: {
      kind: "strategy_lesson",
      title: "t",
      summary: "s",
      contentMd: "",
      importance: 7,
      confidence: 0.7,
    },
    transcript: "[user] I prefer to scale in slowly.",
    signals: {
      nearDupTopK: [],
      conflictFlag: false,
      conflictKnowledgeId: null,
      evidenceStrengthCeiling: "moderate",
      recurrenceCount: 2,
      anchorExists: true,
      isUserAffirmed: false,
      isGeneralization: true,
    },
    userAffirmationDetected: false,
  };
}

/** Build a stub provider that echoes a fixed content string. */
function stubProvider(content: string, costUsd: number | null = null): () => Promise<JudgeProvider> {
  return async () => ({
    loadConfig: async () => ({ model: "stub" }),
    chatCompletionSimple: async () => ({ content, usage: costUsd === null ? {} : { cost: costUsd } }),
  });
}

const PROMOTE_JSON = JSON.stringify({
  verdict: "promote",
  rubric: { grounding: 3, durability: 3, novelty: 3, generalizability: 4, processNotOutcome: 4 },
  sourceTier: "observed",
  regimeTags: ["bull"],
});

describe("judge call", () => {
  it("parses a well-formed verdict JSON", async () => {
    const res = await callJudge(ctx(), stubProvider(PROMOTE_JSON));
    expect(res.verdict.verdict).toBe("promote");
    expect(res.verdict.sourceTier).toBe("observed");
    expect(res.llmCalls).toBe(1);
  });

  it("extracts a JSON object embedded in surrounding prose", async () => {
    const wrapped = `Here is my verdict:\n${PROMOTE_JSON}\nThanks.`;
    const res = await callJudge(ctx(), stubProvider(wrapped));
    expect(res.verdict.verdict).toBe("promote");
  });

  it("throws (does not return-empty) when the response has no JSON braces", async () => {
    await expect(callJudge(ctx(), stubProvider("no json here"))).rejects.toThrow(/malformed/);
  });

  it("throws when the JSON is structurally invalid for the schema", async () => {
    const bad = JSON.stringify({ verdict: "promote", rubric: { grounding: 9 } });
    await expect(callJudge(ctx(), stubProvider(bad))).rejects.toThrow(/schema_invalid/);
  });

  it("throws when the provider config cannot load", async () => {
    const provider: () => Promise<JudgeProvider> = async () => ({
      loadConfig: async () => null,
      chatCompletionSimple: async () => ({ content: PROMOTE_JSON }),
    });
    await expect(callJudge(ctx(), provider)).rejects.toThrow(/config_load_failed/);
  });

  it("surfaces the provider-reported cost when present", async () => {
    const res = await callJudge(ctx(), stubProvider(PROMOTE_JSON, 0.0021));
    expect(res.costUsd).toBe(0.0021);
  });
});

describe("judge verdict schema", () => {
  it("accepts the five S4 verdicts and rejects merge", () => {
    expect(judgeVerdictSchema.safeParse(JSON.parse(PROMOTE_JSON)).success).toBe(true);
    const merge = { ...JSON.parse(PROMOTE_JSON), verdict: "merge" };
    expect(judgeVerdictSchema.safeParse(merge).success).toBe(false);
  });

  it("requires previousKnowledgeId on supersede", () => {
    const sup = {
      verdict: "supersede",
      rubric: { grounding: 4, durability: 4, novelty: 3, generalizability: 3, processNotOutcome: 3 },
      sourceTier: "observed",
    };
    expect(judgeVerdictSchema.safeParse(sup).success).toBe(false);
    expect(judgeVerdictSchema.safeParse({ ...sup, previousKnowledgeId: 5 }).success).toBe(true);
  });

  it("requires rejectReason on reject and expire", () => {
    const rej = {
      verdict: "reject",
      rubric: { grounding: 1, durability: 1, novelty: 2, generalizability: 1, processNotOutcome: 3 },
      sourceTier: "hypothesis",
    };
    expect(judgeVerdictSchema.safeParse(rej).success).toBe(false);
    expect(
      judgeVerdictSchema.safeParse({ ...rej, rejectReason: "insufficient_evidence" }).success,
    ).toBe(true);
  });

  it("rejects a sourceTier outside the knowledge-source vocabulary", () => {
    const bad = { ...JSON.parse(PROMOTE_JSON), sourceTier: "trusted" };
    expect(judgeVerdictSchema.safeParse(bad).success).toBe(false);
  });
});
