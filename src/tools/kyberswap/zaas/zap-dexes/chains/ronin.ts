import type { ChainZapDexConfig } from "../types.js";
const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;

const NFT_CL = { positionRefKind: "tokenId", approvalStandard: "erc721", approvalTargetKind: "positionManager", captureKind: "receiptNftMint", positionKeyStrategy: "nftTokenId" } as const;
const V2_BASIC = { positionRefKind: "ownerAddress", approvalStandard: "erc20", approvalTargetKind: "poolAddress", captureKind: "shareBalance", positionKeyStrategy: "chainPoolWallet" } as const;

export const RONIN_ZAP_DEXES: ChainZapDexConfig = {
  chain: "ronin", lastVerified: "2026-04-03", source: "KyberSwap ZaaS docs",
  dexes: [
    // Katana on Ronin — DEX ID mapping unconfirmed in official docs
    { id: "DEX_KATANA_V2", name: "Katana V2", supports: [...ALL_OPS], verification: "unverified", ...V2_BASIC },
    { id: "DEX_KATANA_V3", name: "Katana V3", supports: [...ALL_OPS], verification: "unverified", ...NFT_CL },
  ],
};
