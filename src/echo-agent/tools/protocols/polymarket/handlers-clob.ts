/**
 * Polymarket CLOB handlers — orderbook, pricing, trading.
 *
 * Market data: public. Trading: HMAC-SHA256 auth + EIP-712 order signing.
 * All 28 PolyClobClient methods covered (batch GET/POST consolidated).
 */

import { getPolyClobClient } from "@tools/polymarket/clob/client.js";
import { buildClobOrder, signClobOrder } from "@tools/polymarket/clob/signing.js";
import { requirePolyClobCredentials } from "@tools/polymarket/auth.js";
import { getPolyGammaClient } from "@tools/polymarket/gamma/client.js";
import { USDC_E_DECIMALS } from "@tools/polymarket/constants.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";
import { parseClobTokenIds } from "@commands/polymarket/helpers.js";
import type { Hex } from "viem";
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
function usdcToBaseUnits(amount: number): string {
  return Math.round(amount * 10 ** USDC_E_DECIMALS).toString();
}
function calcAmounts(side: "BUY" | "SELL", amount: number, price: number): { makerAmount: string; takerAmount: string } {
  if (side === "BUY") {
    return { makerAmount: usdcToBaseUnits(amount * price), takerAmount: usdcToBaseUnits(amount) };
  }
  return { makerAmount: usdcToBaseUnits(amount), takerAmount: usdcToBaseUnits(amount * price) };
}
function splitIds(raw: string): string[] {
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

// ── Market Data (public) ────────────────────────────────────────

export const CLOB_HANDLERS: Record<string, ProtocolHandler> = {
  "polymarket.clob.orderbook": async (p) => {
    const tokenId = str(p, "tokenId");
    if (!tokenId) return fail("Missing required: tokenId");
    return ok(await getPolyClobClient().getOrderBook(tokenId));
  },

  "polymarket.clob.orderbooks": async (p) => {
    const raw = str(p, "tokenIds");
    if (!raw) return fail("Missing required: tokenIds");
    return ok(await getPolyClobClient().getOrderBooks(splitIds(raw).map(token_id => ({ token_id }))));
  },

  "polymarket.clob.price": async (p) => {
    const tokenId = str(p, "tokenId"), side = str(p, "side");
    if (!tokenId || !side) return fail("Missing required: tokenId, side");
    return ok(await getPolyClobClient().getPrice(tokenId, side as "BUY" | "SELL"));
  },

  "polymarket.clob.prices": async (p) => {
    const tokenIds = str(p, "tokenIds"), sides = str(p, "sides");
    if (!tokenIds || !sides) return fail("Missing required: tokenIds, sides");
    return ok(await getPolyClobClient().getBatchPrices(splitIds(tokenIds), splitIds(sides)));
  },

  "polymarket.clob.midpoint": async (p) => {
    const tokenId = str(p, "tokenId");
    if (!tokenId) return fail("Missing required: tokenId");
    return ok(await getPolyClobClient().getMidpoint(tokenId));
  },

  "polymarket.clob.midpoints": async (p) => {
    const raw = str(p, "tokenIds");
    if (!raw) return fail("Missing required: tokenIds");
    return ok(await getPolyClobClient().getBatchMidpoints(splitIds(raw)));
  },

  "polymarket.clob.spread": async (p) => {
    const tokenId = str(p, "tokenId");
    if (!tokenId) return fail("Missing required: tokenId");
    return ok(await getPolyClobClient().getSpread(tokenId));
  },

  "polymarket.clob.spreads": async (p) => {
    const raw = str(p, "tokenIds");
    if (!raw) return fail("Missing required: tokenIds");
    return ok(await getPolyClobClient().getBatchSpreads(splitIds(raw).map(token_id => ({ token_id }))));
  },

  "polymarket.clob.lastTrade": async (p) => {
    const tokenId = str(p, "tokenId");
    if (!tokenId) return fail("Missing required: tokenId");
    return ok(await getPolyClobClient().getLastTradePrice(tokenId));
  },

  "polymarket.clob.lastTrades": async (p) => {
    const raw = str(p, "tokenIds");
    if (!raw) return fail("Missing required: tokenIds");
    return ok(await getPolyClobClient().getBatchLastTradesPrices(splitIds(raw)));
  },

  "polymarket.clob.priceHistory": async (p) => {
    const market = str(p, "market");
    if (!market) return fail("Missing required: market");
    return ok(await getPolyClobClient().getPriceHistory(market, {
      interval: str(p, "interval") || undefined,
      fidelity: num(p, "fidelity"),
      startTs: num(p, "startTs"),
      endTs: num(p, "endTs"),
    }));
  },

  "polymarket.clob.tickSize": async (p) => {
    const tokenId = str(p, "tokenId");
    if (!tokenId) return fail("Missing required: tokenId");
    return ok(await getPolyClobClient().getTickSize(tokenId));
  },

  "polymarket.clob.feeRate": async (p) => {
    const tokenId = str(p, "tokenId");
    if (!tokenId) return fail("Missing required: tokenId");
    return ok(await getPolyClobClient().getFeeRate(tokenId));
  },

  "polymarket.clob.serverTime": async () => {
    return ok({ serverTime: await getPolyClobClient().getServerTime() });
  },

  // ── Trading (authenticated) ───────────────────────────────────

  "polymarket.clob.buy": async (p) => {
    const conditionId = str(p, "conditionId"), outcomeRaw = str(p, "outcome");
    const amount = num(p, "amount");
    if (!conditionId || !outcomeRaw || amount == null) return fail("Missing required: conditionId, outcome, amount");
    if (amount <= 0) return fail("Amount must be positive");

    const outcome = outcomeRaw.toUpperCase() === "YES" ? "YES" : "NO";
    const market = await getPolyGammaClient().getMarket(conditionId);
    const tokens = parseClobTokenIds(market.clobTokenIds);
    const tokenId = outcome === "YES" ? tokens.yes : tokens.no;
    if (!tokenId) return fail(`No ${outcome} token found for market ${conditionId}`);

    const clob = getPolyClobClient();
    let price = num(p, "price") ?? null;
    if (price === null) {
      price = (await clob.getPrice(tokenId, "BUY")).price;
    }
    const shares = amount / price;

    if (p.dryRun === true) {
      return ok({ dryRun: true, conditionId, outcome, amount, price, shares: shares.toFixed(2), tokenId, question: market.question });
    }

    const wallet = requireEvmWallet();
    const creds = requirePolyClobCredentials();
    const feeRate = await clob.getFeeRate(tokenId);
    const { makerAmount, takerAmount } = calcAmounts("BUY", shares, price);
    const orderData = buildClobOrder({ maker: wallet.address, signer: wallet.address, tokenId, makerAmount, takerAmount, side: "BUY", feeRateBps: String(feeRate.base_fee) });
    const signature = await signClobOrder(wallet.privateKey as Hex, orderData, market.negRisk ?? false);

    const result = await clob.postOrder({
      order: { ...orderData, signature },
      owner: creds.apiKey,
      orderType: (str(p, "orderType") || "GTC") as "GTC" | "FOK" | "GTD",
    });

    const isMatched = result.status === "matched";
    return {
      success: true,
      output: JSON.stringify({ ...result, conditionId, outcome, amount, price }, null, 2),
      data: { ...result, conditionId, _tradeCapture: {
        type: isMatched ? "prediction" : "order",
        chain: "polygon",
        status: isMatched ? "executed" : "open",
        inputToken: "USDC", outputToken: `${outcome}@${conditionId.slice(0, 8)}`,
        inputAmount: String(amount), walletAddress: wallet.address, tradeSide: "buy",
        positionKey: isMatched ? `polymarket:${conditionId}:${outcome}` : result.orderID,
        instrumentKey: `polymarket:${conditionId}:${outcome}`,
        ...(isMatched ? { inputValueUsd: String(amount), unitPriceUsd: String(price), valuationSource: "polymarket_exact" } : { valuationSource: "none" }),
        meta: { dex: "polymarket", conditionId, outcome, price, orderID: result.orderID },
      } },
    };
  },

  "polymarket.clob.sell": async (p) => {
    const conditionId = str(p, "conditionId"), outcomeRaw = str(p, "outcome");
    const shares = num(p, "amount");
    if (!conditionId || !outcomeRaw || shares == null) return fail("Missing required: conditionId, outcome, amount");
    if (shares <= 0) return fail("Amount must be positive");

    const outcome = outcomeRaw.toUpperCase() === "YES" ? "YES" : "NO";
    const market = await getPolyGammaClient().getMarket(conditionId);
    const tokens = parseClobTokenIds(market.clobTokenIds);
    const tokenId = outcome === "YES" ? tokens.yes : tokens.no;
    if (!tokenId) return fail(`No ${outcome} token found for market ${conditionId}`);

    const clob = getPolyClobClient();
    let price = num(p, "price") ?? null;
    if (price === null) {
      price = (await clob.getPrice(tokenId, "SELL")).price;
    }

    if (p.dryRun === true) {
      return ok({ dryRun: true, conditionId, outcome, shares, price, usdcValue: (shares * price).toFixed(2), tokenId, question: market.question });
    }

    const wallet = requireEvmWallet();
    const creds = requirePolyClobCredentials();
    const feeRate = await clob.getFeeRate(tokenId);
    const { makerAmount, takerAmount } = calcAmounts("SELL", shares, price);
    const orderData = buildClobOrder({ maker: wallet.address, signer: wallet.address, tokenId, makerAmount, takerAmount, side: "SELL", feeRateBps: String(feeRate.base_fee) });
    const signature = await signClobOrder(wallet.privateKey as Hex, orderData, market.negRisk ?? false);

    const result = await clob.postOrder({ order: { ...orderData, signature }, owner: creds.apiKey, orderType: (str(p, "orderType") || "GTC") as "GTC" | "FOK" | "GTD" });

    const isMatched = result.status === "matched";
    return {
      success: true,
      output: JSON.stringify({ ...result, conditionId, outcome, shares, price }, null, 2),
      data: { ...result, conditionId, _tradeCapture: {
        type: isMatched ? "prediction" : "order",
        chain: "polygon",
        status: isMatched ? "closed" : "open",
        outputToken: "USDC", inputToken: `${outcome}@${conditionId.slice(0, 8)}`,
        inputAmount: String(shares), walletAddress: wallet.address, tradeSide: "sell",
        positionKey: isMatched ? `polymarket:${conditionId}:${outcome}` : result.orderID,
        instrumentKey: `polymarket:${conditionId}:${outcome}`,
        ...(isMatched ? { outputValueUsd: String(shares * price), unitPriceUsd: String(price), valuationSource: "polymarket_exact" } : { valuationSource: "none" }),
        meta: { dex: "polymarket", conditionId, outcome, price, orderID: result.orderID },
      } },
    };
  },

  "polymarket.clob.cancel": async (p) => {
    const orderId = str(p, "orderId");
    if (!orderId) return fail("Missing required: orderId");
    const wallet = requireEvmWallet();
    const result = await getPolyClobClient().cancelOrder(orderId);
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, orderId, _tradeCapture: { type: "order", chain: "polygon", status: "cancelled", walletAddress: wallet.address, positionKey: orderId, meta: { action: "cancel" } } } };
  },

  "polymarket.clob.cancelOrders": async (p) => {
    const raw = str(p, "orderIds");
    if (!raw) return fail("Missing required: orderIds");
    const ids = splitIds(raw);
    if (ids.length === 0) return fail("No valid order IDs provided");
    const wallet = requireEvmWallet();
    const result = await getPolyClobClient().cancelOrders(ids);
    const captureItems = result.canceled.map(oid => ({
      type: "order" as const, chain: "polygon" as const, status: "cancelled" as const,
      walletAddress: wallet.address, positionKey: oid, meta: { action: "cancel" },
    }));
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "order", chain: "polygon", status: "cancelled", walletAddress: wallet.address, meta: { action: "cancelOrders", count: result.canceled.length } }, _tradeCaptureItems: captureItems } };
  },

  "polymarket.clob.cancelAll": async () => {
    const wallet = requireEvmWallet();
    const result = await getPolyClobClient().cancelAll();
    const captureItems = result.canceled.map(oid => ({
      type: "order" as const, chain: "polygon" as const, status: "cancelled" as const,
      walletAddress: wallet.address, positionKey: oid, meta: { action: "cancel" },
    }));
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, _tradeCapture: { type: "order", chain: "polygon", status: "cancelled", walletAddress: wallet.address, meta: { action: "cancelAll", count: result.canceled.length } }, _tradeCaptureItems: captureItems.length > 0 ? captureItems : undefined } };
  },

  "polymarket.clob.cancelMarket": async (p) => {
    const market = str(p, "market"), assetId = str(p, "assetId");
    if (!market || !assetId) return fail("Missing required: market, assetId");
    const wallet = requireEvmWallet();
    const result = await getPolyClobClient().cancelMarketOrders(market, assetId);
    const captureItems = result.canceled.map(oid => ({
      type: "order" as const, chain: "polygon" as const, status: "cancelled" as const,
      walletAddress: wallet.address, positionKey: oid, meta: { action: "cancelMarket", conditionId: market, assetId },
    }));
    return { success: true, output: JSON.stringify(result, null, 2), data: { ...result, conditionId: market, _tradeCapture: { type: "order", chain: "polygon", status: "cancelled", walletAddress: wallet.address, meta: { action: "cancelMarket", conditionId: market, assetId } }, _tradeCaptureItems: captureItems.length > 0 ? captureItems : undefined } };
  },

  "polymarket.clob.orders": async (p) => {
    return ok(await getPolyClobClient().getOrders({
      market: str(p, "market") || undefined,
      asset_id: str(p, "assetId") || undefined,
      next_cursor: str(p, "cursor") || undefined,
    }));
  },

  "polymarket.clob.order": async (p) => {
    const orderId = str(p, "orderId");
    if (!orderId) return fail("Missing required: orderId");
    return ok(await getPolyClobClient().getOrder(orderId));
  },

  "polymarket.clob.trades": async (p) => {
    const wallet = requireEvmWallet();
    return ok(await getPolyClobClient().getTrades({
      maker_address: wallet.address,
      market: str(p, "market") || undefined,
      asset_id: str(p, "assetId") || undefined,
      next_cursor: str(p, "cursor") || undefined,
    }));
  },

  "polymarket.clob.heartbeat": async () => {
    return ok(await getPolyClobClient().sendHeartbeat());
  },

  "polymarket.clob.orderScoring": async (p) => {
    const orderId = str(p, "orderId");
    if (!orderId) return fail("Missing required: orderId");
    return ok(await getPolyClobClient().getOrderScoring(orderId));
  },
};
