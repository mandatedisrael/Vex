/**
 * Subagent prompt — variable layer, for child agent sessions.
 *
 * Delegated scope from parent, reports results back.
 * Respects allowTrades and parent loopMode.
 *
 * TODO(subagent-disabled): cała warstwa instruuje wywołanie
 * `subagent_report_complete` / `subagent_request_parent`, które są wypięte
 * z registry. Dla nowych sesji nieosiągalna (brak `subagent_spawn`); legacy
 * sesja z is_subagent=true zhydratowana z DB przez hydrate.ts dostanie tu
 * wiszącą referencję do disabled tooli — patrz Residual Risk w docs planu.
 */

import type { EngineContext } from "../types.js";

export interface SubagentContext {
  /** Task description from parent. */
  task: string;
  /** Whether this subagent is allowed to make trades. */
  allowTrades: boolean;
  /** Parent's loop mode — child cannot exceed parent. */
  parentLoopMode: string;
  /**
   * Snapshot of the parent session's rolling summary at the moment of spawn.
   * Copied by value, not referenced — later drift in the parent's summary does
   * not affect this child's briefing. Optional: if the parent has no summary
   * yet (early-session spawn) or memory scope is isolated and we want a clean
   * slate, this stays undefined and the block is omitted from the prompt.
   */
  parentSummarySnapshot?: string;
}

export function buildSubagentPrompt(
  _engineContext: EngineContext,
  subagentContext?: SubagentContext,
): string {
  const lines: string[] = [];

  lines.push("# Subagent Role");
  lines.push("");
  lines.push("You are a subagent — a child agent spawned by a parent to handle a delegated task.");
  lines.push("");

  lines.push("## Rules");
  lines.push("- Focus exclusively on your assigned task — do not deviate");
  lines.push("- Report your findings/results clearly — the parent will consume your output");
  lines.push("- You have a limited iteration budget — work efficiently");
  lines.push("- When your task is complete, call `subagent_report_complete`; do not finish with ordinary chat prose alone");
  lines.push("");

  if (subagentContext) {
    lines.push("## Assigned Task");
    lines.push(subagentContext.task);
    lines.push("");

    if (subagentContext.parentSummarySnapshot && subagentContext.parentSummarySnapshot.trim().length > 0) {
      lines.push("## Parent context (snapshot at spawn)");
      lines.push("This is a snapshot of the parent session's rolling summary at the moment you were spawned. Use it to understand the broader context, but focus on your assigned task.");
      lines.push("");
      lines.push(subagentContext.parentSummarySnapshot.trim());
      lines.push("");
    }

    if (!subagentContext.allowTrades) {
      lines.push("## Restriction: NO TRADES");
      lines.push("You are NOT allowed to execute mutating tools (swaps, bridges, transfers).");
      lines.push("You may only use read-only tools for research and analysis.");
      lines.push("");
    }

    lines.push(`Parent mode: ${subagentContext.parentLoopMode}`);
    lines.push("");
  }

  return lines.join("\n");
}
