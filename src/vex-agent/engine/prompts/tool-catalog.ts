/**
 * Tool Map — the system-prompt-facing categorization of currently-visible
 * agent tools. Generated dynamically from the SAME filter chain used by
 * `getOpenAITools` so the LLM's tool catalog (the `tools` array on the
 * chat-completion call) and its mental map of "what can I call right now"
 * never drift.
 *
 * Rendering contract:
 *   - Categories listed in `TOOL_MAP_CATEGORIES` order (registry.ts) —
 *     order carries model-priority intent (orientation → reads → memory →
 *     compaction → knowledge → mutations → mission control).
 *   - Tool names within a category preserve their declared order — NOT
 *     alphabetized, because PR3's GREEN-LIGHT design treats ordering as
 *     intent ("read before write" within Wallet, etc).
 *   - Empty categories (every tool filtered out) are dropped — model
 *     should not see stale affordances.
 *   - At pressure barrier+, the dispatcher's hard-deny still backstops
 *     this projection; the Map is the soft signal, the deny is the runtime
 *     enforcement.
 *
 * The builder runs synchronously and is pure — its input is the
 * `ToolVisibilityContext` already computed in `runTurnLoop` for tool
 * projection. No DB, no async, no env reads beyond what `getVisibleToolDefs`
 * already performs internally.
 */

import { getVisibleToolsByCategory, type ToolVisibilityContext } from "../../tools/registry.js";

export function buildToolCatalogPrompt(ctx: ToolVisibilityContext): string {
  const categories = getVisibleToolsByCategory(ctx);
  if (categories.length === 0) {
    // No agent-surface tools visible (unlikely outside dormant-subagent
    // edge case). Suppress the section entirely rather than render an
    // empty heading — `buildPromptStack` already skips empty strings.
    return "";
  }

  const lines: string[] = [];
  lines.push("# Available Tool Map");
  lines.push("");
  for (const cat of categories) {
    lines.push(`**${cat.label}:** ${cat.toolNames.join(", ")}`);
  }
  return lines.join("\n");
}
