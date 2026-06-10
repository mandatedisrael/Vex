/**
 * Reconcile re-judge call (S7 §4.4). Mirrors `judge.ts` (S4): the SAME
 * env-driven OpenRouter provider, on-demand so a settings change after restart
 * picks up the new model; provider INJECTABLE so tests stub it.
 *
 * Consulted ONLY when math cannot arbitrate (F1): the lesson signal FLIPPED
 * (profit ↔ loss, terminal status) — the judge rules invalidate/quench/retain —
 * or a closed outcome made an F2 tier raise eligible (ceiling `strong` on a
 * hypothesis/inferred entry) — the judge rules ONLY on `sourceTier` and the
 * deterministic consequence still executes. The verdict contract
 * (`reconcileVerdictSchema`) is owned by `reconcile-policy.ts` (functional
 * core); this module is the imperative shell around it.
 *
 * Context discipline: the judge sees the lesson header (title/summary/kind/
 * tier) + the OLD and NEW `MemoryOutcomeSummary` — which by construction carry
 * NO raw monetary values (memory-outcome.ts doctrine). Never transcripts,
 * never live state, never amounts.
 *
 * Sequence: `loadConfig()` → race(chatCompletionSimple, timeout) →
 * `indexOf('{')…lastIndexOf('}')` → `JSON.parse` → `safeParse`. On ANY
 * malformed step it THROWS (never returns a fabricated verdict) so the
 * reconcile job fails and retries (fail-closed, §4.4).
 */

import { z } from "zod";

import { JUDGE_TIMEOUT_MS } from "@vex-agent/engine/memory-manager/policy.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import type { MemoryOutcomeSummary } from "@vex-agent/memory/schema/memory-outcome.js";
import type { KnowledgeSource } from "@vex-agent/memory/long-memory-source-policy.js";
import type { JudgeProvider } from "./judge.js";
import {
  reconcileVerdictSchema,
  type ReconcileVerdict,
} from "./reconcile-policy.js";

// ── Context (bounded; no amounts, no transcripts) ───────────────────

/**
 * What the reconcile judge is asked to rule on. At least one flag is true at
 * every call site (the worker never consults the judge otherwise):
 *   - `flip` — the lesson signal reversed on a terminal status; the `action`
 *     governs (invalidate / quench / retain).
 *   - `tierRaiseEligible` — F2: the NEW outcome's evidence ceiling reached
 *     `strong` and the entry sits on a sub-observed tier; `sourceTier` (if
 *     proposed) is clamped + applied upward-only. When `flip` is false the
 *     returned `action` is IGNORED (the deterministic consequence executes).
 */
export interface ReconcileJudgeContext {
  lesson: {
    title: string;
    summary: string;
    kind: string;
    /** The entry's CURRENT provenance tier (`knowledge_entries.source`). */
    sourceTier: KnowledgeSource;
  };
  oldOutcome: MemoryOutcomeSummary;
  newOutcome: MemoryOutcomeSummary;
  flip: boolean;
  tierRaiseEligible: boolean;
}

export interface ReconcileJudgeResult {
  verdict: ReconcileVerdict;
  /** LLM calls made (always 1 on success) — drives bumpJobInference. */
  llmCalls: number;
  /** Cost in USD if the provider reported it, else null. */
  costUsd: number | null;
}

/**
 * Default provider factory — the env-driven OpenRouter provider (judge.ts
 * precedent). The constructor THROWS when OPENROUTER_API_KEY / AGENT_MODEL are
 * absent (the executor's pre-claim gate prevents reaching here without them).
 */
async function defaultProvider(): Promise<JudgeProvider> {
  const { OpenRouterProvider } = await import("@vex-agent/inference/openrouter.js");
  return new OpenRouterProvider();
}

const costShape = z.object({ usage: z.object({ cost: z.number().nullable().optional() }).optional() });

// ── Prompts ──────────────────────────────────────────────────────────

const OUTPUT_CONTRACT = [
  "Output STRICT JSON only, no prose, this exact shape:",
  '{ "action": "invalidate|quench|retain", "sourceTier": "observed|inferred|hypothesis" (optional), "rationale": "<short structural why, max 500 chars>" }',
].join("\n");

const ACTION_RULES = [
  "Choose ONE action (only meaningful when the signal FLIPPED; otherwise it is ignored):",
  "  invalidate  the new ledger facts CONTRADICT the lesson's core claim — the lesson is wrong, retire it (it stops being recalled).",
  "  quench      the lesson is not disproven but the realized outcome argues against it — suppress its influence (it stays recallable).",
  "  retain      the flip does not actually bear on the lesson's claim (e.g. the lesson is about process, the loss was unrelated) — keep it as-is.",
  "Default-deny ordering: prefer quench over retain when uncertain; invalidate ONLY when the contradiction is direct.",
].join("\n");

