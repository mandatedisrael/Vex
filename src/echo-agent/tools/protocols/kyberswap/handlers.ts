/**
 * KyberSwap protocol handlers — direct TS client calls.
 *
 * All handlers import from @tools/kyberswap/ clients.
 * Execution helpers from @commands/kyberswap/helpers.ts.
 * No CLI spawning. Wallet via @tools/wallet/multi-auth.
 */

import { getKyberAggregatorClient } from "@tools/kyberswap/aggregator/client.js";
import { getKyberTokenApiClient } from "@tools/kyberswap/token-api/client.js";
import { getKyberLimitOrderClient } from "@tools/kyberswap/limit-order/client.js";
import { getKyberLimitOrderTakerClient } from "@tools/kyberswap/limit-order/taker-client.js";
import { signEip712Message } from "@tools/kyberswap/limit-order/signing.js";
import { getKyberZaasClient } from "@tools/kyberswap/zaas/client.js";
import { getKyberCommonClient } from "@tools/kyberswap/common/client.js";
import { getKyberChains, resolveChainSlug, slugToChainId, chainSupportsFeature } from "@tools/kyberswap/chains.js";
import {
  getKyberEvmClients,
  ensureKyberAllowance,
  sendKyberTransaction,
  verifyRouterAddress,
} from "@tools/kyberswap/evm-utils.js";
import { META_AGGREGATION_ROUTER_V2, DSLO_PROTOCOL, KS_ZAP_ROUTER_POSITION, NATIVE_TOKEN_ADDRESS } from "@tools/kyberswap/constants.js";
import { resolveTokenMetadata, resolveTokenAddress, requireFeature, resolveChainWithId } from "@commands/kyberswap/helpers.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";

import { parseUnits, getAddress, type Address, type Hex } from "viem";
import type { ToolResult } from "../../types.js";
import type { ProtocolHandler } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────

function str(p: Record<string, unknown>, k: string): string {
  const v = p[k]; return typeof v === "string" ? v : "";
}
function num(p: Record<string, unknown>, k: string): number | undefined {
  const v = p[k]; return typeof v === "number" ? v : undefined;
}
function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}
function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}

// ── Shared swap execution (sell + buy use same routing, differ in trade_side) ──

async function executeKyberSwap(p: Record<string, unknown>, side: "buy" | "sell"): Promise<ToolResult> {
  const chain = str(p, "chain"), tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
  if (!chain || !tokenInRaw || !tokenOutRaw || !amountInRaw) return fail("Missing required: chain, tokenIn, tokenOut, amountIn");

  const slug = resolveChainSlug(chain);
  requireFeature(slug, "aggregator");
  const chainId = slugToChainId(slug);
  const wallet = requireEvmWallet();
  const tokenIn = await resolveTokenMetadata(tokenInRaw, chainId);
  const tokenOut = await resolveTokenMetadata(tokenOutRaw, chainId);
  const amountIn = parseUnits(amountInRaw, tokenIn.decimals);

  const routeResp = await getKyberAggregatorClient().getRoute(slug, {
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    amountIn: amountIn.toString(),
  });
  const { routeSummary, routerAddress } = routeResp.data;
  verifyRouterAddress(routerAddress, META_AGGREGATION_ROUTER_V2);

  if (p.dryRun === true) {
    return ok({ dryRun: true, side, chain: slug, routeSummary, routerAddress });
  }

  const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
  if (tokenIn.address.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
    await ensureKyberAllowance(publicClient, walletClient, tokenIn.address, routerAddress, amountIn, p.approveExact === true);
  }

  const slippage = num(p, "slippageBps") ?? 50;
  const buildResp = await getKyberAggregatorClient().buildRoute(slug, {
    routeSummary,
    sender: wallet.address,
    recipient: (str(p, "recipient") || wallet.address) as Address,
    slippageTolerance: slippage,
  });

  const txHash = await sendKyberTransaction(publicClient, walletClient, {
    to: getAddress(buildResp.data.routerAddress),
    data: buildResp.data.data as Hex,
    value: BigInt(buildResp.data.transactionValue),
  });

  return {
    success: true,
    output: JSON.stringify({ txHash, side, chain: slug, tokenIn: tokenIn.symbol, tokenOut: tokenOut.symbol, amountIn: buildResp.data.amountIn, amountOut: buildResp.data.amountOut, amountInUsd: buildResp.data.amountInUsd, amountOutUsd: buildResp.data.amountOutUsd }, null, 2),
    data: { txHash, _tradeCapture: { type: "swap", chain: slug, status: "executed", inputToken: tokenIn.symbol, outputToken: tokenOut.symbol, inputTokenAddress: tokenIn.address, outputTokenAddress: tokenOut.address, inputAmount: buildResp.data.amountIn, outputAmount: buildResp.data.amountOut, signature: txHash, walletAddress: wallet.address, tradeSide: side, instrumentKey: `${slug}:${side === "buy" ? tokenOut.address : tokenIn.address}`, meta: { dex: "kyberswap", side } } },
  };
}

