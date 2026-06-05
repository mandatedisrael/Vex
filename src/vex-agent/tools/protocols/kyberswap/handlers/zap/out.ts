/**
 * KyberSwap ZaaS zap-out handler — `kyberswap.zap.out`.
 */

import { getKyberZaasClient } from "@tools/kyberswap/zaas/client.js";
import {
  getKyberEvmClients,
  ensureKyberAllowance,
  sendKyberTransaction,
  ensureErc721Approval,
  ensureErc1155ApprovalForAll,
  verifyRouterAddress,
} from "@tools/kyberswap/evm-utils.js";
import { KS_ZAP_ROUTER_POSITION, NATIVE_TOKEN_ADDRESS } from "@tools/kyberswap/constants.js";
import { resolveChainSlug } from "@tools/kyberswap/chains.js";
import { requireFeature } from "@tools/kyberswap/helpers.js";
import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import { resolveSigningWallet, walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";

import { isAddress, getAddress, maxUint256, type Hex } from "viem";
import type { ProtocolHandler } from "../../../types.js";
import { str, num, ok, fail } from "../../../handler-helpers.js";
import { resolveZapApprovalTarget, buildPositionKey } from "./helpers.js";

export const zapOut: ProtocolHandler = async (p, ctx) => {
  const chain = str(p, "chain"), dex = str(p, "dex"), pool = str(p, "pool");
  const positionRef = str(p, "positionRef"), tokenOut = str(p, "tokenOut");
  if (!chain || !dex || !pool || !positionRef || !tokenOut) return fail("Missing required: chain, dex, pool, positionRef, tokenOut");

  // Validate tokenOut is a properly formatted address
  if (tokenOut.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase() && !isAddress(tokenOut)) {
    return fail(`Invalid tokenOut address: "${tokenOut}". Resolve via khalani.tokens.search first.`);
  }

  const slug = resolveChainSlug(chain);
  requireFeature(slug, "zaas");

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

  // Per-session signing wallet (5D-protocols) — after dryRun gate, real exec only.
  let signer: ChainWallet;
  try {
    signer = resolveSigningWallet(ctx.walletResolution, ctx.walletPolicy, "eip155");
  } catch (err) {
    return walletScopeErrorToResult(err);
  }
  if (signer.family !== "eip155") return fail("Resolved wallet family mismatch.");
  const { publicClient, walletClient } = getKyberEvmClients(slug, signer.privateKey);

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

  const buildResp = await getKyberZaasClient().buildZapOut(slug, { sender: signer.address, recipient: signer.address, route: routeResp.data.route });
  const txHash = await sendKyberTransaction(publicClient, walletClient, { to: getAddress(buildResp.data.routerAddress), data: buildResp.data.callData as Hex, value: BigInt(buildResp.data.value) });

  const zapDetails = routeResp.data.zapDetails;
  const outVaultAddr = routeResp.data.poolDetails?.address;
  const positionKey = buildPositionKey(dexEntry, slug, pool, signer.address, positionRef, outVaultAddr);
  return { success: true, output: JSON.stringify({ txHash, chain: slug, positionRef, positionKey, collectFee }, null, 2), data: { txHash, _tradeCapture: {
    type: "lp", chain: slug, status: "executed", walletAddress: signer.address,
    positionKey, instrumentKey: `${slug}:lp:${pool}`,
    outputValueUsd: zapDetails?.finalAmountUsd,
    valuationSource: zapDetails?.finalAmountUsd ? "zaas_estimate" : "none",
    meta: { dex, pool, action: "zap-out", positionRef, collectFee, zapDetails },
  } } };
};
