import type { ChainZapDexConfig } from "../types.js";
import { getNfpm, NFT_CL, V2_BASIC, VAULT_SHARE, SOURCE_ONLY_SHARE } from "../nfpm-registry.js";

const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const SOURCE_ONLY = ["zap-migrate-source"] as const;
const C = "linea";

export const LINEA_ZAP_DEXES: ChainZapDexConfig = {
  chain: C, lastVerified: "2026-04-04", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_PANCAKESWAPV3", name: "PancakeSwap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_PANCAKESWAPV3") },
    { id: "DEX_PANCAKESWAPV2", name: "PancakeSwap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_SUSHISWAPV3", name: "SushiSwap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_SUSHISWAPV3") },
    { id: "DEX_SUSHISWAPV2", name: "SushiSwap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    // Metavault V3 removed — active on Linea but NFPM address undocumented
    { id: "DEX_LINEHUBV3", name: "LineHub V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_LINEHUBV3") },
    { id: "DEX_GAMMA", name: "Gamma", supports: [...ALL_OPS], verification: "verified", ...VAULT_SHARE },
    { id: "DEX_BROWNFI", name: "BrownFi V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_CURVE", name: "Curve", supports: [...SOURCE_ONLY], verification: "verified", ...SOURCE_ONLY_SHARE },
  ],
};
