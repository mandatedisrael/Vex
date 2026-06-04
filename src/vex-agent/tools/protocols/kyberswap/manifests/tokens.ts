import type { ProtocolToolManifest } from "../../types.js";
import { KYBERSWAP_TOKENS_DISCOVERY } from "../../embeddings/kyberswap/tokens.js";

export const TOKENS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "kyberswap.tokens.check",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Check if a token is a honeypot or has fee-on-transfer tax. Essential safety check before trading.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "address", type: "string", required: true, description: "Token contract address." },
    ],
    exampleParams: { chain: "ethereum", address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
    discovery: KYBERSWAP_TOKENS_DISCOVERY["kyberswap.tokens.check"],
  },
];
