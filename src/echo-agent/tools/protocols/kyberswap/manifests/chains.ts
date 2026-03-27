import type { ProtocolToolManifest } from "../../types.js";

export const CHAINS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "kyberswap.chains",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "List all 20 KyberSwap-supported EVM chains with feature availability (swap, limit orders, zap).",
    mutating: false,
    params: [],
    exampleParams: {},
  },
  {
    toolId: "kyberswap.chains.supported",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Get live chain availability status from KyberSwap Common Service (active/inactive/new).",
    mutating: false,
    params: [],
    exampleParams: {},
  },
];
