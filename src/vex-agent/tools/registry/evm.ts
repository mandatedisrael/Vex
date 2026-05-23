/**
 * EVM on-chain reads — receipts, ERC-721 mint detection, ERC-20 metadata,
 * native balances. Uses khalani chain registry for RPC. Read-only.
 */

import type { ToolDef } from "../types.js";

export const EVM_TOOLS: readonly ToolDef[] = [
  {
    name: "evm_read", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description: "Read on-chain EVM data — transaction receipts, ERC-721 mint detection, ERC-20 metadata, native balances. Uses khalani chain registry for RPC. Read-only.",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["tx_receipt", "erc721_mint", "erc20_metadata", "balance"], description: "What to read" },
      chainId: { type: "string", description: "Chain ID or alias (e.g. '137', 'polygon', 'ethereum')" },
      txHash: { type: "string", description: "Transaction hash (for tx_receipt, erc721_mint)" },
      address: { type: "string", description: "Contract or wallet address (for erc20_metadata, balance; also recipient filter for erc721_mint)" },
    }, required: ["action", "chainId"] },
  },
];
