import type { ChainZapDexConfig } from "../types.js";
const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;

const NFT_CL = { positionRefKind: "tokenId", approvalStandard: "erc721", approvalTargetKind: "positionManager", captureKind: "receiptNftMint", positionKeyStrategy: "nftTokenId" } as const;
const V2_BASIC = { positionRefKind: "ownerAddress", approvalStandard: "erc20", approvalTargetKind: "poolAddress", captureKind: "shareBalance", positionKeyStrategy: "chainPoolWallet" } as const;

export const ZKSYNC_ZAP_DEXES: ChainZapDexConfig = {
  chain: "zksync", lastVerified: "2026-04-03", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_PANCAKESWAPV2", name: "PancakeSwap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_SUSHISWAPV3", name: "SushiSwap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL },
    { id: "DEX_KOICL", name: "KOI CL", supports: [...ALL_OPS], verification: "verified", ...NFT_CL },
    { id: "DEX_KOILEGACY", name: "KOI Legacy", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_SYNCSWAP_V3", name: "SyncSwap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL },
    { id: "DEX_ZKSWAP_V2", name: "ZkSwap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_SHADOW_LEGACY", name: "Shadow Legacy", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
  ],
};
