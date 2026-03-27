import type { ProtocolToolManifest } from "../../../types.js";

export const VIEW_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "slop.price",
    namespace: "slop",
    lifecycle: "active",
    description: "Get current token price in 0G — source is bonding curve (pre-graduation) or Jaine pool (post-graduation).",
    mutating: false,
    params: [
      { key: "token", type: "string", required: true, description: "Token contract address (0x...)." },
    ],
    exampleParams: { token: "0xabc..." },
  },
  {
    toolId: "slop.curve",
    namespace: "slop",
    lifecycle: "active",
    description: "Show bonding curve state — reserves, K, graduation progress (%), tokens sold vs curve supply.",
    mutating: false,
    params: [
      { key: "token", type: "string", required: true, description: "Token contract address (0x...)." },
    ],
    exampleParams: { token: "0xabc..." },
  },
];
