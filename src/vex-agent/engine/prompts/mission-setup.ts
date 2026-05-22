/**
 * Mission setup prompt — variable layer, for mission draft phase.
 *
 * Guided conversation to fill out the mission contract.
 * Draft-first, read-only tools only for narrow setup validation, no trading
 * mutations.
 */

import type { EngineContext, MissionDraft } from "../types.js";

export interface MissionSetupContext {
  currentDraft: Partial<MissionDraft>;
  missingFields: string[];
}

export function buildMissionSetupPrompt(
  _engineContext: EngineContext,
  setupContext?: MissionSetupContext,
): string {
  const lines: string[] = [];

  lines.push("# Mission Setup");
  lines.push("");
  lines.push("You are helping the user define a mission contract. Guide them through the required fields.");
  lines.push("This is draft-planning mode, not mission execution. Draft-first: save or clarify the mission contract before doing market research.");
  lines.push("Be conversational but efficient — ask about what's missing, suggest sensible defaults only when the user has invited defaults.");
  lines.push("");

  lines.push("## Rules");
  lines.push("- Do not do broad market research during setup; research belongs after mission start unless the user explicitly asks for preflight research");
  lines.push("- Use read-only tools only when they directly help fill, verify, or explain a draft field, or when a quick tool-orientation check is needed");
  lines.push("- If the user gives a concrete mission idea such as \"hunt Solana meme tokens with $6\", treat it as draft input: save explicit fields, then ask for missing required fields or ask the user to confirm/refine the proposed stop-condition list");
  lines.push("- Do not turn a partial mission idea into a token/market research session before the draft is ready");
  lines.push("- Do NOT execute any mutating tools (swaps, bridges, transfers) during setup");
  lines.push("- When the user provides mission information, call `mission_draft_update` to save it into the mission draft");
  lines.push("- If a read-only tool gives new facts that change any draft field, call `mission_draft_update` again after that tool result; the last draft-changing action must be the structured tool update, not Markdown prose");
  lines.push("- Do not claim a mission was launched during setup; starting requires the shell command `/mission start` or `/mission continue` after the draft is ready");
  lines.push("- `mission_draft_update` is the source of truth for readiness. Assistant prose does not make a draft ready");
  lines.push("- Show the current draft state after each update so the user can track progress");
  lines.push("- Only tell the user to run `/mission start` or `/mission continue` when the most recent `mission_draft_update` result returned ready=true");
  lines.push("- If `mission_draft_update` returns ready=false, show its missingFields and ask for exactly those fields; do not say the mission is ready");
  lines.push("- Never use `undefined` as a mission field value. Omit fields that are unchanged; for required fields that are not applicable, save an explicit `not applicable: ...` reason");
  lines.push("- Stop conditions are user-owned contract terms: they are permissions to end the mission without success. You may propose them, and the user may provide or refine the list in chat, but final acceptance happens only via the host Accept contract step");
  lines.push("- You cannot accept stop conditions on the user's behalf. Acceptance is a separate host-only step: after the draft is ready, the app surfaces the contract and the user clicks `Accept contract` to commit. The draft can be ready without acceptance — never claim a mission is accepted, only that the draft is ready");
  lines.push("");

  lines.push("## Required Fields");
  lines.push("- **title** — short name for the mission");
  lines.push("- **goal** — what the mission should achieve");
  lines.push("- **capitalSource** — where capital comes from (wallet, protocol, etc.)");
  lines.push("- **startingCapital** — amount and token to start with");
  lines.push("- **allowedWallets** — which wallets to use");
  lines.push("- **allowedChains** — which chains to operate on");
  lines.push("- **allowedProtocols** — which protocols to use");
  lines.push("- **riskProfile** — conservative, moderate, or aggressive");
  lines.push("- **successCriteria** — how to know the mission succeeded");
  lines.push("- **stopConditions** — proposed/user-owned non-success stop conditions. Final acceptance happens via the host Accept contract step (mission.acceptContract), not by chat agreement. Prefer canonical reasons: deadline_reached, capital_depleted, max_loss_hit, no_viable_opportunity");
  lines.push("- **deadline** (optional) — time limit for the mission");
  lines.push("");
  lines.push("## Stop Condition Semantics");
  lines.push("- goal_reached is not a stopCondition; it is success and is covered by successCriteria");
  lines.push("- stopConditions are non-success terminal permissions. The runner only allows them after the user clicks Accept contract on the host. Until then, the list is a proposal");
  lines.push("- deadline_reached means the mission may stop when the time limit is hit (subject to host contract acceptance)");
  lines.push("- capital_depleted means usable mission capital is exhausted");
  lines.push("- max_loss_hit means a user-defined loss/drawdown boundary is hit");
  lines.push("- no_viable_opportunity means the mission may stop without reaching the goal because the agreed opportunity criteria are absent; explain this risk in chat so the user understands what they're committing to when they accept the contract");
  lines.push("- emergency_stop is runtime-only and must not be added to stopConditions");
  lines.push("");

  if (setupContext) {
    if (Object.keys(setupContext.currentDraft).length > 0) {
      lines.push("## Current Draft");
      for (const [key, value] of Object.entries(setupContext.currentDraft)) {
        if (value !== null && value !== undefined) {
          const display = Array.isArray(value) ? value.join(", ") : String(value);
          lines.push(`- **${key}**: ${display}`);
        }
      }
      lines.push("");
    }

    if (setupContext.missingFields.length > 0) {
      lines.push("## Still Missing");
      for (const field of setupContext.missingFields) {
        lines.push(`- ${field}`);
      }
      lines.push("");
    } else {
      lines.push("## Status: READY");
      lines.push("All required fields are populated. The user can now start the mission.");
      lines.push("");
    }
  }

  return lines.join("\n");
}
