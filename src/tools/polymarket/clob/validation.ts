/**
 * Runtime validators for Polymarket CLOB API responses.
 */

import { ErrorCodes } from "../../../errors.js";
import { isRecord, createFieldValidators } from "../../../utils/validation-helpers.js";
import type {
  OrderBookSummary, OrderSummary, SendOrderResponse,
  OpenOrder, PaginatedOrders, CancelResponse,
  ClobTrade, PaginatedTrades, PriceHistoryResponse,
  LastTradePrice, OrderScoringResponse,
} from "./types.js";

const { asString, asOptionalString } = createFieldValidators(
  ErrorCodes.POLYMARKET_API_ERROR, "Polymarket CLOB",
);

function parseOrderSummary(raw: unknown): OrderSummary {
  if (!isRecord(raw)) return { price: "0", size: "0" };
  return {
    price: typeof raw.price === "string" ? raw.price : String(raw.price ?? "0"),
    size: typeof raw.size === "string" ? raw.size : String(raw.size ?? "0"),
  };
}

export function validateOrderBookResponse(raw: unknown): OrderBookSummary {
  if (!isRecord(raw)) throw new Error("Expected orderbook object");
  return {
    market: typeof raw.market === "string" ? raw.market : "",
    asset_id: typeof raw.asset_id === "string" ? raw.asset_id : "",
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
    hash: typeof raw.hash === "string" ? raw.hash : "",
    bids: Array.isArray(raw.bids) ? raw.bids.map(parseOrderSummary) : [],
    asks: Array.isArray(raw.asks) ? raw.asks.map(parseOrderSummary) : [],
    min_order_size: typeof raw.min_order_size === "string" ? raw.min_order_size : "1",
    tick_size: typeof raw.tick_size === "string" ? raw.tick_size : "0.01",
    neg_risk: raw.neg_risk === true,
    last_trade_price: typeof raw.last_trade_price === "string" ? raw.last_trade_price : "0.5",
  };
}

export function validateSendOrderResponse(raw: unknown): SendOrderResponse {
  if (!isRecord(raw)) throw new Error("Expected order response object");
  return {
    success: raw.success === true,
    orderID: typeof raw.orderID === "string" ? raw.orderID : "",
    status: (raw.status === "live" || raw.status === "matched" || raw.status === "delayed") ? raw.status : "delayed",
    makingAmount: asOptionalString(raw.makingAmount),
    takingAmount: asOptionalString(raw.takingAmount),
    transactionsHashes: Array.isArray(raw.transactionsHashes) ? raw.transactionsHashes.filter((t): t is string => typeof t === "string") : undefined,
    tradeIDs: Array.isArray(raw.tradeIDs) ? raw.tradeIDs.filter((t): t is string => typeof t === "string") : undefined,
    errorMsg: typeof raw.errorMsg === "string" ? raw.errorMsg : "",
  };
}

function parseOpenOrder(raw: unknown): OpenOrder {
  if (!isRecord(raw)) throw new Error("order must be an object");
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    status: typeof raw.status === "string" ? raw.status : "",
    owner: typeof raw.owner === "string" ? raw.owner : "",
    maker_address: typeof raw.maker_address === "string" ? raw.maker_address : "",
    market: typeof raw.market === "string" ? raw.market : "",
    asset_id: typeof raw.asset_id === "string" ? raw.asset_id : "",
    side: raw.side === "SELL" ? "SELL" : "BUY",
    original_size: typeof raw.original_size === "string" ? raw.original_size : "0",
    size_matched: typeof raw.size_matched === "string" ? raw.size_matched : "0",
    price: typeof raw.price === "string" ? raw.price : "0",
    outcome: typeof raw.outcome === "string" ? raw.outcome : "",
    expiration: typeof raw.expiration === "string" ? raw.expiration : "",
    order_type: (raw.order_type === "GTC" || raw.order_type === "FOK" || raw.order_type === "GTD" || raw.order_type === "FAK") ? raw.order_type : "GTC",
    associate_trades: Array.isArray(raw.associate_trades) ? raw.associate_trades.filter((t): t is string => typeof t === "string") : [],
    created_at: typeof raw.created_at === "number" ? raw.created_at : 0,
  };
}

export function validatePaginatedOrders(raw: unknown): PaginatedOrders {
  if (!isRecord(raw)) throw new Error("Expected paginated orders");
  return {
    limit: typeof raw.limit === "number" ? raw.limit : 100,
    next_cursor: typeof raw.next_cursor === "string" ? raw.next_cursor : "",
    count: typeof raw.count === "number" ? raw.count : 0,
    data: Array.isArray(raw.data) ? raw.data.map(parseOpenOrder) : [],
  };
}

export function validateOpenOrder(raw: unknown): OpenOrder {
  return parseOpenOrder(raw);
}

export function validateCancelResponse(raw: unknown): CancelResponse {
  if (!isRecord(raw)) throw new Error("Expected cancel response");
  return {
    canceled: Array.isArray(raw.canceled) ? raw.canceled.filter((c): c is string => typeof c === "string") : [],
    not_canceled: isRecord(raw.not_canceled) ? raw.not_canceled as Record<string, string> : {},
  };
}

