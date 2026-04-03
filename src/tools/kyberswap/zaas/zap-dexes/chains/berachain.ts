import type { ChainZapDexConfig } from "../types.js";
const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;

const NFT_CL = { positionRefKind: "tokenId", approvalStandard: "erc721", approvalTargetKind: "positionManager", captureKind: "receiptNftMint", positionKeyStrategy: "nftTokenId" } as const;
const V2_BASIC = { positionRefKind: "ownerAddress", approvalStandard: "erc20", approvalTargetKind: "poolAddress", captureKind: "shareBalance", positionKeyStrategy: "chainPoolWallet" } as const;

export const BERACHAIN_ZAP_DEXES: ChainZapDexConfig = {
  chain: "berachain", lastVerified: "2026-04-03", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_KODIAK_V2", name: "Kodiak V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_KODIAK_V3", name: "Kodiak V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL },
    { id: "DEX_BERAHUB", name: "BeraHub", supports: [...ALL_OPS], verification: "tbd", ...NFT_CL },
    { id: "DEX_9MM_V2", name: "9MM V2", supports: [...ALL_OPS], verification: "tbd", ...V2_BASIC },
    { id: "DEX_9MM_V3", name: "9MM V3", supports: [...ALL_OPS], verification: "tbd", ...NFT_CL },
    { id: "DEX_ARBERA", name: "Arbera", supports: [...ALL_OPS], verification: "tbd", ...V2_BASIC },
    { id: "DEX_BROWNFI", name: "BrownFi V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_QUICKSWAPV4", name: "QuickSwap V4", supports: [...ALL_OPS], verification: "tbd", ...NFT_CL },
  ],
};
