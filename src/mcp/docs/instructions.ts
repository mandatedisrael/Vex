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

import { buildOverview, buildProtocolList } from "./registry-projection.js";

export function buildInstructions(): string {
  const overview = buildOverview();
  const namespaces = buildProtocolList();
  // R5: render one-liner per namespace so the model knows what each does
  // before calling discover_tools. Description copy comes from
  // `tools/protocols/descriptions.ts` (shared with Echo Agent system prompt).
  const namespaceList = namespaces
    .map(
      (n) =>
        `- **\`${n.namespace}\`** — ${n.description} _(${n.activeToolCount} active tools)_`,
    )
    .join("\n");

  return `# EchoClaw MCP

EchoClaw MCP is a passive tool surface bridge over the EchoClaw stack. It
exposes ${overview.surfaceSize} internal tools (knowledge, documents, wallet,
portfolio, schedule, web, EVM, mission, setup) plus two meta tools for
protocol capabilities.

## How to use this server

- Call \`discover_tools\` to find protocol capabilities by query / namespace,
  then \`execute_tool\` to invoke them with structured params. There are
  ${overview.protocolNamespaceCount} protocol namespaces available — they are
  NOT individually surfaced as MCP tools to keep \`tools/list\` manageable.
- Internal tools (knowledge_*, document_*, wallet_*, portfolio_*, schedule_*,
  web_*, evm_*, mission_*) are surfaced individually with their real names —
  use them directly.
- Knowledge writes go to a shared local Postgres + pgvector store; entries
  written through this MCP are tagged \`source_surface = mcp_local\`.
- Mutating tools (wallet_send_confirm, polymarket_setup, mutating protocol
  tools) execute directly. Your host (Claude Code / Cursor / Codex) is the
  approval gate — configure its permission policy to your risk tolerance.

## Where to look for more

- \`docs://overview\` — surface size, runtime, embedding model
- \`docs://tools\` — full internal tool catalog grouped by capability
- \`docs://protocols\` — protocol namespace overview
- \`docs://protocols/{namespace}\` — per-namespace tool manifests
- \`surface://manifest\` — machine-readable JSON snapshot
- \`runtime://env\` — env presence flags (NOT values)

## Active protocol namespaces

${namespaceList}

## What this server does NOT have

- No \`subagent_*\` tools (production MCP runs without background subagents)
- No own approval queue (your MCP host's permission UX is the gate)
- No persistent loop / mode (this is a tool server, not an agent)
`;
}
