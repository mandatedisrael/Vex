import type { ChainZapDexConfig } from "../types.js";
import { getNfpm, NFT_CL, V2_BASIC } from "../nfpm-registry.js";

const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const C = "berachain";

export const BERACHAIN_ZAP_DEXES: ChainZapDexConfig = {
  chain: C, lastVerified: "2026-04-04", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_KODIAK_V2", name: "Kodiak V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_KODIAK_V3", name: "Kodiak V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_KODIAK_V3") },
    // BeraHub removed — not a CL DEX (Balancer-style weighted AMM)
    // 9MM V3/V2 removed — not deployed on Berachain per official docs
    // QuickSwap V4 removed — not deployed on Berachain per official docs
    { id: "DEX_BROWNFI", name: "BrownFi V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
  ],
};
