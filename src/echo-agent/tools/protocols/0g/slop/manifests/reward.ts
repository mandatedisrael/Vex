import type { ProtocolToolManifest } from "../../../types.js";

export const REWARD_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "slop.reward.pending",
    namespace: "slop",
    lifecycle: "active",
    description: "Show pending creator graduation reward — claimable after token graduates from bonding curve to DEX.",
    mutating: false,
    params: [
      { key: "token", type: "string", required: true, description: "Token contract address (0x...)." },
    ],
    exampleParams: { token: "0xabc..." },
  },
  {
    toolId: "slop.reward.claim",
    namespace: "slop",
    lifecycle: "active",
    description: "Claim creator graduation reward in native 0G.",
    mutating: true,
    params: [
      { key: "token", type: "string", required: true, description: "Token contract address (0x...)." },
    ],
    exampleParams: { token: "0xabc..." },
  },
];
