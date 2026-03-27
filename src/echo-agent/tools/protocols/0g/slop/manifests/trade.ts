import type { ProtocolToolManifest } from "../../../types.js";

export const TRADE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "slop.trade.buy",
    namespace: "slop",
    lifecycle: "active",
    description: "Buy tokens with native 0G on the bonding curve. Includes partial fill if hitting 80% graduation cap.",
    mutating: true,
    params: [
      { key: "token", type: "string", required: true, description: "Token contract address (0x...)." },
      { key: "amountOg", type: "string", required: true, description: "Amount of 0G to spend (human-readable)." },
      { key: "slippageBps", type: "number", description: "Slippage tolerance in basis points (default: 50 = 0.5%)." },
      { key: "dryRun", type: "boolean", description: "Preview quote without executing." },
    ],
    exampleParams: { token: "0xabc...", amountOg: "1.0", slippageBps: 50 },
  },
  {
    toolId: "slop.trade.sell",
    namespace: "slop",
    lifecycle: "active",
    description: "Sell tokens for native 0G on the bonding curve. Pre-graduation only.",
    mutating: true,
    params: [
      { key: "token", type: "string", required: true, description: "Token contract address (0x...)." },
      { key: "amountTokens", type: "string", required: true, description: "Amount of tokens to sell (human-readable)." },
      { key: "slippageBps", type: "number", description: "Slippage tolerance in basis points (default: 50 = 0.5%)." },
      { key: "dryRun", type: "boolean", description: "Preview quote without executing." },
    ],
    exampleParams: { token: "0xabc...", amountTokens: "1000", slippageBps: 50 },
  },
];
