/**
 * KyberSwap limit order read handlers — maker + taker reads.
 *
 * `kyberswap.limitOrder.list`, `.activeMakingAmount`, `.pairs`, `.takerOrders`.
 */

import { getKyberLimitOrderClient } from "@tools/kyberswap/limit-order/client.js";
import { getKyberLimitOrderTakerClient } from "@tools/kyberswap/limit-order/taker-client.js";
import { requireFeature, resolveChainWithId } from "@tools/kyberswap/helpers.js";
import { resolveSelectedAddress, walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";

import type { ProtocolHandler } from "../../../types.js";
import { str, ok, fail } from "../../../handler-helpers.js";

// ── Limit Orders (Maker) ─────────────────────────────────────────
export const limitOrderList: ProtocolHandler = async (p, ctx) => {
  const chain = str(p, "chain");
  if (!chain) return fail("Missing required: chain");
  const { slug, chainId } = resolveChainWithId(chain);
  requireFeature(slug, "limitOrder");
  // Session maker (5D-protocols) — address-only read scope, no decrypt.
  let maker: string;
  try {
    maker = resolveSelectedAddress(ctx.walletResolution, ctx.walletPolicy, "eip155");
  } catch (err) {
    return walletScopeErrorToResult(err);
  }
  const orders = await getKyberLimitOrderClient().getOrders({
    chainId: String(chainId),
    maker,
    status: str(p, "status") || undefined,
  });
  return ok({ chain: slug, count: orders.length, orders });
};

export const limitOrderActiveMakingAmount: ProtocolHandler = async (p, ctx) => {
  const chain = str(p, "chain"), makerAsset = str(p, "makerAsset");
  if (!chain || !makerAsset) return fail("Missing required: chain, makerAsset");
  const { slug, chainId } = resolveChainWithId(chain);
  // Session maker (5D-protocols) — address-only read scope, no decrypt.
  let maker: string;
  try {
    maker = resolveSelectedAddress(ctx.walletResolution, ctx.walletPolicy, "eip155");
  } catch (err) {
    return walletScopeErrorToResult(err);
  }
  const amount = await getKyberLimitOrderClient().getActiveMakingAmount(String(chainId), makerAsset, maker);
  return ok({ chain: slug, makerAsset, activeMakingAmount: amount });
};

// ── Limit Orders (Taker) ─────────────────────────────────────────
export const limitOrderPairs: ProtocolHandler = async (p) => {
  const chain = str(p, "chain");
  if (!chain) return fail("Missing required: chain");
  const { slug, chainId } = resolveChainWithId(chain);
  const pairs = await getKyberLimitOrderTakerClient().getTradingPairs(String(chainId));
  return ok({ chain: slug, count: pairs.length, pairs });
};

export const limitOrderTakerOrders: ProtocolHandler = async (p) => {
  const chain = str(p, "chain");
  if (!chain) return fail("Missing required: chain");
  const { slug, chainId } = resolveChainWithId(chain);
  const orders = await getKyberLimitOrderTakerClient().getTakerOrders({
    chainId: String(chainId),
    makerAsset: str(p, "makerAsset") || undefined,
    takerAsset: str(p, "takerAsset") || undefined,
  });
  return ok({ chain: slug, count: orders.length, orders });
};
