/**
 * Production MCP — `ServerOptions.instructions` builder.
 *
 * Returns a short markdown preamble that the host MCP client surfaces to
 * its agent on initialize. Generated dynamically from the registry so the
 * surface size and protocol namespace count are always accurate.
 *
 * Tone: short, factual, points the model at the right resources for deeper
 * reading. NO long workflow text — that lives in `prompts.ts`.
 */

import { buildProtocolList } from "./registry-projection.js";
import {
  buildDirectToolRoutingLines,
  buildInstructionsSurfaceSummaryLine,
  buildMemoryPolicyLines,
  buildOnboardingReadOrderLines,
} from "./onboarding.js";

export function buildInstructions(): string {
  const memoryPolicyLines = buildMemoryPolicyLines();
  const namespaces = buildProtocolList();
  const namespaceGroups = namespaces
    .reduce<Array<{ label: string; lines: string[] }>>((groups, namespace) => {
      const currentGroup = groups.at(-1);
      // When the namespace has zero usable tools but its tools declare
      // `requiresEnv`, surface the missing env so the model knows what to set.
      // Partial gating is intentionally silent — the count is already correct.
      const envHint = namespace.activeToolCount === 0 && namespace.gatedByEnv.length > 0
        ? ` _(requires ${namespace.gatedByEnv.join(", ")} to enable)_`
        : "";
      const line =
        `- **\`${namespace.namespace}\`** — ${namespace.description} ` +
        `Use when: ${namespace.whenToUse} _(${namespace.activeToolCount} active tools)_${envHint}`;
      if (!currentGroup || currentGroup.label !== namespace.groupLabel) {
        groups.push({ label: namespace.groupLabel, lines: [line] });
        return groups;
      }
      currentGroup.lines.push(line);
      return groups;
    }, [])
    .map((group) => `### ${group.label}\n${group.lines.join("\n")}`)
    .join("\n\n");

  return `# EchoClaw MCP

EchoClaw MCP is a passive tool surface bridge over the EchoClaw stack.
${buildInstructionsSurfaceSummaryLine()}

## Start here

${buildOnboardingReadOrderLines().join("\n")}

## How to route tool calls

${buildDirectToolRoutingLines().join("\n")}
- Knowledge writes go to a shared local Postgres + pgvector store; entries
  written through this MCP are tagged \`source_surface = mcp_local\`.
- ${memoryPolicyLines[0]!.slice(2)}
- ${memoryPolicyLines[1]!.slice(2)}
- If Polymarket trading is gated by missing credentials, use
  \`polymarket_setup\` to derive local CLOB credentials instead of telling the
  user to manually edit \`POLYMARKET_API_KEY\`.
- Mutating tools (wallet_send_confirm, polymarket_setup, mutating protocol
  tools) execute directly. Your host (Claude Code / Cursor / Codex) is the
  approval gate — configure its permission policy to your risk tolerance.

## Where to look for more

- \`docs://overview\` — surface size, runtime, embedding model
- \`docs://tools\` — full internal tool catalog grouped by capability
- \`docs://protocols\` — namespace routing with \`Use when\` guidance
- \`docs://protocols/{namespace}\` — per-namespace tool manifests
- \`runtime://env\` — env presence flags (NOT values)
- \`surface://manifest\` — machine-readable JSON snapshot

## Active protocol namespaces

${namespaceGroups}

## What this server does NOT have

- No \`subagent_*\` tools (production MCP runs without background subagents)
- No \`schedule_*\` tools (cron lifecycle is owned by Echo Agent, not the host)
- No \`mission_*\` tools (MCP has no mission concept — those live in Echo Agent)
- No own approval queue (your MCP host's permission UX is the gate)
- No persistent loop / mode (this is a tool server, not an agent)
`;
}
