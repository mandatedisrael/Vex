import type { ChainZapDexConfig } from "../types.js";
import { getNfpm, NFT_CL, V2_BASIC } from "../nfpm-registry.js";

const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const C = "zksync";

export const ZKSYNC_ZAP_DEXES: ChainZapDexConfig = {
  chain: C, lastVerified: "2026-04-04", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_PANCAKESWAPV2", name: "PancakeSwap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    // SushiSwap V3 removed — not deployed on zkSync Era per official clAMM docs
    { id: "DEX_KOICL", name: "KOI CL", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_KOICL") },
    { id: "DEX_KOILEGACY", name: "KOI Legacy", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_SYNCSWAP_V3", name: "SyncSwap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL, positionManagerAddress: getNfpm(C, "DEX_SYNCSWAP_V3") },
    { id: "DEX_ZKSWAP_V2", name: "ZkSwap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_SHADOW_LEGACY", name: "Shadow Legacy", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
  ],
};
