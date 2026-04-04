import type { ChainZapDexConfig } from "../types.js";
import { getNfpm, NFT_CL, V2_BASIC, VAULT_SHARE, SOURCE_ONLY_SHARE } from "../nfpm-registry.js";

const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const SOURCE_ONLY = ["zap-migrate-source"] as const;
const C = "base";

export const BASE_ZAP_DEXES: ChainZapDexConfig = {
  chain: C,
  lastVerified: "2026-04-04",
  source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_UNISWAPV3", name: "Uniswap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_UNISWAPV3"), dexscreenerIds: ["uniswap"], dexscreenerLabels: ["v3"] },
    { id: "DEX_UNISWAP_V4", name: "Uniswap V4", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_UNISWAP_V4") },
    { id: "DEX_UNISWAPV2", name: "Uniswap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC, dexscreenerIds: ["uniswap"], dexscreenerLabels: ["v2"] },
    { id: "DEX_PANCAKESWAPV3", name: "PancakeSwap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_PANCAKESWAPV3"), dexscreenerIds: ["pancakeswap"] },
    { id: "DEX_PANCAKESWAPV2", name: "PancakeSwap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC, dexscreenerIds: ["pancakeswap"] },
    { id: "DEX_SUSHISWAPV3", name: "SushiSwap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_SUSHISWAPV3"), dexscreenerIds: ["sushiswap"] },
    { id: "DEX_SUSHISWAPV2", name: "SushiSwap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC, dexscreenerIds: ["sushiswap"] },
    { id: "DEX_AERODROMECL", name: "Aerodrome CL", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_AERODROMECL"), dexscreenerIds: ["aerodrome"] },
    { id: "DEX_AERODROMEBASIC", name: "Aerodrome Basic", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC, dexscreenerIds: ["aerodrome"] },
    // SwapMode V3/V2 removed — only deployed on Mode Network, not Base
    // ZkSwap V3 removed — only deployed on zkSync Era, not Base
    { id: "DEX_GAMMA", name: "Gamma", supports: [...ALL_OPS], verification: "verified", ...VAULT_SHARE },
    { id: "DEX_SOLIDLY", name: "Solidly", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_CURVE", name: "Curve", supports: [...SOURCE_ONLY], verification: "verified", ...SOURCE_ONLY_SHARE },
    { id: "DEX_BALANCER", name: "Balancer", supports: [...SOURCE_ONLY], verification: "verified", ...SOURCE_ONLY_SHARE },
  ],
};