function parseClobTrade(raw: unknown): ClobTrade {
  if (!isRecord(raw)) throw new Error("trade must be an object");
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    taker_order_id: typeof raw.taker_order_id === "string" ? raw.taker_order_id : "",
    market: typeof raw.market === "string" ? raw.market : "",
    asset_id: typeof raw.asset_id === "string" ? raw.asset_id : "",
    side: raw.side === "SELL" ? "SELL" : "BUY",
    size: typeof raw.size === "string" ? raw.size : "0",
    fee_rate_bps: typeof raw.fee_rate_bps === "string" ? raw.fee_rate_bps : "0",
    price: typeof raw.price === "string" ? raw.price : "0",
    status: typeof raw.status === "string" ? raw.status : "",
    match_time: typeof raw.match_time === "string" ? raw.match_time : "",
    last_update: typeof raw.last_update === "string" ? raw.last_update : "",
    outcome: typeof raw.outcome === "string" ? raw.outcome : "",
    owner: typeof raw.owner === "string" ? raw.owner : "",
    maker_address: typeof raw.maker_address === "string" ? raw.maker_address : "",
    transaction_hash: asOptionalString(raw.transaction_hash) ?? null,
    trader_side: raw.trader_side === "MAKER" ? "MAKER" : "TAKER",
  };
}

export function validatePaginatedTrades(raw: unknown): PaginatedTrades {
  if (!isRecord(raw)) throw new Error("Expected paginated trades");
  return {
    limit: typeof raw.limit === "number" ? raw.limit : 100,
    next_cursor: typeof raw.next_cursor === "string" ? raw.next_cursor : "",
    count: typeof raw.count === "number" ? raw.count : 0,
    data: Array.isArray(raw.data) ? raw.data.map(parseClobTrade) : [],
  };
}

export function validatePriceHistoryResponse(raw: unknown): PriceHistoryResponse {
  if (!isRecord(raw)) return { history: [] };
  return {
    history: Array.isArray(raw.history) ? raw.history.map((p: unknown) => {
      if (!isRecord(p)) return { t: 0, p: 0 };
      return { t: typeof p.t === "number" ? p.t : 0, p: typeof p.p === "number" ? p.p : 0 };
    }) : [],
  };
}

export function validatePriceResponse(raw: unknown): { price: number } {
  if (!isRecord(raw)) return { price: 0 };
  return { price: typeof raw.price === "number" ? raw.price : 0 };
}

export function validateMidpointResponse(raw: unknown): { mid_price: string } {
  if (!isRecord(raw)) return { mid_price: "0" };
  return { mid_price: typeof raw.mid_price === "string" ? raw.mid_price : "0" };
}

export function validateSpreadResponse(raw: unknown): { spread: string } {
  if (!isRecord(raw)) return { spread: "0" };
  return { spread: typeof raw.spread === "string" ? raw.spread : "0" };
}

export function validateLastTradePriceResponse(raw: unknown): { price: string; side: string } {
  if (!isRecord(raw)) return { price: "0.5", side: "" };
  return {
    price: typeof raw.price === "string" ? raw.price : "0.5",
    side: typeof raw.side === "string" ? raw.side : "",
  };
}

export function validateTickSizeResponse(raw: unknown): { minimum_tick_size: number } {
  if (!isRecord(raw)) return { minimum_tick_size: 0.01 };
  return { minimum_tick_size: typeof raw.minimum_tick_size === "number" ? raw.minimum_tick_size : 0.01 };
}

export function validateFeeRateResponse(raw: unknown): { base_fee: number } {
  if (!isRecord(raw)) return { base_fee: 0 };
  return { base_fee: typeof raw.base_fee === "number" ? raw.base_fee : 0 };
}

export function validateSendOrdersResponse(raw: unknown): SendOrderResponse[] {
  if (!Array.isArray(raw)) throw new Error("Expected orders response array");
  return raw.map(validateSendOrderResponse);
}

// ── Batch validators ──────────────────────────────────────────────

export function validateBatchOrderBooksResponse(raw: unknown): OrderBookSummary[] {
  if (!Array.isArray(raw)) throw new Error("Expected batch orderbooks array");
  return raw.map(validateOrderBookResponse);
}

export function validateBatchPricesResponse(raw: unknown): Record<string, Record<string, number>> {
  if (!isRecord(raw)) return {};
  const result: Record<string, Record<string, number>> = {};
  for (const [tokenId, sides] of Object.entries(raw)) {
    if (isRecord(sides)) {
      result[tokenId] = {};
      for (const [side, price] of Object.entries(sides as Record<string, unknown>)) {
        if (typeof price === "number") result[tokenId][side] = price;
      }
    }
  }
  return result;
}

export function validateBatchMidpointsResponse(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const result: Record<string, string> = {};
  for (const [tokenId, price] of Object.entries(raw)) {
    if (typeof price === "string") result[tokenId] = price;
  }
  return result;
}

export function validateBatchSpreadsResponse(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const result: Record<string, string> = {};
  for (const [tokenId, spread] of Object.entries(raw)) {
    if (typeof spread === "string") result[tokenId] = spread;
  }
  return result;
}

export function validateBatchLastTradesPricesResponse(raw: unknown): LastTradePrice[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((item) => ({
    token_id: typeof item.token_id === "string" ? item.token_id : "",
    price: typeof item.price === "string" ? item.price : "0.5",
    side: (item.side === "BUY" || item.side === "SELL") ? item.side : "BUY",
  }));
}

export function validateOrderScoringResponse(raw: unknown): OrderScoringResponse {
  if (!isRecord(raw)) return { scoring: false };
  return { scoring: raw.scoring === true };
}
