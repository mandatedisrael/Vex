/**
 * Per-namespace metadata — descriptions and discover_tools example queries.
 *
 * Single source-of-truth shared by:
 *   - Echo Agent system prompt builder (`engine/prompts/protocols.ts`
 *     → `buildProtocolsPrompt()` → mission loop)
 *   - Production MCP server (`src/mcp/docs/registry-projection.ts`
 *     → `buildInstructions()` preamble + `docs://protocols` resource +
 *     `docs://protocols/{namespace}` per-namespace resource)
 *
 * The two consumers render this data differently (markdown for the engine
 * prompt stack, JSON for MCP resources, terse one-liners in the MCP
 * handshake preamble), but both must agree on what each namespace IS and
 * how to find tools in it. Keeping the data here, next to `catalog.ts`,
 * means adding a new protocol manifest forces a description in the same
 * directory — TypeScript enforces it via the exhaustive `Record` mapping.
 *
 * Why a separate file (and not catalog.ts)? `catalog.ts` is wired into
 * runtime tool execution (`PROTOCOL_TOOLS`, handler registry,
 * `getProtocolHandler`). Descriptions are documentation. Splitting them
 * keeps the runtime hot path independent of doc copy that might churn
 * (typo fixes, phrasing tweaks) and avoids invalidating the catalog
 * import graph for non-functional changes.
 */

import type { ProtocolNamespace } from "./types.js";

// ── Discovery examples ──────────────────────────────────────────
// Concrete `discover_tools` query strings the model can copy/paste to
// surface the most useful tools per namespace. Optional per-namespace —
// `0g-compute` and `0g-storage` are intentionally omitted because they
// have no active tools yet.

export const NAMESPACE_EXAMPLES: Partial<Record<ProtocolNamespace, readonly string[]>> = {
  khalani: [
    'discover_tools(query="token search", namespace="khalani")',
    'discover_tools(query="bridge quote", namespace="khalani")',
  ],
  dexscreener: [
    'discover_tools(query="trending pairs", namespace="dexscreener")',
    'discover_tools(query="token search", namespace="dexscreener")',
  ],
  solana: [
    'discover_tools(query="token search", namespace="solana")',
    'discover_tools(query="swap", namespace="solana")',
    'discover_tools(query="prediction markets", namespace="solana")',
  ],
  kyberswap: [
    'discover_tools(query="token search", namespace="kyberswap")',
    'discover_tools(query="swap", namespace="kyberswap")',
    'discover_tools(query="limit order", namespace="kyberswap")',
    'discover_tools(query="zap liquidity", namespace="kyberswap")',
  ],
  polymarket: [
    'discover_tools(query="prediction markets", namespace="polymarket")',
    'discover_tools(query="buy prediction", namespace="polymarket", includeMutating=true)',
  ],
  jaine: [
    'discover_tools(query="0g swap", namespace="jaine")',
  ],
  slop: [
    'discover_tools(query="bonding curve token", namespace="slop")',
  ],
  chainscan: [
    'discover_tools(query="0g transaction lookup", namespace="chainscan")',
  ],
  echobook: [
    'discover_tools(query="posts feed", namespace="echobook")',
    'discover_tools(query="notifications", namespace="echobook")',
  ],
  "slop-app": [
    'discover_tools(query="profile", namespace="slop-app")',
  ],
};

// ── Namespace descriptions ──────────────────────────────────────
// Exhaustive map keyed by `ProtocolNamespace`. Adding a new namespace
// to `PROTOCOL_NAMESPACE_ALLOWLIST` (in `catalog.ts`) without adding
// an entry here is a TypeScript error — that is the point.

export const NAMESPACE_DESCRIPTIONS: Record<ProtocolNamespace, string> = {
  khalani:
    "Cross-chain balances, token discovery, bridge quotes and execution (40+ chains). " +
    "Resolve tokens via khalani.tokens.search before bridge/quote",
  dexscreener:
    "DEX analytics, trending pairs, token profiles, price research",
  solana:
    "Jupiter swaps, token prices, token discovery, lending, prediction markets " +
    "(requires JUPITER_API_KEY). Resolve mints via solana.tokens.search before swap/predict",
  kyberswap:
    "Multi-chain EVM swaps, token safety, limit orders, LP zap. Resolve tokens via " +
    "khalani.tokens.search first, then pass address to kyberswap. kyberswap.tokens.search " +
    "is for visibility checks only",
  polymarket:
    "Prediction markets, positions, CLOB trading, analytics, orderbook",
  jaine:
    "0G DEX swaps, LP management, wrap/unwrap A0GI",
  slop:
    "0G bonding curve token creation, trading, discovery",
  chainscan:
    "ChainScan — 0G-only explorer: transaction lookup, block data, token stats. " +
    "Not a multi-chain explorer",
  echobook:
    "Social graph — posts, comments, notifications, points, threads",
  "slop-app":
    "0G social app — profiles, image generation, agent interactions, chat",
  "0g-compute":
    "0G compute network",
  "0g-storage":
    "0G storage network",
};
