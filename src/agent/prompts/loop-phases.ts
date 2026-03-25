/**
 * Per-phase prompt templates for Echo Loop.
 *
 * Each phase gets a focused prompt — smaller than the full system prompt.
 * The agent's identity, memory, and skills are already in the system prompt
 * (loaded by buildSystemPrompt in tools.ts). These prompts provide
 * phase-specific instructions as user messages.
 */

import type { LoopPhase } from "../types.js";

const PHASE_PROMPTS: Record<LoopPhase, string> = {
  idle: "",

  sense: `[ECHO LOOP — SENSE PHASE]

Scan the current state. Be brief and factual:
1. Check portfolio balances across all active chains
2. Check open positions and their current P&L
3. Note any significant price movements or market events
4. Check if any scheduled tasks completed or alerts fired

If nothing significant changed since last cycle, respond with: [NO SIGNIFICANT CHANGES]

Focus on facts, not analysis. Save analysis for the next phase.`,

  assess: `[ECHO LOOP — ASSESS PHASE]

Based on the sense data above, evaluate:
1. Are there opportunities worth acting on?
2. Are any positions at risk and need attention?
3. Is there a mismatch between current portfolio and strategy?
4. Are there any urgent operational issues (low balance, failed operations)?

If there are no opportunities or risks, say so clearly.
Be concise — list findings, not essays.`,

  decide: `[ECHO LOOP — DECIDE PHASE]

Based on the assessment above, decide on specific actions:
1. List each action with clear parameters (token, amount, chain, direction)
2. Prioritize by urgency and expected value
3. If no action is warranted, respond with: [NO ACTION]

You have full tool access. If you decide to act, the next phase will execute.
Be decisive — don't hedge unnecessarily.`,

  execute: `[ECHO LOOP — EXECUTE PHASE]

Execute the decisions from the previous phase. For each action:
1. Use the appropriate tools
2. Wait for confirmation of execution
3. Note the result (success/failure, tx hash if applicable)

Execute all planned actions now.`,

  verify: `[ECHO LOOP — VERIFY PHASE]

Verify the results of executed actions:
1. Check that transactions were confirmed on-chain
2. Verify portfolio state matches expectations
3. Note any discrepancies

Be brief — just confirm success or flag issues.`,

  journal: `[ECHO LOOP — JOURNAL PHASE]

Record this cycle's activity:
1. Review any captured trades and enrich them if needed (use trade_log tool)
2. Save any important insights to memory (use memory_manage action=append)
3. Update any knowledge files if needed

Keep journal entries concise. Focus on decisions and outcomes, not process.`,

  sleep: "",
};

export function buildPhasePrompt(phase: LoopPhase, previousPhaseOutput?: string): string {
  const template = PHASE_PROMPTS[phase];
  if (!template) return "";

  if (previousPhaseOutput) {
    return `Previous phase output:\n${previousPhaseOutput}\n\n${template}`;
  }

  return template;
}

export function buildScheduledAlertPrompt(message: string): string {
  return `SCHEDULED ALERT CHECK: ${message}. Check if this condition is met and report.`;
}
