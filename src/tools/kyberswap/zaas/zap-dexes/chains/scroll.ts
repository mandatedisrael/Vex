import type { ChainZapDexConfig } from "../types.js";
import { getNfpm, NFT_CL, V2_BASIC, SOURCE_ONLY_SHARE } from "../nfpm-registry.js";

const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const SOURCE_ONLY = ["zap-migrate-source"] as const;
const C = "scroll";

export const SCROLL_ZAP_DEXES: ChainZapDexConfig = {
  chain: C, lastVerified: "2026-04-04", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_SUSHISWAPV3", name: "SushiSwap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_SUSHISWAPV3") },
    { id: "DEX_SUSHISWAPV2", name: "SushiSwap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    // Metavault V3 removed — active on Scroll but NFPM address undocumented
    { id: "DEX_CURVE", name: "Curve", supports: [...SOURCE_ONLY], verification: "verified", ...SOURCE_ONLY_SHARE },
  ],
};
