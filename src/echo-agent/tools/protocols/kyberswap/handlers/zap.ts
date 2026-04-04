/**
 * KyberSwap ZaaS (Zap-as-a-Service) handlers — LP operations.
 *
 * Zap-in, zap-out, zap-migrate, and DEX catalog listing.
 */

import { getKyberZaasClient } from "@tools/kyberswap/zaas/client.js";
import {
  getKyberEvmClients,
  ensureKyberAllowance,
  sendKyberTransaction,
  sendKyberTransactionWithReceipt,
  extractMintedNftId,
  extractErc1155Position,
  ensureErc721Approval,
  ensureErc1155ApprovalForAll,
  verifyRouterAddress,
} from "@tools/kyberswap/evm-utils.js";
import { KS_ZAP_ROUTER_POSITION, NATIVE_TOKEN_ADDRESS } from "@tools/kyberswap/constants.js";
import { resolveChainSlug } from "@tools/kyberswap/chains.js";
import { requireFeature } from "@tools/kyberswap/helpers.js";
import type { ZapDexEntry } from "@tools/kyberswap/zaas/zap-dexes/types.js";
import type { ZapRouteResponse } from "@tools/kyberswap/zaas/types.js";
import { EchoError, ErrorCodes } from "../../../../../errors.js";
import logger from "@utils/logger.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";

import { isAddress, getAddress, maxUint256, type Address, type Hex } from "viem";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

// ── Approval target resolution (R1: approvalTargetKind → concrete address) ──

