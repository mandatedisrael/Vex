/**
 * Polymarket CLOB handlers — market data (public).
 *
 * Orderbook, pricing, midpoints, spreads, trades, history, tick/fee, time.
 * No auth required.
 */

import { getPolyClobClient } from "@tools/polymarket/clob/client.js";
import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail } from "../../handler-helpers.js";
import { splitIds } from "./helpers.js";

// ── Market Data (public) ────────────────────────────────────────

export const MARKETS_HANDLERS: Record<string, ProtocolHandler> = {
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

  "polymarket.clob.simplifiedMarkets": async (p) => {
    return ok(await getPolyClobClient().getSimplifiedMarkets(str(p, "cursor") || undefined));
  },

  "polymarket.clob.batchPriceHistory": async (p) => {
    const marketsRaw = str(p, "markets");
    if (!marketsRaw) return fail("Missing required: markets");
    const markets = marketsRaw.split(",").map(s => s.trim()).filter(Boolean);
    if (markets.length === 0) return fail("No valid market IDs provided");
    if (markets.length > 20) return fail("Maximum 20 markets per batch request");
    const result = await getPolyClobClient().getBatchPriceHistory(markets, {
      startTs: num(p, "startTs"),
      endTs: num(p, "endTs"),
      interval: str(p, "interval") || undefined,
      fidelity: num(p, "fidelity"),
    });
    return ok(result);
  },
};
