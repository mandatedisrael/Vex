/**
 * KyberSwap limit order taker fill handlers — single + batch.
 *
 * `kyberswap.limitOrder.fill`, `.batchFill`.
 */

import { getKyberLimitOrderTakerClient } from "@tools/kyberswap/limit-order/taker-client.js";
import {
  getKyberEvmClients,
  sendKyberTransaction,
} from "@tools/kyberswap/evm-utils.js";
import { DSLO_PROTOCOL } from "@tools/kyberswap/constants.js";
import { resolveChainWithId } from "@tools/kyberswap/helpers.js";
import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import { resolveSelectedAddress, resolveSigningWallet, walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";

import { getAddress, type Address, type Hex } from "viem";
import type { ProtocolHandler } from "../../../types.js";
import { str, num, ok, fail } from "../../../handler-helpers.js";

export const limitOrderFill: ProtocolHandler = async (p, ctx) => {
  const chain = str(p, "chain"), orderId = num(p, "orderId");
  const takingAmount = str(p, "takingAmount"), thresholdAmount = str(p, "thresholdAmount");
  if (!chain || orderId == null || !takingAmount || !thresholdAmount)
    return fail("Missing required: chain, orderId, takingAmount, thresholdAmount");

  const { slug, chainId } = resolveChainWithId(chain);
  // Taker target (5D-protocols) — address-only, no decrypt (pre-dryRun safe).
  let target: Address;
  try {
    target = getAddress(resolveSelectedAddress(ctx.walletResolution, ctx.walletPolicy, "eip155"));
  } catch (err) {
    return walletScopeErrorToResult(err);
  }

  const opSig = await getKyberLimitOrderTakerClient().getOperatorSignature(String(chainId), [orderId]);
  if (!opSig.operatorSignatures[0]) return fail("No operator signature returned");

  const encoded = await getKyberLimitOrderTakerClient().encodeFillOrder({
    orderId,
    takingAmount,
    thresholdAmount,
    target,
    operatorSignature: opSig.operatorSignatures[0],
  });

  if (p.dryRun === true) {
    return ok({ dryRun: true, chain: slug, orderId, encodedData: encoded.encodedData.slice(0, 50) + "..." });
  }

  // Signing wallet — decrypt AFTER the dryRun gate, real exec only.
  let signer: ChainWallet;
  try {
    signer = resolveSigningWallet(ctx.walletResolution, ctx.walletPolicy, "eip155");
  } catch (err) {
    return walletScopeErrorToResult(err);
  }
  if (signer.family !== "eip155") return fail("Resolved wallet family mismatch.");

  const { publicClient, walletClient } = getKyberEvmClients(slug, signer.privateKey);
  const to = encoded.routerAddress ? getAddress(encoded.routerAddress) : DSLO_PROTOCOL;
  const txHash = await sendKyberTransaction(publicClient, walletClient, { to, data: encoded.encodedData as Hex });

  return { success: true, output: JSON.stringify({ chain: slug, orderId, txHash }, null, 2), data: { txHash, orderId: String(orderId), _tradeCapture: { type: "order", chain: slug, status: "filled", walletAddress: target, positionKey: String(orderId), signature: txHash, tradeSide: "buy", meta: { orderType: "limitOrder", action: "fill" } } } };
};

export const limitOrderBatchFill: ProtocolHandler = async (p, ctx) => {
  const chain = str(p, "chain");
  const orderIdsRaw = str(p, "orderIds"), takingAmountsRaw = str(p, "takingAmounts"), thresholdAmount = str(p, "thresholdAmount");
  if (!chain || !orderIdsRaw || !takingAmountsRaw || !thresholdAmount)
    return fail("Missing required: chain, orderIds, takingAmounts, thresholdAmount");

  const { slug, chainId } = resolveChainWithId(chain);
  // Taker target (5D-protocols) — address-only, no decrypt (pre-dryRun safe).
  let target: Address;
  try {
    target = getAddress(resolveSelectedAddress(ctx.walletResolution, ctx.walletPolicy, "eip155"));
  } catch (err) {
    return walletScopeErrorToResult(err);
  }
  const orderIds = orderIdsRaw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
  const takingAmounts = takingAmountsRaw.split(",").map(s => s.trim()).filter(Boolean);

  if (orderIds.length === 0) return fail("No valid order IDs provided");
  if (orderIds.length !== takingAmounts.length) return fail("orderIds and takingAmounts must have same length");

  const opSig = await getKyberLimitOrderTakerClient().getOperatorSignature(String(chainId), orderIds);
  if (opSig.operatorSignatures.length !== orderIds.length) return fail("Operator signature count mismatch");

  const encoded = await getKyberLimitOrderTakerClient().encodeFillBatchOrders({
    orderIds,
    takingAmounts,
    thresholdAmount,
    target,
    operatorSignatures: opSig.operatorSignatures,
  });

  if (p.dryRun === true) {
    return ok({ dryRun: true, chain: slug, orderIds, encodedData: encoded.encodedData.slice(0, 50) + "..." });
  }

  // Signing wallet — decrypt AFTER the dryRun gate, real exec only.
  let signer: ChainWallet;
  try {
    signer = resolveSigningWallet(ctx.walletResolution, ctx.walletPolicy, "eip155");
  } catch (err) {
    return walletScopeErrorToResult(err);
  }
  if (signer.family !== "eip155") return fail("Resolved wallet family mismatch.");

  const { publicClient, walletClient } = getKyberEvmClients(slug, signer.privateKey);
  const to = encoded.routerAddress ? getAddress(encoded.routerAddress) : DSLO_PROTOCOL;
  const txHash = await sendKyberTransaction(publicClient, walletClient, { to, data: encoded.encodedData as Hex });

  const captureItems = orderIds.map(id => ({
    type: "order" as const, chain: slug, status: "filled" as const,
    walletAddress: target, positionKey: String(id),
    signature: txHash, tradeSide: "buy" as const,
    meta: { orderType: "limitOrder", action: "fill" },
  }));

  return { success: true, output: JSON.stringify({ chain: slug, orderIds, txHash }, null, 2), data: { txHash, _tradeCapture: captureItems[0] ?? { type: "order", chain: slug, status: "filled", walletAddress: target, signature: txHash, meta: { orderType: "limitOrder", action: "batchFill", orderIds } }, _tradeCaptureItems: captureItems } };
};
