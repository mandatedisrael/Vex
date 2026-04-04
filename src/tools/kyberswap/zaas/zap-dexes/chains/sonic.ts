import type { ChainZapDexConfig } from "../types.js";
import { getNfpm, NFT_CL, V2_BASIC } from "../nfpm-registry.js";

const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const C = "sonic";

export const SONIC_ZAP_DEXES: ChainZapDexConfig = {
  chain: C, lastVerified: "2026-04-04", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_SHADOW_CL", name: "Shadow CL", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_SHADOW_CL") },
    { id: "DEX_SHADOW_LEGACY", name: "Shadow Legacy", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    // SquadSwap V3/V2 removed — not deployed on Sonic per official docs
    // 9MM V3/V2 removed — active on Sonic but NFPM address undocumented
  ],
};
