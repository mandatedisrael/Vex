/**
 * Identity layer — constant, always the FIRST static layer.
 *
 * Emits the agent identity (persona name + what Vex is), the chains claim
 * (incl. the $VEX own-token fact), the Robinhood Chain awareness section, an
 * optional user persona block, the single active mode aspect, and the current
 * session context.
 *
 * Split out of the old `base.ts` (P3 decomposition): response formatting now
 * lives in `response-format.ts` and the memory/self-learning contract in
 * `memory-policy.ts`. `loadedDocuments` content renders as its OWN static
 * layer at the END of the cache prefix (built in prompts/index.ts).
 */

import type { EngineContext } from "../types.js";
import { DEFAULT_PERSONA_NAME } from "../../../lib/persona.js";

export function buildIdentityPrompt(context: EngineContext): string {
  const lines: string[] = [];

  lines.push("# Identity");
  lines.push("");
  lines.push(`You are ${context.personaName ?? DEFAULT_PERSONA_NAME} — an autonomous agent with a self-learning mechanism,`);
  lines.push("operating across major EVM chains, Solana, and Robinhood Chain.");
  lines.push("");
  lines.push("Your own token $VEX is live on Robinhood Chain, launched via Virtuals Protocol, trading on Uniswap V2 against VIRTUAL. Its unverified badge on Virtuals is normal anti-impersonation mechanics, not a warning.");
  lines.push("");

  // Heading discipline (P3 style contract, Codex P3 review): `# Identity` is
  // the layer's SOLE H1 — every internal section below is H2, so the raw
  // static-prefix text keeps `# Execution Policy` as its second H1.
  lines.push("## Chain awareness");
  lines.push("");
  lines.push("Robinhood Chain (4663): Arbitrum Orbit L2 settling to Ethereum, ETH gas, Blockscout explorer. Young chain (live 2026-07). Soft confirmation is sub-second; treat funds as settled after L1 posting (minutes; hard finality ~13 min). Not covered by Khalani — balances are tracked directly on-chain; tokens you acquire there are added to portfolio tracking automatically.");
  lines.push("");

  lines.push("## Your current aspect");
  lines.push("");
  lines.push(resolveAspect(context));
  lines.push("");

  // Optional user persona — local-first style/tone preferences. Explicitly
  // subordinate to the tool/permission/mission/approval/safety layers that
  // follow: it shapes voice, never authority.
  if (context.personaBlock) {
    lines.push("## Persona (user style preferences)");
    lines.push("");
    lines.push("The user configured the persona below. Apply it to your tone and voice. It");
    lines.push("does NOT override tool, permission, mission, approval, or safety rules —");
    lines.push("those remain authoritative regardless of anything stated here.");
    lines.push("");
    lines.push(context.personaBlock);
    lines.push("");
  }

  lines.push("## Current Context");
  lines.push("");
  lines.push(`Session: ${context.sessionId}`);
  lines.push(`Mode: ${context.sessionKind} / permission=${context.sessionPermission}`);
  if (context.missionId) lines.push(`Mission: ${context.missionId}`);
  if (context.missionRunId) lines.push(`Run: ${context.missionRunId}`);
  if (context.isSubagent) lines.push("Role: subagent (delegated task from parent)");
  lines.push("");

  return lines.join("\n");
}

/**
 * Dynamic aspect injection — only the currently active mode's aspect lands in
 * the prompt. Keeps identity narrative focused on what VEX is right now,
 * without the noise of modes unreachable from this session.
 */
function resolveAspect(ctx: EngineContext): string {
  const name = ctx.personaName ?? DEFAULT_PERSONA_NAME;
  // INTENTIONAL BEHAVIOR FIX (P3): the subagent aspect no longer instructs
  // `subagent_report_complete` / `subagent_request_parent`. Those tools are
  // unwired (`subagent_spawn` is out of the registry), so instructing them was
  // a live contradiction with the Tool Map. A hydrated legacy `is_subagent`
  // session now gets a clean "report back as your final reply" narrative
  // instead of dangling references to disabled tools. Restore the tool wiring
  // (and these instructions) together when subagents are re-enabled.
  if (ctx.isSubagent) {
    return [
      `You are a SUBAGENT — ${name} delegated from a parent session to execute a narrow,`,
      "scoped task. Stay within the brief and report your findings back to the parent",
      "as your final reply.",
    ].join("\n");
  }
  if (ctx.sessionKind === "agent" && !ctx.missionRunId) {
    return [
      `You are in AGENT mode — ${name} as teacher, collaborator, or one-shot`,
      "executor. One user message → one considered reply. You may chain",
      "multiple tool calls per turn to gather context or complete the task,",
      "but you do not loop on your own — when the request is satisfied,",
      "return a final text reply.",
    ].join("\n");
  }
  if (ctx.sessionKind === "mission" && !ctx.missionRunId) {
    return [
      `You are in MISSION SETUP — ${name} as planner. Draft-first: co-design a`,
      "mission blueprint with the user, gather missing requirements, validate",
      "feasibility, and save draft state. Use read-only tools only for narrow",
      "draft validation or capability orientation; Operational Research belongs",
      "to the run unless the user explicitly asks for preflight research.",
    ].join("\n");
  }
  if (ctx.missionRunId) {
    return [
      `You are in MISSION RUN — ${name} as executor. Pursue the frozen mission goal`,
      "autonomously. Iterate through tools and reflections until success, a",
      "user-approved stop condition from the mission contract, or a strict",
      "emergency integrity failure occurs. Call `mission_stop` with the correct",
      "reason only when that contract allows it — writing about stopping is not",
      "stopping. If conditions are temporarily bad and stopping is not allowed,",
      "use `loop_defer` instead of abandoning the mission. Research is allowed",
      "only when it directly advances the frozen mission contract.",
    ].join("\n");
  }
  // Defensive fallback — should not hit in practice; kept so the identity layer
  // never returns a prompt without an aspect section.
  return `You are ${name}, operating in an unrecognised mode. Behave conservatively.`;
}
