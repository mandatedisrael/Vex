import type { ChainZapDexConfig } from "../types.js";
const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const SOURCE_ONLY = ["zap-migrate-source"] as const;

const NFT_CL = { positionRefKind: "tokenId", approvalStandard: "erc721", approvalTargetKind: "positionManager", captureKind: "receiptNftMint", positionKeyStrategy: "nftTokenId" } as const;
const V2_BASIC = { positionRefKind: "ownerAddress", approvalStandard: "erc20", approvalTargetKind: "poolAddress", captureKind: "shareBalance", positionKeyStrategy: "chainPoolWallet" } as const;
const SOURCE_ONLY_SHARE = { positionRefKind: "ownerAddress", approvalStandard: "erc20", approvalTargetKind: "lpToken", captureKind: "none", positionKeyStrategy: "none" } as const;

export const SCROLL_ZAP_DEXES: ChainZapDexConfig = {
  chain: "scroll", lastVerified: "2026-04-03", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_SUSHISWAPV3", name: "SushiSwap V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL },
    { id: "DEX_SUSHISWAPV2", name: "SushiSwap V2", supports: [...ALL_OPS], verification: "verified", ...V2_BASIC },
    { id: "DEX_METAVAULTV3", name: "Metavault V3", supports: [...ALL_OPS], verification: "verified", ...NFT_CL },
    { id: "DEX_CURVE", name: "Curve", supports: [...SOURCE_ONLY], verification: "verified", ...SOURCE_ONLY_SHARE },
  ],
};