const TIER_RULES = [
  "TIER (only when asked, i.e. tierRaiseEligible):",
  "- You may propose sourceTier to PROMOTE the lesson's provenance after the outcome closed with full data (e.g. inferred -> observed).",
  "- Propose a raise ONLY from facts in the outcomes shown. Never 'user_confirmed' (you cannot mint a user affirmation). A proposal is clamped to the evidence ceiling and applied upward-only — when in doubt, omit it.",
].join("\n");

export function buildReconcileJudgeSystemPrompt(): string {
  return [
    "You are the memory RECONCILER for an autonomous crypto agent. A previously-promoted lesson's trade outcome was re-resolved from the local ledger and CHANGED. You arbitrate what that change means for the lesson. Memory is ADVISORY only — your ruling never controls execution, sizing, or approvals.",
    "You see the lesson header and the OLD vs NEW system-derived outcome summaries (no raw amounts). You never see secrets or live values.",
    ACTION_RULES,
    TIER_RULES,
    OUTPUT_CONTRACT,
  ].join("\n\n");
}

/** One outcome summary as bounded prompt lines (enums only — no amounts exist on the type). */
function outcomeLines(label: string, o: MemoryOutcomeSummary): string {
  return [
    `${label}:`,
    `  status: ${o.status}`,
    `  lessonSignal: ${o.lessonSignal}`,
    `  evidenceQuality: ${o.evidenceQuality}`,
    `  pnlSource: ${o.pnlSource ?? "none"}`,
    `  needsReconciliation: ${o.needsReconciliation ?? false}`,
    `  pointInTimeChecked: ${o.pointInTimeChecked}`,
  ].join("\n");
}

export function buildReconcileJudgeUserPrompt(ctx: ReconcileJudgeContext): string {
  return [
    "LESSON:",
    `  kind: ${ctx.lesson.kind}`,
    `  sourceTier: ${ctx.lesson.sourceTier}`,
    `  title: ${ctx.lesson.title}`,
    `  summary: ${ctx.lesson.summary}`,
    "",
    outcomeLines("OLD OUTCOME", ctx.oldOutcome),
    "",
    outcomeLines("NEW OUTCOME", ctx.newOutcome),
    "",
    `signalFlipped: ${ctx.flip}`,
    `tierRaiseEligible: ${ctx.tierRaiseEligible}`,
    "",
    "Return your ruling as strict JSON.",
  ].join("\n");
}

// ── Call ─────────────────────────────────────────────────────────────

/**
 * Call the reconcile judge for ONE entry. THROWS on missing config, timeout,
 * malformed JSON, or schema failure (incl. an action outside the enum) — the
 * caller fails the job and it retries. Never returns a fabricated verdict.
 */
export async function callReconcileJudge(
  ctx: ReconcileJudgeContext,
  makeProvider: () => Promise<JudgeProvider> = defaultProvider,
): Promise<ReconcileJudgeResult> {
  const provider = await makeProvider();
  const config = await provider.loadConfig();
  if (!config) {
    memLog.warn("reconcile", "config_load_failed");
    throw new Error("memory_reconcile_judge_provider_config_load_failed");
  }

  const response = await Promise.race([
    provider.chatCompletionSimple(
      [
        { role: "system", content: buildReconcileJudgeSystemPrompt() },
        { role: "user", content: buildReconcileJudgeUserPrompt(ctx) },
      ],
      config,
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("memory_reconcile_judge_timeout")), JUDGE_TIMEOUT_MS),
    ),
  ]);

  const text = response.content?.trim() ?? "";
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    memLog.warn("reconcile", "judge_malformed");
    throw new Error(`memory_reconcile_judge_malformed_json: missing braces (len=${text.length})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch {
    memLog.warn("reconcile", "judge_malformed");
    throw new Error("memory_reconcile_judge_malformed_json: JSON.parse failed");
  }

  const validated = reconcileVerdictSchema.safeParse(parsed);
  if (!validated.success) {
    memLog.warn("reconcile", "judge_malformed");
    throw new Error(`memory_reconcile_judge_schema_invalid: ${validated.error.message}`);
  }

  // Cost is best-effort — a provider that does not report it yields null.
  const costParse = costShape.safeParse(response);
  const costUsd = costParse.success ? costParse.data.usage?.cost ?? null : null;

  memLog("reconcile", "judge_called", {
    decision: validated.data.action,
    llmCalls: 1,
    ...(costUsd !== null ? { costUsd } : {}),
  });

  return { verdict: validated.data, llmCalls: 1, costUsd };
}
