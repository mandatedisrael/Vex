import type { ChainZapDexConfig } from "../types.js";
import { getNfpm, NFT_CL, V2_BASIC, SOURCE_ONLY_SHARE } from "../nfpm-registry.js";

const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const SOURCE_ONLY = ["zap-migrate-source"] as const;
const C = "avalanche";

export const AVALANCHE_ZAP_DEXES: ChainZapDexConfig = {
  chain: C, lastVerified: "2026-04-04", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_UNISWAPV3", name: "Uniswap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_UNISWAPV3") },
    { id: "DEX_UNISWAP_V4", name: "Uniswap V4", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_UNISWAP_V4") },
    { id: "DEX_UNISWAPV2", name: "Uniswap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_SUSHISWAPV3", name: "SushiSwap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_SUSHISWAPV3") },
    { id: "DEX_SUSHISWAPV2", name: "SushiSwap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_PANGOLINSTANDARD", name: "Pangolin Standard", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_CURVE", name: "Curve", supports: [...SOURCE_ONLY], verification: "verified", ...SOURCE_ONLY_SHARE },
    { id: "DEX_BALANCER", name: "Balancer", supports: [...SOURCE_ONLY], verification: "verified", ...SOURCE_ONLY_SHARE },
  ],
};
