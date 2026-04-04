/**
 * KyberSwap limit order handlers — maker + taker operations.
 */

import { getKyberLimitOrderClient } from "@tools/kyberswap/limit-order/client.js";
import { getKyberLimitOrderTakerClient } from "@tools/kyberswap/limit-order/taker-client.js";
import { signEip712Message } from "@tools/kyberswap/limit-order/signing.js";
import {
  getKyberEvmClients,
  sendKyberTransaction,
} from "@tools/kyberswap/evm-utils.js";
import { DSLO_PROTOCOL } from "@tools/kyberswap/constants.js";
import { resolveTokenMetadataStrict, requireFeature, resolveChainWithId } from "@tools/kyberswap/helpers.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";

import { parseUnits, getAddress, type Hex } from "viem";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";

// ── Duration parser ──────────────────────────────────────────────

function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid duration: ${input}. Use: 1h, 24h, 7d, 30d`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "m") return value * 60;
  if (unit === "h") return value * 3600;
  if (unit === "d") return value * 86400;
  throw new Error(`Invalid duration unit: ${unit}`);
}

// ── Handler map ──────────────────────────────────────────────────

export const LIMIT_ORDER_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Limit Orders (Maker) ─────────────────────────────────────────
  "kyberswap.limitOrder.list": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { slug, chainId } = resolveChainWithId(chain);
    requireFeature(slug, "limitOrder");
    const wallet = requireEvmWallet();
    const orders = await getKyberLimitOrderClient().getOrders({
      chainId: String(chainId),
      maker: wallet.address,
      status: str(p, "status") || undefined,
    });
    return ok({ chain: slug, count: orders.length, orders });
  },

  "kyberswap.limitOrder.activeMakingAmount": async (p) => {
    const chain = str(p, "chain"), makerAsset = str(p, "makerAsset");
    if (!chain || !makerAsset) return fail("Missing required: chain, makerAsset");
    const { slug, chainId } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();
    const amount = await getKyberLimitOrderClient().getActiveMakingAmount(String(chainId), makerAsset, wallet.address);
    return ok({ chain: slug, makerAsset, activeMakingAmount: amount });
  },

  "kyberswap.limitOrder.create": async (p) => {
    const chain = str(p, "chain"), makerAssetRaw = str(p, "makerAsset"), takerAssetRaw = str(p, "takerAsset");
    const makingAmountRaw = str(p, "makingAmount"), takingAmountRaw = str(p, "takingAmount"), expires = str(p, "expires");
    if (!chain || !makerAssetRaw || !takerAssetRaw || !makingAmountRaw || !takingAmountRaw || !expires)
      return fail("Missing required: chain, makerAsset, takerAsset, makingAmount, takingAmount, expires");

    const { slug, chainId } = resolveChainWithId(chain);
    requireFeature(slug, "limitOrder");
    const wallet = requireEvmWallet();
    // Strict: address-only for mutating limit orders
    const makerToken = await resolveTokenMetadataStrict(makerAssetRaw, chainId);
    const takerToken = await resolveTokenMetadataStrict(takerAssetRaw, chainId);
    const makingAmount = parseUnits(makingAmountRaw, makerToken.decimals).toString();
    const takingAmount = parseUnits(takingAmountRaw, takerToken.decimals).toString();

    const expiresSeconds = parseDuration(expires);
    const expiredAt = Math.floor(Date.now() / 1000) + expiresSeconds;

    // Get unsigned EIP-712
    const eip712 = await getKyberLimitOrderClient().getSignMessage({
      chainId: String(chainId),
      makerAsset: makerToken.address,
      takerAsset: takerToken.address,
      maker: wallet.address,
      makingAmount,
      takingAmount,
      expiredAt,
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, makerAsset: makerToken.symbol, takerAsset: takerToken.symbol, makingAmount, takingAmount, expiredAt, salt: eip712.message.salt });
    }

    // Sign
    const signature = await signEip712Message(wallet.privateKey, eip712);

    // Create
    const result = await getKyberLimitOrderClient().createOrder({
      chainId: String(chainId),
      makerAsset: makerToken.address,
      takerAsset: takerToken.address,
      maker: wallet.address,
      makingAmount,
      takingAmount,
      expiredAt,
      salt: eip712.message.salt,
      signature,
    });

    return {
      success: true,
      output: JSON.stringify({ chain: slug, orderId: result.orderId, makerAsset: makerToken.symbol, takerAsset: takerToken.symbol, makingAmount, takingAmount, expiredAt }, null, 2),
      data: {
        orderId: result.orderId,
        _tradeCapture: {
          type: "order", chain: slug, status: "open",
          walletAddress: wallet.address,
          positionKey: String(result.orderId),
          instrumentKey: `${slug}:lo:${makerToken.address}:${takerToken.address}`,
          inputTokenAddress: makerToken.address, inputToken: makerToken.symbol,
          outputTokenAddress: takerToken.address, outputToken: takerToken.symbol,
          inputAmount: makingAmount, outputAmount: takingAmount,
          meta: { orderType: "limitOrder", expiredAt },
        },
      },
    };
  },

  "kyberswap.limitOrder.cancel": async (p) => {
    const chain = str(p, "chain"), orderId = num(p, "orderId");
    if (!chain || orderId == null) return fail("Missing required: chain, orderId");
    const { slug, chainId } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();

    const eip712 = await getKyberLimitOrderClient().getCancelSignMessage({
      chainId: String(chainId),
      maker: wallet.address,
      orderIds: [orderId],
    });
    const signature = await signEip712Message(wallet.privateKey, eip712);
    await getKyberLimitOrderClient().cancelOrders({ ...eip712, signature });

    return { success: true, output: JSON.stringify({ chain: slug, orderId, method: "gasless", status: "cancelled" }, null, 2), data: { orderId: String(orderId), _tradeCapture: { type: "order", chain: slug, status: "cancelled", walletAddress: wallet.address, positionKey: String(orderId), meta: { orderType: "limitOrder", method: "gasless" } } } };
  },

  "kyberswap.limitOrder.hardCancel": async (p) => {
    const chain = str(p, "chain"), orderId = num(p, "orderId");
    if (!chain || orderId == null) return fail("Missing required: chain, orderId");
    const { slug } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();

    const encoded = await getKyberLimitOrderClient().encodeCancelBatch([orderId]);
    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    const txHash = await sendKyberTransaction(publicClient, walletClient, {
      to: DSLO_PROTOCOL,
      data: encoded.encodedData as Hex,
    });

    return { success: true, output: JSON.stringify({ chain: slug, orderId, txHash, method: "hard-cancel" }, null, 2), data: { txHash, orderId: String(orderId), _tradeCapture: { type: "order", chain: slug, status: "cancelled", walletAddress: wallet.address, positionKey: String(orderId), signature: txHash, meta: { orderType: "limitOrder", method: "hard-cancel" } } } };
  },

  // ── Limit Orders (Taker) ─────────────────────────────────────────
  "kyberswap.limitOrder.pairs": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { slug, chainId } = resolveChainWithId(chain);
    const pairs = await getKyberLimitOrderTakerClient().getTradingPairs(String(chainId));
    return ok({ chain: slug, count: pairs.length, pairs });
  },

  "kyberswap.limitOrder.takerOrders": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { slug, chainId } = resolveChainWithId(chain);
    const orders = await getKyberLimitOrderTakerClient().getTakerOrders({
      chainId: String(chainId),
      makerAsset: str(p, "makerAsset") || undefined,
      takerAsset: str(p, "takerAsset") || undefined,
    });
    return ok({ chain: slug, count: orders.length, orders });
  },

  "kyberswap.limitOrder.fill": async (p) => {
    const chain = str(p, "chain"), orderId = num(p, "orderId");
    const takingAmount = str(p, "takingAmount"), thresholdAmount = str(p, "thresholdAmount");
    if (!chain || orderId == null || !takingAmount || !thresholdAmount)
      return fail("Missing required: chain, orderId, takingAmount, thresholdAmount");

    const { slug, chainId } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();

    const opSig = await getKyberLimitOrderTakerClient().getOperatorSignature(String(chainId), [orderId]);
    if (!opSig.operatorSignatures[0]) return fail("No operator signature returned");

    const encoded = await getKyberLimitOrderTakerClient().encodeFillOrder({
      orderId,
      takingAmount,
      thresholdAmount,
      target: wallet.address,
      operatorSignature: opSig.operatorSignatures[0],
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, orderId, encodedData: encoded.encodedData.slice(0, 50) + "..." });
    }

    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    const to = encoded.routerAddress ? getAddress(encoded.routerAddress) : DSLO_PROTOCOL;
    const txHash = await sendKyberTransaction(publicClient, walletClient, { to, data: encoded.encodedData as Hex });

    return { success: true, output: JSON.stringify({ chain: slug, orderId, txHash }, null, 2), data: { txHash, orderId: String(orderId), _tradeCapture: { type: "order", chain: slug, status: "filled", walletAddress: wallet.address, positionKey: String(orderId), signature: txHash, tradeSide: "buy", meta: { orderType: "limitOrder", action: "fill" } } } };
  },

  "kyberswap.limitOrder.batchFill": async (p) => {
    const chain = str(p, "chain");
    const orderIdsRaw = str(p, "orderIds"), takingAmountsRaw = str(p, "takingAmounts"), thresholdAmount = str(p, "thresholdAmount");
    if (!chain || !orderIdsRaw || !takingAmountsRaw || !thresholdAmount)
      return fail("Missing required: chain, orderIds, takingAmounts, thresholdAmount");

    const { slug, chainId } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();
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
      target: wallet.address,
      operatorSignatures: opSig.operatorSignatures,
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, orderIds, encodedData: encoded.encodedData.slice(0, 50) + "..." });
    }

    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    const to = encoded.routerAddress ? getAddress(encoded.routerAddress) : DSLO_PROTOCOL;
    const txHash = await sendKyberTransaction(publicClient, walletClient, { to, data: encoded.encodedData as Hex });

    const captureItems = orderIds.map(id => ({
      type: "order" as const, chain: slug, status: "filled" as const,
      walletAddress: wallet.address, positionKey: String(id),
      signature: txHash, tradeSide: "buy" as const,
      meta: { orderType: "limitOrder", action: "fill" },
    }));

    return { success: true, output: JSON.stringify({ chain: slug, orderIds, txHash }, null, 2), data: { txHash, _tradeCapture: captureItems[0] ?? { type: "order", chain: slug, status: "filled", walletAddress: wallet.address, signature: txHash, meta: { orderType: "limitOrder", action: "batchFill", orderIds } }, _tradeCaptureItems: captureItems } };
  },

  "kyberswap.limitOrder.cancelAll": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { slug, chainId } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();

    // Prefetch active orders BEFORE nonce increase for per-order itemization.
    // Race condition: orders may fill between list and cancel — acceptable,
    // fill would have its own capture. Prefetch is best-effort.
    const loClient = getKyberLimitOrderClient();
    const activeOrders = await loClient.getOrders({
      chainId: String(chainId), maker: wallet.address, status: "active",
    });

    const encoded = await loClient.encodeIncreaseNonce(String(chainId));
    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    const txHash = await sendKyberTransaction(publicClient, walletClient, {
      to: DSLO_PROTOCOL,
      data: encoded.encodedData as Hex,
    });

    const captureItems = activeOrders.map(order => ({
      type: "order" as const, chain: slug, status: "cancelled" as const,
      walletAddress: wallet.address, positionKey: String(order.id),
      signature: txHash,
      meta: { orderType: "limitOrder", action: "cancelAll" },
    }));

    return { success: true, output: JSON.stringify({ chain: slug, txHash, method: "increase-nonce", cancelledCount: captureItems.length }, null, 2), data: { txHash, _tradeCapture: captureItems[0] ?? { type: "order", chain: slug, status: "cancelled", walletAddress: wallet.address, signature: txHash, meta: { orderType: "limitOrder", action: "cancelAll" } }, _tradeCaptureItems: captureItems.length > 0 ? captureItems : undefined } };
  },
};
