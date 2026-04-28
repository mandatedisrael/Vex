import type { ProtocolToolManifest } from "../../types.js";
import { SOLANA_SWAP_DISCOVERY } from "../../embeddings/solana-jupiter/swap.js";

export const SWAP_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.swap.quote",
    namespace: "solana",
    lifecycle: "active",
    description: "Get swap quote — price, route, price impact, slippage. No execution.",
    mutating: false,
    params: [
      { key: "inputToken", type: "string", required: true, description: "Input token symbol or mint." },
      { key: "outputToken", type: "string", required: true, description: "Output token symbol or mint." },
      { key: "amount", type: "number", required: true, description: "Amount in human-readable units." },
      { key: "slippageBps", type: "number", description: "Slippage tolerance in basis points." },
    ],
    exampleParams: { inputToken: "SOL", outputToken: "USDC", amount: 1.0, slippageBps: 50 },
    requiresEnv: "JUPITER_API_KEY",
    discovery: SOLANA_SWAP_DISCOVERY["solana.swap.quote"],
  },
  {
    toolId: "solana.swap.execute",
    namespace: "solana",
    lifecycle: "active",
    description: "Execute a token swap via Jupiter Swap API V2 — routes through 400+ DEXs with MEV protection.",
    mutating: true,
    params: [
      { key: "inputToken", type: "string", required: true, description: "Input token symbol or mint." },
      { key: "outputToken", type: "string", required: true, description: "Output token symbol or mint." },
      { key: "amount", type: "number", required: true, description: "Amount in human-readable units." },
      { key: "slippageBps", type: "number", description: "Slippage tolerance in basis points." },
    ],
    exampleParams: { inputToken: "SOL", outputToken: "USDC", amount: 1.0 },
    requiresEnv: "JUPITER_API_KEY",
    discovery: SOLANA_SWAP_DISCOVERY["solana.swap.execute"],
  },
];
