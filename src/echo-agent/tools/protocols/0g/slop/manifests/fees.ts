import type { ProtocolToolManifest } from "../../../types.js";

export const FEES_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "slop.fees.stats",
    namespace: "slop",
    lifecycle: "active",
    description: "Fee statistics for a token — total creator/platform fees, pending fees, volume. From FeeCollector contract.",
    mutating: false,
    params: [
      { key: "token", type: "string", required: true, description: "Token contract address (0x...)." },
    ],
    exampleParams: { token: "0xabc..." },
  },
  {
    toolId: "slop.fees.claimCreator",
    namespace: "slop",
    lifecycle: "active",
    description: "Withdraw pending creator trading fees from the FeeCollector contract.",
    mutating: true,
    params: [
      { key: "token", type: "string", required: true, description: "Token contract address (0x...)." },
    ],
    exampleParams: { token: "0xabc..." },
  },
  {
    toolId: "slop.fees.lpPending",
    namespace: "slop",
    lifecycle: "active",
    description: "Show pending LP fees for a graduated token (w0G + token amounts).",
    mutating: false,
    params: [
      { key: "token", type: "string", required: true, description: "Token contract address (0x...)." },
    ],
    exampleParams: { token: "0xabc..." },
  },
  {
    toolId: "slop.fees.lpCollect",
    namespace: "slop",
    lifecycle: "active",
    description: "Collect LP fees for a graduated token. Creator only.",
    mutating: true,
    params: [
      { key: "token", type: "string", required: true, description: "Token contract address (0x...)." },
      { key: "recipient", type: "string", description: "Recipient address (default: sender wallet)." },
    ],
    exampleParams: { token: "0xabc..." },
  },
];