function resolveZapApprovalTarget(
  entry: ZapDexEntry, pool: string, routeResp?: ZapRouteResponse,
): Address {
  switch (entry.approvalTargetKind) {
    case "poolAddress":
      return getAddress(pool);
    case "positionManager":
      // NFT Position Manager — ZaaS API doesn't reliably return PM address.
      // For known NFT DEXes the pool param IS the position manager contract.
      // This is correct for UniV3/V4 NFPM, Algebra NFPM, etc.
      // If ZaaS ever returns a distinct PM address, prefer that.
      return getAddress(pool);
    case "vaultShare": {
      // Vault share address MUST come from ZaaS poolDetails, not from pool param
      const vaultAddr = routeResp?.data?.poolDetails?.address;
      if (vaultAddr) return getAddress(vaultAddr);
      // Fail loud — approving wrong contract for vault family is a funds risk
      throw new EchoError(
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

function buildPositionKey(
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

// ── Handler map ──────────────────────────────────────────────────

export const ZAP_HANDLERS: Record<string, ProtocolHandler> = {
  "kyberswap.zap.in": async (p) => {
    const chain = str(p, "chain"), dex = str(p, "dex"), pool = str(p, "pool");
    const tokenIn = str(p, "tokenIn"), amountIn = str(p, "amountIn");
    if (!chain || !dex || !pool || !tokenIn || !amountIn) return fail("Missing required: chain, dex, pool, tokenIn, amountIn");

    // Validate tokenIn is a properly formatted address
    if (tokenIn.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase() && !isAddress(tokenIn)) {
      return fail(`Invalid tokenIn address: "${tokenIn}". Resolve via khalani.tokens.search first.`);
    }

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "zaas");

    // Validate DEX is known and supports zap-in
    const { getZapDexConfig } = await import("@tools/kyberswap/zaas/zap-dexes/index.js");
    const zapDexConfig = getZapDexConfig(slug);
    const zapDexEntry = zapDexConfig?.dexes.find(d => d.id === dex);
    if (!zapDexEntry) return fail(`Unknown DEX "${dex}" on ${slug}. Query kyberswap.zap.list for supported DEXes.`);
    if (zapDexEntry.verification === "tbd") return fail(`DEX ${dex} classified as TBD — not yet safe for automated execution. Report to maintainers.`);
    if (!zapDexEntry.supports.includes("zap-in")) return fail(`DEX ${dex} on ${slug} is source-only — cannot be used as zap-in destination.`);

    const wallet = requireEvmWallet();

    const routeResp = await getKyberZaasClient().getZapInRoute(slug, {
      dex,
      "pool.id": pool,
      tokensIn: tokenIn,
      amountsIn: amountIn,
      slippage: num(p, "slippageBps"),
      "position.id": str(p, "positionRef") || undefined,
      "position.tickLower": num(p, "tickLower"),
      "position.tickUpper": num(p, "tickUpper"),
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, zapDetails: routeResp.data.zapDetails, routerAddress: routeResp.data.routerAddress });
    }

    if (!routeResp.data.route || !routeResp.data.routerAddress) return fail("No zap route returned");
    verifyRouterAddress(routeResp.data.routerAddress, KS_ZAP_ROUTER_POSITION);

    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    if (tokenIn.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
      await ensureKyberAllowance(publicClient, walletClient, getAddress(tokenIn), routeResp.data.routerAddress, BigInt(amountIn), p.approveExact === true);
    }

    const buildResp = await getKyberZaasClient().buildZapIn(slug, { sender: wallet.address, recipient: wallet.address, route: routeResp.data.route });
    const { hash: txHash, receipt } = await sendKyberTransactionWithReceipt(publicClient, walletClient, { to: getAddress(buildResp.data.routerAddress), data: buildResp.data.callData as Hex, value: BigInt(buildResp.data.value) });

    // Capture position ref from receipt based on DEX family (R11: reuse zapDexEntry from above)
    let positionRef = str(p, "positionRef") || undefined;
    if (!positionRef) {
      switch (zapDexEntry.captureKind) {
        case "receiptNftMint":
          positionRef = extractMintedNftId(receipt.logs, wallet.address, pool) ?? undefined;
          break;
        case "receiptErc1155":
          positionRef = extractErc1155Position(receipt.logs, wallet.address) ?? undefined;
          break;
        case "shareBalance":
        case "none":
          break;
      }
    }

    const zapDetails = routeResp.data.zapDetails;
    const vaultAddr = routeResp.data.poolDetails?.address;
    const positionKey = buildPositionKey(zapDexEntry, slug, pool, wallet.address, positionRef, vaultAddr);

    return { success: true, output: JSON.stringify({ txHash, chain: slug, dex, pool, positionRef, positionKey }, null, 2), data: { txHash, _tradeCapture: {
      type: "lp", chain: slug, status: "executed", walletAddress: wallet.address,
      positionKey, instrumentKey: `${slug}:lp:${pool}`,
      inputValueUsd: zapDetails?.initialAmountUsd,
      valuationSource: zapDetails?.initialAmountUsd ? "zaas_estimate" : "none",
      meta: { dex, pool, action: "zap-in", positionRef, zapDetails },
    } } };
  },

  "kyberswap.zap.out": async (p) => {
    const chain = str(p, "chain"), dex = str(p, "dex"), pool = str(p, "pool");
    const positionRef = str(p, "positionRef"), tokenOut = str(p, "tokenOut");
    if (!chain || !dex || !pool || !positionRef || !tokenOut) return fail("Missing required: chain, dex, pool, positionRef, tokenOut");

    // Validate tokenOut is a properly formatted address
    if (tokenOut.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase() && !isAddress(tokenOut)) {
      return fail(`Invalid tokenOut address: "${tokenOut}". Resolve via khalani.tokens.search first.`);
    }

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "zaas");
    const wallet = requireEvmWallet();

    // Lookup DEX family for approval routing
    const { getZapDexConfig } = await import("@tools/kyberswap/zaas/zap-dexes/index.js");
    const dexConfig = getZapDexConfig(slug);
    const dexEntry = dexConfig?.dexes.find(d => d.id === dex);
    if (!dexEntry) return fail(`Unknown DEX "${dex}" on ${slug}. Query kyberswap.zap.list for supported DEXes.`);
    if (dexEntry.verification === "tbd") return fail(`DEX ${dex} classified as TBD — not yet safe for automated execution. Report to maintainers.`);
    if (!dexEntry.supports.includes("zap-out")) return fail(`DEX ${dex} on ${slug} does not support zap-out.`);

    const collectFee = p.collectFee !== false; // default true
    const routeResp = await getKyberZaasClient().getZapOutRoute(slug, {
      dexFrom: dex,
      "poolFrom.id": pool,
      "positionFrom.id": positionRef,
      tokenOut,
      collectFee,
      liquidityOut: str(p, "liquidity") || undefined,
      slippage: num(p, "slippageBps"),
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, zapDetails: routeResp.data.zapDetails });
    }

    if (!routeResp.data.route || !routeResp.data.routerAddress) return fail("No zap route returned");
    const routerAddress = routeResp.data.routerAddress;
    verifyRouterAddress(routerAddress, KS_ZAP_ROUTER_POSITION);
    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);

    // Family-aware approval — resolve target from approvalTargetKind (R1)
    const approvalTarget = resolveZapApprovalTarget(dexEntry, pool, routeResp);
    switch (dexEntry.approvalStandard) {
      case "erc721":
        await ensureErc721Approval(publicClient, walletClient, approvalTarget, BigInt(positionRef), routerAddress);
        break;
      case "erc20":
        await ensureKyberAllowance(publicClient, walletClient, approvalTarget, routerAddress, maxUint256);
        break;
      case "erc1155":
        await ensureErc1155ApprovalForAll(publicClient, walletClient, approvalTarget, routerAddress);
        break;
      case "none":
        break;
    }

    const buildResp = await getKyberZaasClient().buildZapOut(slug, { sender: wallet.address, recipient: wallet.address, route: routeResp.data.route });
    const txHash = await sendKyberTransaction(publicClient, walletClient, { to: getAddress(buildResp.data.routerAddress), data: buildResp.data.callData as Hex, value: BigInt(buildResp.data.value) });

    const zapDetails = routeResp.data.zapDetails;
    const outVaultAddr = routeResp.data.poolDetails?.address;
    const positionKey = buildPositionKey(dexEntry, slug, pool, wallet.address, positionRef, outVaultAddr);
    return { success: true, output: JSON.stringify({ txHash, chain: slug, positionRef, positionKey, collectFee }, null, 2), data: { txHash, _tradeCapture: {
      type: "lp", chain: slug, status: "executed", walletAddress: wallet.address,
      positionKey, instrumentKey: `${slug}:lp:${pool}`,
      outputValueUsd: zapDetails?.finalAmountUsd,
      valuationSource: zapDetails?.finalAmountUsd ? "zaas_estimate" : "none",
      meta: { dex, pool, action: "zap-out", positionRef, collectFee, zapDetails },
    } } };
  },

  "kyberswap.zap.migrate": async (p) => {
    const chain = str(p, "chain"), dexFrom = str(p, "dexFrom"), dexTo = str(p, "dexTo");
    const poolFrom = str(p, "poolFrom"), poolTo = str(p, "poolTo"), sourcePositionRef = str(p, "sourcePositionRef");
    if (!chain || !dexFrom || !dexTo || !poolFrom || !poolTo || !sourcePositionRef)
      return fail("Missing required: chain, dexFrom, dexTo, poolFrom, poolTo, sourcePositionRef");

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "zaas");
    const wallet = requireEvmWallet();

    // Validate source and destination DEXes
    const { getZapDexConfig } = await import("@tools/kyberswap/zaas/zap-dexes/index.js");
    const dexConfig = getZapDexConfig(slug);
    const srcEntry = dexConfig?.dexes.find(d => d.id === dexFrom);
    const dstEntry = dexConfig?.dexes.find(d => d.id === dexTo);
    if (!srcEntry) return fail(`Unknown source DEX "${dexFrom}" on ${slug}. Query kyberswap.zap.list for supported DEXes.`);
    if (!dstEntry) return fail(`Unknown destination DEX "${dexTo}" on ${slug}. Query kyberswap.zap.list for supported DEXes.`);
    if (srcEntry.verification === "tbd") return fail(`DEX ${dexFrom} classified as TBD — not yet safe for automated execution.`);
    if (dstEntry.verification === "tbd") return fail(`DEX ${dexTo} classified as TBD — not yet safe for automated execution.`);
    if (!srcEntry.supports.includes("zap-migrate-source")) return fail(`DEX ${dexFrom} does not support zap-migrate-source.`);
    if (!dstEntry.supports.includes("zap-migrate-destination")) return fail(`DEX ${dexTo} does not support zap-migrate-destination.`);

    const collectFee = p.collectFee !== false; // default true
    const routeResp = await getKyberZaasClient().getZapMigrateRoute(slug, {
      dexFrom,
      dexTo,
      "poolFrom.id": poolFrom,
      "poolTo.id": poolTo,
      "positionFrom.id": sourcePositionRef,
      "positionTo.tickLower": num(p, "tickLower"),
      "positionTo.tickUpper": num(p, "tickUpper"),
      liquidityOut: str(p, "liquidity") || undefined,
      collectFee,
      slippage: num(p, "slippageBps"),
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, zapDetails: routeResp.data.zapDetails });
    }

    if (!routeResp.data.route || !routeResp.data.routerAddress) return fail("No zap route returned");
    const routerAddress = routeResp.data.routerAddress;
    verifyRouterAddress(routerAddress, KS_ZAP_ROUTER_POSITION);
    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);

    // Family-aware approval for source position — resolve target from approvalTargetKind (R1)
    const srcApprovalTarget = resolveZapApprovalTarget(srcEntry, poolFrom, routeResp);
    switch (srcEntry.approvalStandard) {
      case "erc721":
        await ensureErc721Approval(publicClient, walletClient, srcApprovalTarget, BigInt(sourcePositionRef), routerAddress);
        break;
      case "erc20":
        await ensureKyberAllowance(publicClient, walletClient, srcApprovalTarget, routerAddress, maxUint256);
        break;
      case "erc1155":
        await ensureErc1155ApprovalForAll(publicClient, walletClient, srcApprovalTarget, routerAddress);
        break;
      case "none":
        break;
    }

    const buildResp = await getKyberZaasClient().buildZapMigrate(slug, { sender: wallet.address, recipient: wallet.address, route: routeResp.data.route });
    const { hash: txHash, receipt } = await sendKyberTransactionWithReceipt(publicClient, walletClient, { to: getAddress(buildResp.data.routerAddress), data: buildResp.data.callData as Hex, value: BigInt(buildResp.data.value) });

    // Capture new position ref from receipt for destination DEX
    let newPositionRef: string | undefined;
    if (dstEntry.captureKind === "receiptNftMint") {
      newPositionRef = extractMintedNftId(receipt.logs, wallet.address) ?? undefined;
    } else if (dstEntry.captureKind === "receiptErc1155") {
      newPositionRef = extractErc1155Position(receipt.logs, wallet.address) ?? undefined;
    }

    const zapDetails = routeResp.data.zapDetails;
    const sourcePositionKey = buildPositionKey(srcEntry, slug, poolFrom, wallet.address, sourcePositionRef);
    const dstVaultAddr = routeResp.data.poolDetails?.address;
    const newPositionKey = buildPositionKey(dstEntry, slug, poolTo, wallet.address, newPositionRef, dstVaultAddr);

    // R6: Emit two capture items — close source + open destination
    const closeCapture = {
      type: "lp" as const, chain: slug, status: "executed" as const, walletAddress: wallet.address,
      positionKey: sourcePositionKey, instrumentKey: `${slug}:lp:${poolFrom}`,
      valuationSource: "none" as const,
      meta: { dex: dexFrom, pool: poolFrom, action: "zap-out", positionRef: sourcePositionRef, collectFee, zapDetails },
    };
    const openCapture = {
      type: "lp" as const, chain: slug, status: "executed" as const, walletAddress: wallet.address,
      positionKey: newPositionKey, instrumentKey: `${slug}:lp:${poolTo}`,
      inputValueUsd: zapDetails?.finalAmountUsd,
      valuationSource: (zapDetails?.finalAmountUsd ? "zaas_estimate" : "none") as string,
      meta: { dex: dexTo, pool: poolTo, action: "zap-in", positionRef: newPositionRef, zapDetails },
    };

    return { success: true, output: JSON.stringify({ txHash, chain: slug, sourcePositionRef, newPositionRef, sourcePositionKey, newPositionKey, from: poolFrom, to: poolTo, collectFee }, null, 2), data: { txHash, _tradeCapture: closeCapture, _tradeCaptureItems: [closeCapture, openCapture] } };
  },

  // ── Zap list (supported DEXes per chain — structured catalog) ───
  "kyberswap.zap.list": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const slug = resolveChainSlug(chain);

    const { getZapDexConfig } = await import("@tools/kyberswap/zaas/zap-dexes/index.js");
    const config = getZapDexConfig(slug);

    if (!config || config.dexes.length === 0) {
      return ok({ chain: slug, count: 0, dexes: [], note: `No ZaaS DEXes configured for ${slug}. Check KyberSwap ZaaS docs for supported chains.` });
    }

    return ok({
      chain: slug,
      lastVerified: config.lastVerified,
      count: config.dexes.length,
      dexes: config.dexes.map(d => ({
        id: d.id,
        name: d.name,
        supports: d.supports,
        verification: d.verification,
        positionRefKind: d.positionRefKind,
        approvalStandard: d.approvalStandard,
        approvalTargetKind: d.approvalTargetKind,
        captureKind: d.captureKind,
        positionKeyStrategy: d.positionKeyStrategy,
        dexscreenerIds: d.dexscreenerIds,
        dexscreenerLabels: d.dexscreenerLabels,
      })),
    });
  },
};
