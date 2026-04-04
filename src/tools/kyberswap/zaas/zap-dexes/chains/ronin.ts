import type { ChainZapDexConfig } from "../types.js";
import { getNfpm, NFT_CL, V2_BASIC } from "../nfpm-registry.js";

const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const C = "ronin";

export const RONIN_ZAP_DEXES: ChainZapDexConfig = {
  chain: C, lastVerified: "2026-04-04", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_KATANA_V2", name: "Katana V2", supports: [...ALL_OPS], verification: "unverified", ...V2_BASIC },
    { id: "DEX_KATANA_V3", name: "Katana V3", supports: [...ALL_OPS], verification: "unverified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_KATANA_V3") },
  ],
};
