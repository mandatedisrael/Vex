import type { ProtocolToolManifest } from "../../types.js";

export const SWAP_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "kyberswap.swap.quote",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Get best swap route across 400+ DEXs — price, route, gas estimate, price impact. Read-only, no execution.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "tokenIn", type: "string", required: true, description: "Input token address or symbol." },
      { key: "tokenOut", type: "string", required: true, description: "Output token address or symbol." },
      { key: "amountIn", type: "string", required: true, description: "Amount in human-readable units." },
    ],
    exampleParams: { chain: "ethereum", tokenIn: "ETH", tokenOut: "USDC", amountIn: "1.0" },
  },
  {
    toolId: "kyberswap.swap.sell",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Execute a token swap via KyberSwap Aggregator on any of 18 EVM chains. Routes through 400+ DEXs.",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "tokenIn", type: "string", required: true, description: "Input token address or symbol." },
      { key: "tokenOut", type: "string", required: true, description: "Output token address or symbol." },
      { key: "amountIn", type: "string", required: true, description: "Amount in human-readable units." },
      { key: "slippageBps", type: "number", description: "Slippage tolerance in basis points (default: 50 = 0.5%)." },
      { key: "recipient", type: "string", description: "Recipient address (default: sender)." },
      { key: "approveExact", type: "boolean", description: "Approve exact amount instead of max." },
      { key: "dryRun", type: "boolean", description: "Preview without executing." },
    ],
    exampleParams: { chain: "base", tokenIn: "ETH", tokenOut: "USDC", amountIn: "0.5", slippageBps: 50 },
  },
];
