/**
 * Protocol meta-tools — discover_tools + execute_tool.
 *
 * The two tools through which the LLM reaches all protocol capabilities
 * (everything not declared as an internal `kind: "internal"` tool here).
 */

import type { ToolDef, JsonSchema } from "../types.js";
import { buildDiscoverNamespaceDescription } from "../protocols/descriptions.js";

const EXECUTE_TOOL_PARAMS: JsonSchema = {
  type: "object",
  properties: {
    toolId: { type: "string", description: "Protocol tool ID from discover_tools" },
    params: { type: "object", description: "Tool parameters object" },
  },
  required: ["toolId", "params"],
};

export const PROTOCOL_TOOLS: readonly ToolDef[] = [
  {
    name: "discover_tools", kind: "internal", mutating: false,
    description: "Search protocol capabilities using a short English capability phrase. Query should be a compact English intent like: 'buy token on solana', 'bridge usdc to base', 'prediction market orderbook', 'wallet token balances'. Returns the best matching protocol tools for use with execute_tool.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Short English capability phrase (e.g. 'bridge usdc to base', 'swap on solana', 'prediction market orderbook'). Translate the user's intent to English before calling — the retrieval surface is English-only." },
      namespace: { type: "string", description: buildDiscoverNamespaceDescription() },
      includeMutating: { type: "boolean", description: "Include mutating/trading capabilities" },
      limit: { type: "number", description: "Max tools to return (default: 5)" },
    } },
  },
  {
    name: "execute_tool", kind: "internal", mutating: false,
    description: "Execute a discovered protocol tool by toolId with structured params. Mutating tools require approval in restricted/off mode.",
    parameters: EXECUTE_TOOL_PARAMS,
  },
];
