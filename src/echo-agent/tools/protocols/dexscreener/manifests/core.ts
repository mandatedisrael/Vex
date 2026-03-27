import type { ProtocolToolManifest } from "../../types.js";

export const CORE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "dexscreener.search",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Search DEX pairs across all chains by token name, symbol, or address. Returns price, volume, liquidity, FDV, market cap.",
    mutating: false,
    params: [
      { key: "query", type: "string", required: true, description: "Search term — token name, symbol, or contract address." },
    ],
    exampleParams: { query: "PEPE" },
  },
  {
    toolId: "dexscreener.pairs",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get detailed pair data by chain and pair address — price, volume, liquidity, transactions, FDV, market cap, boosts.",
    mutating: false,
    params: [
      { key: "chainId", type: "string", required: true, description: "Chain identifier (e.g. solana, ethereum, bsc, base)." },
      { key: "pairAddress", type: "string", required: true, description: "DEX pool/pair contract address." },
    ],
    exampleParams: { chainId: "ethereum", pairAddress: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640" },
  },
  {
    toolId: "dexscreener.tokens",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get pair data for up to 30 tokens at once (comma-separated addresses). Useful for batch pricing and portfolio lookups.",
    mutating: false,
    params: [
      { key: "chainId", type: "string", required: true, description: "Chain identifier (e.g. solana, ethereum, bsc, base)." },
      { key: "tokenAddresses", type: "string", required: true, description: "Comma-separated token addresses (max 30)." },
    ],
    exampleParams: { chainId: "ethereum", tokenAddresses: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48,0xdAC17F958D2ee523a2206206994597C13D831ec7" },
  },
  {
    toolId: "dexscreener.tokenPairs",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get all DEX pools/pairs for a specific token — find best liquidity, compare across DEXes.",
    mutating: false,
    params: [
      { key: "chainId", type: "string", required: true, description: "Chain identifier (e.g. solana, ethereum, bsc, base)." },
      { key: "tokenAddress", type: "string", required: true, description: "Token contract address." },
    ],
    exampleParams: { chainId: "solana", tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  },
];
