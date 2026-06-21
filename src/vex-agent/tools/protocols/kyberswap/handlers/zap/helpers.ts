/**
 * KyberSwap ZaaS shared zap helpers — approval-target + position-key strategy.
 *
 * Single-sourced helpers consumed by the per-operation zap handlers
 * (zap.in / zap.out / zap.migrate). Behavior unchanged.
 */

import { getAddress, type Address } from "viem";
import type { ZapDexEntry } from "@tools/kyberswap/zaas/zap-dexes/types.js";
import type { ZapDetails, ZapRouteResponse } from "@tools/kyberswap/zaas/types.js";
import { VexError, ErrorCodes } from "../../../../../../errors.js";
import logger from "@utils/logger.js";

// ── Approval target resolution (R1: approvalTargetKind → concrete address) ──

export function resolveZapApprovalTarget(
  entry: ZapDexEntry, pool: string, routeResp?: ZapRouteResponse,
): Address {
  switch (entry.approvalTargetKind) {
    case "poolAddress":
      return getAddress(pool);
    case "positionManager": {
      if (!entry.positionManagerAddress) {
        throw new VexError(
          ErrorCodes.KYBER_API_ERROR,
          `NFPM address not configured for DEX ${entry.id} on ${pool}. Cannot determine ERC-721 approval target.`,
          "Add positionManagerAddress to this DEX entry in zap-dexes/chains/.",
        );
      }
      return getAddress(entry.positionManagerAddress as `0x${string}`);
    }
    case "vaultShare": {
      // Vault share address MUST come from ZaaS poolDetails, not from pool param
      const vaultAddr = routeResp?.data?.poolDetails?.address;
      if (vaultAddr) return getAddress(vaultAddr);
      // Fail loud — approving wrong contract for vault family is a funds risk
      throw new VexError(
        ErrorCodes.KYBER_API_ERROR,
        `Vault share address not available from ZaaS API for DEX ${entry.id}. Cannot determine approval target.`,
        "This DEX requires poolDetails.address from the route response.",
      );
    }
    case "binManager":
      return getAddress(pool);
    case "lpToken":
      return getAddress(pool);
    case "none":
      // Should not reach here — caller guards against "none"
      return getAddress(pool);
  }
}

// ── Position key builder (per-family strategy, R5: vault fail-loud) ──

export function buildPositionKey(
  entry: ZapDexEntry, chain: string, pool: string, wallet: string,
  ref?: string, vaultAddress?: string,
): string | undefined {
  switch (entry.positionKeyStrategy) {
    case "nftTokenId": return ref;
    case "chainPoolWallet": return `${chain}:lp:${pool}:${wallet}`;
    case "chainVaultWallet": {
      if (!vaultAddress) {
        logger.warn("sync.lp.vault_address_unknown", { chain, pool, dex: entry.id });
      }
      const vault = vaultAddress ?? pool;
      return `${chain}:vault:${vault}:${wallet}`;
    }
    case "erc1155TokenId": return ref;
    case "none": return undefined;
  }
}

// ── Zap preview projection (single source of truth for zap output shape) ──

/** Compact, agent-facing projection of a ZaaS zap route's details. */
export interface FormattedZapPreview {
  /** Native ZaaS fractional price impact (0.0015 = 0.15%); absent when unknown. */
  readonly priceImpact?: number;
  readonly initialAmountUsd?: string;
  readonly finalAmountUsd?: string;
  /** Distinct-order action `type` labels, only when the route exposes actions. */
  readonly actionTypes?: string[];
}

/**
 * Project a ZaaS zap route's `zapDetails` into the compact preview surfaced by
 * zap.in / zap.out / zap.migrate (and their dryRun previews). Spreadable: every
 * field is optional, and `zapDetails` itself may be undefined (no route / route
 * without details) — in which case an empty object is returned and the spread
 * is inert. Pure: no IO, no throws.
 */
export function formatZapPreview(zapDetails?: ZapDetails): FormattedZapPreview {
  if (!zapDetails) return {};
  const preview: {
    priceImpact?: number;
    initialAmountUsd?: string;
    finalAmountUsd?: string;
    actionTypes?: string[];
  } = {};
  if (typeof zapDetails.priceImpact === "number") preview.priceImpact = zapDetails.priceImpact;
  if (zapDetails.initialAmountUsd !== undefined) preview.initialAmountUsd = zapDetails.initialAmountUsd;
  if (zapDetails.finalAmountUsd !== undefined) preview.finalAmountUsd = zapDetails.finalAmountUsd;
  if (Array.isArray(zapDetails.actions) && zapDetails.actions.length > 0) {
    const types = zapDetails.actions
      .map(a => a.type)
      .filter((t): t is string => typeof t === "string" && t.length > 0);
    if (types.length > 0) preview.actionTypes = types;
  }
  return preview;
}