// ── Handler map ──────────────────────────────────────────────────

export const KYBERSWAP_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Chains ───────────────────────────────────────────────────────
  "kyberswap.chains": async () => ok(getKyberChains()),
  "kyberswap.chains.supported": async () => ok(await getKyberCommonClient().getSupportedChains()),

  // ── Tokens ───────────────────────────────────────────────────────
  "kyberswap.tokens.search": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { chainId } = resolveChainWithId(chain);
    const tokens = await getKyberTokenApiClient().searchTokens(String(chainId), {
      name: str(p, "query") || undefined,
      isWhitelisted: p.whitelisted === true ? true : undefined,
      pageSize: num(p, "limit"),
    });
    return ok({ chain, chainId, count: tokens.length, tokens });
  },
  "kyberswap.tokens.check": async (p) => {
    const chain = str(p, "chain"), address = str(p, "address");
    if (!chain || !address) return fail("Missing required: chain, address");
    const { chainId } = resolveChainWithId(chain);
    const info = await getKyberTokenApiClient().getHoneypotFotInfo(chainId, address);
    return ok({ chain, chainId, address, ...info });
  },

  // ── Swap ─────────────────────────────────────────────────────────
  "kyberswap.swap.quote": async (p) => {
    const chain = str(p, "chain"), tokenInRaw = str(p, "tokenIn"), tokenOutRaw = str(p, "tokenOut"), amountInRaw = str(p, "amountIn");
    if (!chain || !tokenInRaw || !tokenOutRaw || !amountInRaw) return fail("Missing required: chain, tokenIn, tokenOut, amountIn");

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "aggregator");
    const chainId = slugToChainId(slug);
    const tokenIn = await resolveTokenMetadata(tokenInRaw, chainId);
    const tokenOut = await resolveTokenMetadata(tokenOutRaw, chainId);
    const amountIn = parseUnits(amountInRaw, tokenIn.decimals).toString();

    const response = await getKyberAggregatorClient().getRoute(slug, {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn,
    });

    return ok({
      chain: slug, chainId,
      tokenIn: { address: tokenIn.address, symbol: tokenIn.symbol, decimals: tokenIn.decimals },
      tokenOut: { address: tokenOut.address, symbol: tokenOut.symbol, decimals: tokenOut.decimals },
      routeSummary: response.data.routeSummary,
      routerAddress: response.data.routerAddress,
    });
  },

  "kyberswap.swap.sell": (p) => executeKyberSwap(p, "sell"),
  "kyberswap.swap.buy": (p) => executeKyberSwap(p, "buy"),

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
    const makerToken = await resolveTokenMetadata(makerAssetRaw, chainId);
    const takerToken = await resolveTokenMetadata(takerAssetRaw, chainId);
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

    return ok({ chain: slug, orderId: result.orderId, makerAsset: makerToken.symbol, takerAsset: takerToken.symbol, makingAmount, takingAmount, expiredAt });
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

    return { success: true, output: JSON.stringify({ chain: slug, orderId, method: "gasless", status: "cancelled" }, null, 2), data: { orderId: String(orderId), _tradeCapture: { type: "swap", chain: slug, status: "cancelled", walletAddress: wallet.address, positionKey: String(orderId), meta: { orderType: "limitOrder", method: "gasless" } } } };
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

    return { success: true, output: JSON.stringify({ chain: slug, orderId, txHash, method: "hard-cancel" }, null, 2), data: { txHash, orderId: String(orderId), _tradeCapture: { type: "swap", chain: slug, status: "cancelled", walletAddress: wallet.address, positionKey: String(orderId), signature: txHash, meta: { orderType: "limitOrder", method: "hard-cancel" } } } };
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

    return { success: true, output: JSON.stringify({ chain: slug, orderId, txHash }, null, 2), data: { txHash, orderId: String(orderId), _tradeCapture: { type: "swap", chain: slug, status: "executed", walletAddress: wallet.address, positionKey: String(orderId), signature: txHash, tradeSide: "buy", meta: { orderType: "limitOrder", action: "fill" } } } };
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

    return { success: true, output: JSON.stringify({ chain: slug, orderIds, txHash }, null, 2), data: { txHash, _tradeCapture: { type: "swap", chain: slug, status: "executed", walletAddress: wallet.address, signature: txHash, tradeSide: "buy", meta: { orderType: "limitOrder", action: "batchFill", orderIds } } } };
  },

  "kyberswap.limitOrder.cancelAll": async (p) => {
    const chain = str(p, "chain");
    if (!chain) return fail("Missing required: chain");
    const { slug, chainId } = resolveChainWithId(chain);
    const wallet = requireEvmWallet();

    const encoded = await getKyberLimitOrderClient().encodeIncreaseNonce(String(chainId));
    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    const txHash = await sendKyberTransaction(publicClient, walletClient, {
      to: DSLO_PROTOCOL,
      data: encoded.encodedData as Hex,
    });

    return { success: true, output: JSON.stringify({ chain: slug, txHash, method: "increase-nonce", message: "All open orders cancelled" }, null, 2), data: { txHash, _tradeCapture: { type: "swap", chain: slug, status: "cancelled", walletAddress: wallet.address, signature: txHash, meta: { orderType: "limitOrder", action: "cancelAll" } } } };
  },

  // ── Zap ──────────────────────────────────────────────────────────
  "kyberswap.zap.in": async (p) => {
    const chain = str(p, "chain"), dex = str(p, "dex"), pool = str(p, "pool");
    const tokenIn = str(p, "tokenIn"), amountIn = str(p, "amountIn");
    if (!chain || !dex || !pool || !tokenIn || !amountIn) return fail("Missing required: chain, dex, pool, tokenIn, amountIn");

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "zaas");
    const wallet = requireEvmWallet();

    const routeResp = await getKyberZaasClient().getZapInRoute(slug, {
      dex,
      "pool.id": pool,
      tokensIn: tokenIn,
      amountsIn: amountIn,
      slippage: num(p, "slippageBps"),
      "position.id": str(p, "positionId") || undefined,
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
    const txHash = await sendKyberTransaction(publicClient, walletClient, { to: getAddress(buildResp.data.routerAddress), data: buildResp.data.callData as Hex, value: BigInt(buildResp.data.value) });

    return { success: true, output: JSON.stringify({ txHash, chain: slug, dex, pool }, null, 2), data: { txHash, _tradeCapture: { type: "lp", chain: slug, status: "executed", walletAddress: wallet.address, positionKey: str(p, "positionId") || undefined, instrumentKey: `${slug}:lp:${pool}`, meta: { dex, pool, action: "zap-in" } } } };
  },

  "kyberswap.zap.out": async (p) => {
    const chain = str(p, "chain"), dex = str(p, "dex"), pool = str(p, "pool");
    const positionId = str(p, "positionId"), tokenOut = str(p, "tokenOut");
    if (!chain || !dex || !pool || !positionId || !tokenOut) return fail("Missing required: chain, dex, pool, positionId, tokenOut");

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "zaas");
    const wallet = requireEvmWallet();

    const routeResp = await getKyberZaasClient().getZapOutRoute(slug, {
      dexFrom: dex,
      "poolFrom.id": pool,
      "positionFrom.id": positionId,
      tokenOut,
      liquidityOut: str(p, "liquidity") || undefined,
      slippage: num(p, "slippageBps"),
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, zapDetails: routeResp.data.zapDetails });
    }

    if (!routeResp.data.route || !routeResp.data.routerAddress) return fail("No zap route returned");
    verifyRouterAddress(routeResp.data.routerAddress, KS_ZAP_ROUTER_POSITION);
    const buildResp = await getKyberZaasClient().buildZapOut(slug, { sender: wallet.address, recipient: wallet.address, route: routeResp.data.route });
    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    const txHash = await sendKyberTransaction(publicClient, walletClient, { to: getAddress(buildResp.data.routerAddress), data: buildResp.data.callData as Hex, value: BigInt(buildResp.data.value) });

    return { success: true, output: JSON.stringify({ txHash, chain: slug, positionId }, null, 2), data: { txHash, _tradeCapture: { type: "lp", chain: slug, status: "executed", walletAddress: wallet.address, positionKey: positionId, instrumentKey: `${slug}:lp:${pool}`, meta: { dex, pool, action: "zap-out" } } } };
  },

  "kyberswap.zap.migrate": async (p) => {
    const chain = str(p, "chain"), dexFrom = str(p, "dexFrom"), dexTo = str(p, "dexTo");
    const poolFrom = str(p, "poolFrom"), poolTo = str(p, "poolTo"), positionId = str(p, "positionId");
    if (!chain || !dexFrom || !dexTo || !poolFrom || !poolTo || !positionId)
      return fail("Missing required: chain, dexFrom, dexTo, poolFrom, poolTo, positionId");

    const slug = resolveChainSlug(chain);
    requireFeature(slug, "zaas");
    const wallet = requireEvmWallet();

    const routeResp = await getKyberZaasClient().getZapMigrateRoute(slug, {
      dexFrom,
      dexTo,
      "poolFrom.id": poolFrom,
      "poolTo.id": poolTo,
      "positionFrom.id": positionId,
      "positionTo.tickLower": num(p, "tickLower"),
      "positionTo.tickUpper": num(p, "tickUpper"),
      liquidityOut: str(p, "liquidity") || undefined,
      slippage: num(p, "slippageBps"),
    });

    if (p.dryRun === true) {
      return ok({ dryRun: true, chain: slug, zapDetails: routeResp.data.zapDetails });
    }

    if (!routeResp.data.route || !routeResp.data.routerAddress) return fail("No zap route returned");
    verifyRouterAddress(routeResp.data.routerAddress, KS_ZAP_ROUTER_POSITION);
    const buildResp = await getKyberZaasClient().buildZapMigrate(slug, { sender: wallet.address, recipient: wallet.address, route: routeResp.data.route });
    const { publicClient, walletClient } = getKyberEvmClients(slug, wallet.privateKey);
    const txHash = await sendKyberTransaction(publicClient, walletClient, { to: getAddress(buildResp.data.routerAddress), data: buildResp.data.callData as Hex, value: BigInt(buildResp.data.value) });

    return { success: true, output: JSON.stringify({ txHash, chain: slug, positionId, from: poolFrom, to: poolTo }, null, 2), data: { txHash, _tradeCapture: { type: "lp", chain: slug, status: "executed", walletAddress: wallet.address, positionKey: positionId, instrumentKey: `${slug}:lp:${poolTo}`, meta: { dexFrom, dexTo, poolFrom, poolTo, action: "zap-migrate" } } } };
  },
};

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
