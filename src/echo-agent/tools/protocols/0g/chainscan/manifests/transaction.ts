import type { ProtocolToolManifest } from "../../../types.js";

export const TRANSACTION_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "chainscan.tx.status",
    namespace: "chainscan",
    lifecycle: "active",
    description: "Check transaction execution status on 0G Network — returns isError flag and error description.",
    mutating: false,
    params: [
      { key: "txHash", type: "string", required: true, description: "Transaction hash (0x + 64 hex chars)." },
    ],
    exampleParams: { txHash: "0xabc123..." },
    requiresEnv: "CHAINSCAN_API_KEY",
  },
  {
    toolId: "chainscan.tx.receipt",
    namespace: "chainscan",
    lifecycle: "active",
    description: "Check transaction receipt status on 0G Network — confirms inclusion in a block.",
    mutating: false,
    params: [
      { key: "txHash", type: "string", required: true, description: "Transaction hash (0x + 64 hex chars)." },
    ],
    exampleParams: { txHash: "0xabc123..." },
    requiresEnv: "CHAINSCAN_API_KEY",
  },
];
