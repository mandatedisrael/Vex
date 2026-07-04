import type { ProtocolToolManifest } from "../../types.js";
import { DEXSCREENER_CORE_DISCOVERY } from "../../embeddings/dexscreener/core.js";

// Chain slugs are DexScreener string ids: ethereum, base, solana, bsc,
// arbitrum, polygon, avalanche, optimism, robinhood (chainId 4663), and more.
// Typical research flow: search → tokenPairs (pick deepest pool) → pairs (deep
// stats on that pool).

export const CORE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "dexscreener.search",
    namespace: "dexscreener",
    lifecycle: "active",
    description:
      "Search DEX pairs across every chain by token name, symbol, or contract address. Start here when you have a name/ticker/address but not a specific pool. Returns concise pairs (price, priceChange h1/h24, liquidity, volume h24, FDV, market cap, txns h24) sorted by liquidity. Optional filters: chainId (e.g. ethereum, base, solana, bsc, arbitrum, robinhood), minLiquidityUsd, limit. Then use dexscreener.tokenPairs to pick the deepest pool.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "query", type: "string", required: true, description: "Search term — token name, symbol, or contract address." },
      { key: "chainId", type: "string", description: "Optional client-side chain filter (e.g. ethereum, base, solana, bsc, arbitrum, robinhood). Keeps only pairs on this chain." },
      { key: "minLiquidityUsd", type: "number", description: "Optional — drop pairs whose USD liquidity is below this threshold." },
      { key: "limit", type: "number", description: "Max pairs to return after liquidity sort (default 20, max 30)." },
    ],
    exampleParams: { query: "PEPE", chainId: "base", minLiquidityUsd: 50000 },
    discovery: DEXSCREENER_CORE_DISCOVERY["dexscreener.search"],
  },
  {
    toolId: "dexscreener.pairs",
    namespace: "dexscreener",
    lifecycle: "active",
    description:
      "Get concise stats for one specific DEX pool by chain + pair address — price, priceChange (h1/h24), liquidity, volume (h24), txns (h24 buys/sells), FDV, market cap, pair age. Use when you already have a pool address (e.g. from dexscreener.tokenPairs) and want its numbers.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "chainId", type: "string", required: true, description: "Chain slug (e.g. ethereum, base, solana, bsc, arbitrum, robinhood)." },
      { key: "pairAddress", type: "string", required: true, description: "DEX pool/pair contract address." },
    ],
    exampleParams: { chainId: "ethereum", pairAddress: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640" },
    discovery: DEXSCREENER_CORE_DISCOVERY["dexscreener.pairs"],
  },
  {
    toolId: "dexscreener.tokens",
    namespace: "dexscreener",
    lifecycle: "active",
    description:
      "Batch-price up to 30 token addresses on ONE chain in a single call (comma-separated). Returns the same concise pair rows as search. Use for portfolio pricing or comparing several tokens on the same chain.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "chainId", type: "string", required: true, description: "Chain slug (e.g. ethereum, base, solana, bsc, arbitrum, robinhood)." },
      { key: "tokenAddresses", type: "string", required: true, description: "Comma-separated token addresses (max 30)." },
    ],
    exampleParams: { chainId: "ethereum", tokenAddresses: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48,0xdAC17F958D2ee523a2206206994597C13D831ec7" },
    discovery: DEXSCREENER_CORE_DISCOVERY["dexscreener.tokens"],
  },
  {
    toolId: "dexscreener.tokenPairs",
    namespace: "dexscreener",
    lifecycle: "active",
    description:
      "List every DEX pool for ONE token on a chain, sorted by USD liquidity (deepest first). This is the canonical resolver for 'which pool should I trade / zap into'. Returns concise pair rows including pairAddress — feed that pool address into swap/zap tools or dexscreener.pairs.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "chainId", type: "string", required: true, description: "Chain slug (e.g. ethereum, base, solana, bsc, arbitrum, robinhood)." },
      { key: "tokenAddress", type: "string", required: true, description: "Token contract address." },
      { key: "limit", type: "number", description: "Max pairs to return, after sorting by USD liquidity (highest first). Omit to return all pairs." },
    ],
    exampleParams: { chainId: "solana", tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    discovery: DEXSCREENER_CORE_DISCOVERY["dexscreener.tokenPairs"],
  },
];
