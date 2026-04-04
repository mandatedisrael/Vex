/**
 * ZaaS DEX catalog types — structured DEX entries for kyberswap.zap.list.
 *
 * Each chain has a curated list of DEXes with capability and verification info.
 * Source: KyberSwap ZaaS docs (supported-chains-dexes + dex-ids pages).
 */

export type ZapDexCapability = "zap-in" | "zap-out" | "zap-migrate-source" | "zap-migrate-destination";

// ── 5-axis position model ─────────────────────────────────────────
// Each axis is independent. positionRef ≠ approval target ≠ capture method.

/** What ZaaS API expects as Position.id */
export type PositionRefKind =
  | "tokenId"         // NFT token ID (concentrated liquidity: UniV3, V4, Algebra-based)
  | "ownerAddress"    // Wallet owner address (V2-like — ZaaS proto: "for uniswapV2 this is user address")
  | "erc1155TokenId"  // ERC-1155 bin token ID (PancakeBin)
  | "opaqueRef";      // Unknown/future — runtime MUST fail loud

/** Token standard for approval */
export type ApprovalStandard =
  | "erc721"    // approve(spender, tokenId)
  | "erc20"     // approve(spender, amount)
  | "erc1155"   // setApprovalForAll(operator, true)
  | "none";     // No approval needed

/** Which contract to approve — separate axis from standard!
 *  NFT: Position Manager contract (per-DEX, per-chain)
 *  V2: LP token = pool address
 *  Vault/ALM: vault share contract (≠ pool address)
 *  ERC-1155: BinPositionManager
 *  Source-only: LP token / BPT
 */
export type ApprovalTargetKind =
  | "positionManager"  // NFT Position Manager contract
  | "poolAddress"      // Pool = LP token contract (V2-like)
  | "vaultShare"       // Vault share token (Gamma, Steer — ≠ pool address)
  | "binManager"       // BinPositionManager (ERC-1155)
  | "lpToken"          // LP token / BPT (Curve, Balancer source-only)
  | "none";

/** How capture pipeline detects new position from tx receipt */
export type CaptureKind =
  | "receiptNftMint"   // Parse ERC-721 Transfer (mint or router→wallet)
  | "receiptErc1155"   // Parse ERC-1155 TransferSingle/TransferBatch
  | "shareBalance"     // Position = share token balance (not from receipt)
  | "none";            // No receipt capture (source-only)

/** How to deterministically build positionKey for projection pipeline.
 *  Projector requires positionKey — without it LP lifecycle is dead.
 */
export type PositionKeyStrategy =
  | "nftTokenId"       // positionKey = tokenId from receipt/positionRef
  | "chainPoolWallet"  // positionKey = `${chain}:lp:${pool}:${wallet}`
  | "chainVaultWallet" // positionKey = `${chain}:vault:${vaultAddress}:${wallet}`
  | "erc1155TokenId"   // positionKey = ERC-1155 token ID from receipt
  | "none";            // Source-only, no projection

export interface ZapDexEntry {
  /** Official KyberSwap ZaaS DEX ID (e.g. "DEX_UNISWAPV3"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Which zap operations this DEX supports on this chain. */
  supports: ZapDexCapability[];
  /** Whether this DEX ID is confirmed in official docs. */
  verification: "verified" | "unverified" | "tbd";

  // ── 5-axis position model ──
  /** What ZaaS API expects as Position.id */
  positionRefKind: PositionRefKind;
  /** Token standard for approval (ERC-20/721/1155) */
  approvalStandard: ApprovalStandard;
  /** Which contract to call approve on — separate from standard! */
  approvalTargetKind: ApprovalTargetKind;
  /** How capture pipeline detects new position */
  captureKind: CaptureKind;
  /** How to build positionKey for projection */
  positionKeyStrategy: PositionKeyStrategy;

  /**
   * Concrete address of the NonfungiblePositionManager (or PositionManager for V4).
   * Required when approvalTargetKind === "positionManager" — the NFPM is a separate
   * contract from the pool. Per-DEX per-chain (immutable deployed contracts).
   */
  positionManagerAddress?: string;

  /** DexScreener dexId values for matching pair.dexId. */
  dexscreenerIds?: string[];
  /** DexScreener label values for matching pair.labels (e.g. ["v3"]). */
  dexscreenerLabels?: string[];
}

export interface ChainZapDexConfig {
  chain: string;
  lastVerified: string;
  source: string;
  dexes: readonly ZapDexEntry[];
}
