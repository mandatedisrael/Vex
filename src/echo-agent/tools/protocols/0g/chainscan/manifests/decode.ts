import type { ProtocolToolManifest } from "../../../types.js";

export const DECODE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "chainscan.decode.byHashes",
    namespace: "chainscan",
    lifecycle: "active",
    description: "Decode method signatures by 4-byte selector hashes. Batch up to 10 hashes.",
    mutating: false,
    params: [
      { key: "hashes", type: "string", required: true, description: "Comma-separated 4-byte method hashes (max 10)." },
    ],
    exampleParams: { hashes: "0xa9059cbb,0x095ea7b3" },
    requiresEnv: "CHAINSCAN_API_KEY",
  },
  {
    toolId: "chainscan.decode.raw",
    namespace: "chainscan",
    lifecycle: "active",
    description: "Decode raw transaction calldata given contract addresses and input data. Arrays must have same length.",
    mutating: false,
    params: [
      { key: "contracts", type: "string", required: true, description: "Comma-separated contract addresses." },
      { key: "inputs", type: "string", required: true, description: "Comma-separated raw calldata hex strings (same order as contracts)." },
    ],
    exampleParams: { contracts: "0xaaa...", inputs: "0xa9059cbb000..." },
    requiresEnv: "CHAINSCAN_API_KEY",
  },
];
