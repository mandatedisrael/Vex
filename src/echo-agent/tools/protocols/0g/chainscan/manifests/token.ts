import type { ProtocolToolManifest } from "../../../types.js";

export const TOKEN_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "chainscan.token.supply",
    namespace: "chainscan",
    lifecycle: "active",
    description: "Get total supply of an ERC-20 token on 0G Network. Returns raw amount in smallest unit.",
    mutating: false,
    params: [
      { key: "contractAddress", type: "string", required: true, description: "ERC-20 token contract address." },
    ],
    exampleParams: { contractAddress: "0xabcd..." },
    requiresEnv: "CHAINSCAN_API_KEY",
  },
];
