import type { ProtocolToolManifest } from "../../../types.js";

export const CONTRACT_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "chainscan.contract.abi",
    namespace: "chainscan",
    lifecycle: "active",
    description: "Get ABI of a verified contract on 0G Network. Returns JSON ABI string.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Contract address (0x...)." },
    ],
    exampleParams: { address: "0xabcd..." },
    requiresEnv: "CHAINSCAN_API_KEY",
  },
  {
    toolId: "chainscan.contract.source",
    namespace: "chainscan",
    lifecycle: "active",
    description: "Get verified contract source code, compiler version, optimization settings, and license on 0G Network.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Contract address (0x...)." },
    ],
    exampleParams: { address: "0xabcd..." },
    requiresEnv: "CHAINSCAN_API_KEY",
  },
  {
    toolId: "chainscan.contract.creation",
    namespace: "chainscan",
    lifecycle: "active",
    description: "Get contract creator address and creation transaction hash. Batch up to 5 contracts.",
    mutating: false,
    params: [
      { key: "addresses", type: "string", required: true, description: "Comma-separated contract addresses (max 5)." },
    ],
    exampleParams: { addresses: "0xaaa...,0xbbb..." },
    requiresEnv: "CHAINSCAN_API_KEY",
  },
];
