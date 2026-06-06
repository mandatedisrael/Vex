import type { ProtocolToolManifest } from "../../../types.js";
import { POLYMARKET_GAMMA_DISCOVERY } from "../../../embeddings/polymarket/gamma.js";

// ── Profiles (1) ──────────────────────────────────────────────

export const GAMMA_PROFILE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "polymarket.gamma.profile",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get public profile — name, pseudonym, bio, X username, verified badge.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "address", type: "string", required: true, description: "User wallet address." },
    ],
    exampleParams: { address: "0x1234..." },
    discovery: POLYMARKET_GAMMA_DISCOVERY["polymarket.gamma.profile"],
  },
];
