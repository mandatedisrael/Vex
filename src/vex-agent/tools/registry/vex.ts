/**
 * Vex self-documentation tools — `vex_introduction` + `vex_namespace_tools`.
 *
 * Two curated entry-points the MCP host model uses to orient itself in the
 * Vex tool surface. Both are tagged `surface: "mcp"` because the Vex Agent
 * already gets this content via system prompt (`base.ts` + `tool-usage.ts` +
 * `protocols.ts`) — for the agent these tools would be redundant noise.
 * MCP hosts (Claude Code / Cursor / Codex) do not see the system prompt,
 * so they need these projections to find their way around.
 *
 * Registered FIRST in `registry.ts:TOOLS` so they sit at the top of the
 * MCP-visible list — strong prior toward calling them before issuing a
 * discover_tools.
 *
 * Both are pure projections over the registry / protocol catalog; no DB,
 * no embedding service, no side effects. They re-use `registry-projection.ts`
 * functions so the content stays in lockstep with `docs://*` resources
 * (single source of truth, no drift).
 */

import type { ToolDef } from "../types.js";

export const VEX_TOOLS: readonly ToolDef[] = [
  {
    name: "vex_introduction",
    kind: "internal",
    mutating: false,
    surface: "mcp",
    description:
      "Top-level orientation for Vex. Call with no args to get the priority brief — the five active protocol namespaces (polymarket, solana, khalani, kyberswap, dexscreener) and what each is for. Pass `topic` to focus on a single area: `overview` (architecture / dual product), `querying` (how to drive discover_tools), `knowledge` (long-term memory layer), or `namespaces` (full active-namespace list).",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: ["overview", "querying", "knowledge", "namespaces"],
          description:
            "Optional focus. Omit for the default protocol-priority brief.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "vex_namespace_tools",
    kind: "internal",
    mutating: false,
    surface: "mcp",
    description:
      "Deep dive into a protocol namespace: list every tool with its description and mutation flag. Pass `namespace` to focus on one (e.g. `polymarket`, `kyberswap`); omit to get a brief table of all active namespaces with tool counts. Deprecated namespaces refuse with a clear hint and a pointer at the env override.",
    parameters: {
      type: "object",
      properties: {
        namespace: {
          type: "string",
          description:
            "Optional protocol namespace to drill into. Use `vex_introduction({topic:'namespaces'})` first if unsure which is available.",
        },
      },
      additionalProperties: false,
    },
  },
];
