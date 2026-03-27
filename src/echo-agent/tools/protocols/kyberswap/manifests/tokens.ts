import type { ProtocolToolManifest } from "../../types.js";

export const TOKENS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "kyberswap.tokens.search",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Search EVM tokens by name/symbol across KyberSwap-supported chains. Returns address, decimals, marketCap, verification status.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias (e.g. ethereum, arb, base)." },
      { key: "query", type: "string", description: "Token name or symbol to search." },
      { key: "whitelisted", type: "boolean", description: "Only return whitelisted tokens." },
      { key: "limit", type: "number", description: "Max results." },
    ],
    exampleParams: { chain: "ethereum", query: "USDC", whitelisted: true },
  },
  {
    toolId: "kyberswap.tokens.check",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Check if a token is a honeypot or has fee-on-transfer tax. Essential safety check before trading.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "address", type: "string", required: true, description: "Token contract address." },
    ],
    exampleParams: { chain: "ethereum", address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  },
];
