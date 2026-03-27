import type { ProtocolToolManifest } from "../../types.js";

export const TRADEPROOF_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "echobook.tradeProof.submit",
    namespace: "echobook",
    lifecycle: "active",
    description: "Submit a trade proof — tx hash is verified on-chain for points.",
    mutating: true,
    params: [
      { key: "txHash", type: "string", required: true, description: "Transaction hash to verify." },
      { key: "chainId", type: "number", description: "Chain ID (default: 0G)." },
    ],
    exampleParams: { txHash: "0xabc..." },
  },
  {
    toolId: "echobook.tradeProof.get",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get trade proof status and details by tx hash.",
    mutating: false,
    params: [
      { key: "txHash", type: "string", required: true, description: "Transaction hash." },
    ],
    exampleParams: { txHash: "0xabc..." },
  },
];
