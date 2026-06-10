/**
 * Reconcile-judge unit tests (S7 §4.4) — verdict schema strictness (the LLM
 * output contract is fail-closed: out-of-enum action, unknown key, over-long
 * rationale, or a user_confirmed tier proposal all THROW → job retry) and the
 * call wrapper with a STUB provider (the real OpenRouter is never called).
 */

import { describe, it, expect } from "vitest";

import {
  callReconcileJudge,
  buildReconcileJudgeUserPrompt,
  type ReconcileJudgeContext,
} from "@vex-agent/memory/manager/reconcile-judge.js";
import {
  RECONCILE_RATIONALE_MAX,
  reconcileVerdictSchema,
} from "@vex-agent/memory/manager/reconcile-policy.js";
import type { JudgeProvider } from "@vex-agent/memory/manager/judge.js";
import type { MemoryOutcomeSummary } from "@vex-agent/memory/schema/memory-outcome.js";

function outcome(overrides: Partial<MemoryOutcomeSummary> = {}): MemoryOutcomeSummary {
  return {
    status: "open",
    lessonSignal: "positive",
    evidenceQuality: "medium",
    pointInTimeChecked: true,
    outcomeComputedBy: "memory_manager",
    outcomeVersion: 0,
    needsReconciliation: true,
    pnlSource: "open_position",
    ...overrides,
  };
}

function ctx(): ReconcileJudgeContext {
  return {
    lesson: {
      title: "Paid boost plus buyer dominance signals a real chance",
      summary: "Boost + dominance + rising m5 volume preceded the entry.",
      kind: "strategy_lesson",
      sourceTier: "inferred",
    },
    oldOutcome: outcome(),
    newOutcome: outcome({ status: "closed", lessonSignal: "negative", evidenceQuality: "strong", pnlSource: "pnl_matches", needsReconciliation: false }),
    flip: true,
    tierRaiseEligible: true,
  };
}

/** Build a stub provider that echoes a fixed content string. */
function stubProvider(content: string, costUsd: number | null = null): () => Promise<JudgeProvider> {
  return async () => ({
    loadConfig: async () => ({ model: "stub" }),
    chatCompletionSimple: async () => ({ content, usage: costUsd === null ? {} : { cost: costUsd } }),
  });
}

const QUENCH_JSON = JSON.stringify({
  action: "quench",
  sourceTier: "observed",
  rationale: "The realized loss argues against the lesson but does not disprove the process claim.",
});

// ── Verdict schema (strict, bounded, fail-closed) ─────────────────

describe("reconcileVerdictSchema", () => {
  it("accepts the three actions, with and without a tier proposal", () => {
    for (const action of ["invalidate", "quench", "retain"]) {
      expect(reconcileVerdictSchema.safeParse({ action, rationale: "why" }).success).toBe(true);
    }
    expect(reconcileVerdictSchema.safeParse(JSON.parse(QUENCH_JSON)).success).toBe(true);
  });

  it("rejects an action outside the enum (no supersede/promote — FIX-4)", () => {
    for (const action of ["supersede", "promote", "delete", ""]) {
      expect(reconcileVerdictSchema.safeParse({ action, rationale: "why" }).success).toBe(false);
    }
  });

  it("rejects unknown keys (.strict())", () => {
    expect(
      reconcileVerdictSchema.safeParse({ action: "retain", rationale: "why", newContent: "rewritten lesson" }).success,
    ).toBe(false);
  });

  it("requires the rationale and bounds it at RECONCILE_RATIONALE_MAX", () => {
    expect(reconcileVerdictSchema.safeParse({ action: "retain" }).success).toBe(false);
    expect(
      reconcileVerdictSchema.safeParse({ action: "retain", rationale: "x".repeat(RECONCILE_RATIONALE_MAX) }).success,
    ).toBe(true);
    expect(
      reconcileVerdictSchema.safeParse({ action: "retain", rationale: "x".repeat(RECONCILE_RATIONALE_MAX + 1) }).success,
    ).toBe(false);
  });

  it("rejects a user_confirmed tier proposal (the judge cannot mint a user affirmation)", () => {
    expect(
      reconcileVerdictSchema.safeParse({ action: "retain", sourceTier: "user_confirmed", rationale: "why" }).success,
    ).toBe(false);
  });
});

// ── callReconcileJudge (stub provider) ────────────────────────────

describe("callReconcileJudge", () => {
  it("parses a well-formed verdict JSON", async () => {
    const res = await callReconcileJudge(ctx(), stubProvider(QUENCH_JSON));
    expect(res.verdict.action).toBe("quench");
    expect(res.verdict.sourceTier).toBe("observed");
    expect(res.llmCalls).toBe(1);
  });

  it("extracts a JSON object embedded in surrounding prose", async () => {
    const wrapped = `My ruling:\n${QUENCH_JSON}\nDone.`;
    const res = await callReconcileJudge(ctx(), stubProvider(wrapped));
    expect(res.verdict.action).toBe("quench");
  });

  it("throws when the response has no JSON braces", async () => {
    await expect(callReconcileJudge(ctx(), stubProvider("no json"))).rejects.toThrow(/malformed/);
  });

  it("throws when the action is outside the enum (schema fail-closed → retry)", async () => {
    const bad = JSON.stringify({ action: "supersede", rationale: "rewrite it" });
    await expect(callReconcileJudge(ctx(), stubProvider(bad))).rejects.toThrow(/schema_invalid/);
  });

  it("throws when the provider config cannot load", async () => {
    const provider: () => Promise<JudgeProvider> = async () => ({
      loadConfig: async () => null,
      chatCompletionSimple: async () => ({ content: QUENCH_JSON }),
    });
    await expect(callReconcileJudge(ctx(), provider)).rejects.toThrow(/config_load_failed/);
  });

  it("surfaces the provider-reported cost when present", async () => {
    const res = await callReconcileJudge(ctx(), stubProvider(QUENCH_JSON, 0.0017));
    expect(res.costUsd).toBe(0.0017);
  });
});

// ── Prompt content discipline ─────────────────────────────────────

describe("buildReconcileJudgeUserPrompt", () => {
  it("carries the lesson header + both outcome summaries and the consult flags", () => {
    const prompt = buildReconcileJudgeUserPrompt(ctx());
    expect(prompt).toContain("OLD OUTCOME");
    expect(prompt).toContain("NEW OUTCOME");
    expect(prompt).toContain("signalFlipped: true");
    expect(prompt).toContain("tierRaiseEligible: true");
    expect(prompt).toContain("sourceTier: inferred");
    // MemoryOutcomeSummary carries no raw monetary values by construction —
    // the prompt is enum/flag lines only (no $ amounts can appear).
    expect(prompt).not.toMatch(/\$\d/);
  });
});
