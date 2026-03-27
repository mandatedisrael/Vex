/**
 * Polymarket CLOB API client — orderbook, pricing, and trading.
 *
 * Market data endpoints: no auth. Trading endpoints: HMAC-SHA256 auth.
 * Singleton via getPolyClobClient().
 */

import { loadConfig } from "../../../config/store.js";
import { fetchWithTimeout, readJson } from "../../../utils/http.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import { mapPolyTransportError, mapPolyApiError } from "../errors.js";
import { CLOB_BASE_URL, CLOB_TIMEOUT_MS } from "../constants.js";
import { buildClobHeaders, requirePolyClobCredentials } from "../auth.js";
import { requireEvmWallet } from "../../wallet/multi-auth.js";
import {
  validateOrderBookResponse, validatePriceResponse, validateMidpointResponse,
  validateSpreadResponse, validateLastTradePriceResponse,
  validatePriceHistoryResponse, validateTickSizeResponse, validateFeeRateResponse,
  validateSendOrderResponse, validateSendOrdersResponse,
  validatePaginatedOrders, validateOpenOrder,
  validateCancelResponse, validatePaginatedTrades,
  validateBatchOrderBooksResponse, validateBatchPricesResponse,
  validateBatchMidpointsResponse, validateBatchSpreadsResponse,
  validateBatchLastTradesPricesResponse, validateOrderScoringResponse,
} from "./validation.js";
import logger from "../../../utils/logger.js";
import type { EchoError } from "../../../errors.js";
import type {
  OrderBookSummary, SendOrderRequest, SendOrderResponse,
  OpenOrder, PaginatedOrders, CancelResponse, PaginatedTrades,
  PriceHistoryResponse, BookRequest, LastTradePrice, OrderScoringResponse,
} from "./types.js";

export class PolyClobClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = CLOB_TIMEOUT_MS,
  ) {}

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value.length > 0) url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  /** Unauthenticated request (market data). */
  private async requestPublic<T>(path: string, validator: (raw: unknown) => T, query?: Record<string, string | undefined>): Promise<T> {
    const url = this.buildUrl(path, query);
    try {
      logger.debug({ event: "polymarket.clob.request.start", path });
      const response = await fetchWithTimeout(url, { timeoutMs: this.timeoutMs });
      if (!response.ok) {
        const raw = await readJson(response);
        const message = isRecord(raw) && typeof raw.error === "string" ? raw.error : `HTTP ${response.status}`;
        logger.warn({ event: "polymarket.clob.request.error", path, status: response.status });
        throw mapPolyApiError(response.status, message, "CLOB");
      }
      const raw = await readJson(response);
      const result = validator(raw);
      logger.debug({ event: "polymarket.clob.request.success", path });
      return result;
    } catch (err) {
      if ((err as EchoError).code?.startsWith("POLYMARKET_")) throw err;
      mapPolyTransportError(err);
    }
  }

  /** Authenticated request (trading). Uses HMAC-SHA256 headers. */
  private async requestAuth<T>(
    method: string,
    path: string,
    validator: (raw: unknown) => T,
    body?: unknown,
  ): Promise<T> {
    const creds = requirePolyClobCredentials();
    const { address } = requireEvmWallet();
    const bodyStr = body !== undefined ? JSON.stringify(body) : "";
    const headers = buildClobHeaders(creds.apiKey, address, creds.passphrase, method, path, bodyStr, creds.apiSecret);

    const url = this.buildUrl(path);
    try {
      logger.debug({ event: "polymarket.clob.auth_request.start", path, method });
      const response = await fetchWithTimeout(url, {
        method,
        headers: {
          ...headers,
          ...(body !== undefined ? { "Content-Type": "application/json" } : undefined),
        },
        body: body !== undefined ? bodyStr : undefined,
        timeoutMs: this.timeoutMs,
      });
      if (!response.ok) {
        const raw = await readJson(response);
        const message = isRecord(raw) && typeof raw.error === "string" ? raw.error : `HTTP ${response.status}`;
        logger.warn({ event: "polymarket.clob.auth_request.error", path, status: response.status });
        throw mapPolyApiError(response.status, message, "CLOB");
      }
      const raw = await readJson(response);
      const result = validator(raw);
      logger.debug({ event: "polymarket.clob.auth_request.success", path });
      return result;
    } catch (err) {
      if ((err as EchoError).code?.startsWith("POLYMARKET_")) throw err;
      mapPolyTransportError(err);
    }
  }

  // ── Market Data (public) ────────────────────────────────────────

  getOrderBook(tokenId: string): Promise<OrderBookSummary> {
    return this.requestPublic("/book", validateOrderBookResponse, { token_id: tokenId });
  }

  getPrice(tokenId: string, side: "BUY" | "SELL"): Promise<{ price: number }> {
    return this.requestPublic("/price", validatePriceResponse, { token_id: tokenId, side });
  }

  getMidpoint(tokenId: string): Promise<{ mid_price: string }> {
    return this.requestPublic("/midpoint", validateMidpointResponse, { token_id: tokenId });
  }

  getSpread(tokenId: string): Promise<{ spread: string }> {
    return this.requestPublic("/spread", validateSpreadResponse, { token_id: tokenId });
  }

  getLastTradePrice(tokenId: string): Promise<{ price: string; side: string }> {
    return this.requestPublic("/last-trade-price", validateLastTradePriceResponse, { token_id: tokenId });
  }

  getPriceHistory(market: string, opts?: { startTs?: number; endTs?: number; interval?: string; fidelity?: number }): Promise<PriceHistoryResponse> {
    const query: Record<string, string | undefined> = { market };
    if (opts?.startTs != null) query.startTs = String(opts.startTs);
    if (opts?.endTs != null) query.endTs = String(opts.endTs);
    if (opts?.interval) query.interval = opts.interval;
    if (opts?.fidelity != null) query.fidelity = String(opts.fidelity);
    return this.requestPublic("/prices-history", validatePriceHistoryResponse, query);
  }

  getTickSize(tokenId: string): Promise<{ minimum_tick_size: number }> {
    return this.requestPublic("/tick-size", validateTickSizeResponse, { token_id: tokenId });
  }

  getFeeRate(tokenId: string): Promise<{ base_fee: number }> {
    return this.requestPublic("/fee-rate", validateFeeRateResponse, { token_id: tokenId });
  }

  getServerTime(): Promise<number> {
    return this.requestPublic("/time", (raw) => typeof raw === "number" ? raw : 0);
  }

  // ── Batch Market Data (public, POST body) ────────────────────────

  /** Unauthenticated POST (batch market data). */
  private async requestPublicPost<T>(path: string, validator: (raw: unknown) => T, body: unknown): Promise<T> {
    const url = this.buildUrl(path);
    try {
      logger.debug({ event: "polymarket.clob.batch_request.start", path });
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        timeoutMs: this.timeoutMs,
      });
      if (!response.ok) {
        const raw = await readJson(response);
        const message = isRecord(raw) && typeof raw.error === "string" ? raw.error : `HTTP ${response.status}`;
        throw mapPolyApiError(response.status, message, "CLOB");
      }
      return validator(await readJson(response));
    } catch (err) {
      if ((err as EchoError).code?.startsWith("POLYMARKET_")) throw err;
      mapPolyTransportError(err);
    }
  }

  getOrderBooks(tokenIds: BookRequest[]): Promise<OrderBookSummary[]> {
    return this.requestPublicPost("/books", validateBatchOrderBooksResponse, tokenIds);
  }

  getBatchPrices(tokenIds: string[], sides: string[]): Promise<Record<string, Record<string, number>>> {
    return this.requestPublic("/prices", validateBatchPricesResponse, {
      token_ids: tokenIds.join(","),
      sides: sides.join(","),
    });
  }

  getBatchPricesPost(requests: BookRequest[]): Promise<Record<string, Record<string, number>>> {
    return this.requestPublicPost("/prices", validateBatchPricesResponse, requests);
  }

  getBatchMidpoints(tokenIds: string[]): Promise<Record<string, string>> {
    return this.requestPublic("/midpoints", validateBatchMidpointsResponse, {
      token_ids: tokenIds.join(","),
    });
  }

  getBatchMidpointsPost(requests: BookRequest[]): Promise<Record<string, string>> {
    return this.requestPublicPost("/midpoints", validateBatchMidpointsResponse, requests);
  }

  getBatchSpreads(requests: BookRequest[]): Promise<Record<string, string>> {
    return this.requestPublicPost("/spreads", validateBatchSpreadsResponse, requests);
  }

  getBatchLastTradesPrices(tokenIds: string[]): Promise<LastTradePrice[]> {
    return this.requestPublic("/last-trades-prices", validateBatchLastTradesPricesResponse, {
      token_ids: tokenIds.join(","),
    });
  }

  getBatchLastTradesPricesPost(requests: BookRequest[]): Promise<LastTradePrice[]> {
    return this.requestPublicPost("/last-trades-prices", validateBatchLastTradesPricesResponse, requests);
  }

  getOrderScoring(orderId: string): Promise<OrderScoringResponse> {
    return this.requestAuth("GET", "/order-scoring", validateOrderScoringResponse);
  }

  // ── Trading (authenticated) ─────────────────────────────────────

  postOrder(order: SendOrderRequest): Promise<SendOrderResponse> {
    return this.requestAuth("POST", "/order", validateSendOrderResponse, order);
  }

  postOrders(orders: SendOrderRequest[]): Promise<SendOrderResponse[]> {
    return this.requestAuth("POST", "/orders", validateSendOrdersResponse, orders);
  }

  cancelOrder(orderId: string): Promise<CancelResponse> {
    return this.requestAuth("DELETE", "/order", validateCancelResponse, { orderID: orderId });
  }

  cancelOrders(orderIds: string[]): Promise<CancelResponse> {
    return this.requestAuth("DELETE", "/orders", validateCancelResponse, orderIds);
  }

  cancelAll(): Promise<CancelResponse> {
    return this.requestAuth("DELETE", "/cancel-all", validateCancelResponse);
  }

  cancelMarketOrders(market: string, assetId: string): Promise<CancelResponse> {
    return this.requestAuth("DELETE", "/cancel-market-orders", validateCancelResponse, { market, asset_id: assetId });
  }

  getOrders(opts?: { id?: string; market?: string; asset_id?: string; next_cursor?: string }): Promise<PaginatedOrders> {
    const query: Record<string, string | undefined> = {};
    if (opts?.id) query.id = opts.id;
    if (opts?.market) query.market = opts.market;
    if (opts?.asset_id) query.asset_id = opts.asset_id;
    if (opts?.next_cursor) query.next_cursor = opts.next_cursor;
    return this.requestAuth("GET", "/orders", validatePaginatedOrders);
  }

  getOrder(orderId: string): Promise<OpenOrder> {
    return this.requestAuth("GET", `/order/${encodeURIComponent(orderId)}`, validateOpenOrder);
  }

  getTrades(opts?: { maker_address: string; market?: string; asset_id?: string; next_cursor?: string }): Promise<PaginatedTrades> {
    return this.requestAuth("GET", "/trades", validatePaginatedTrades);
  }

  sendHeartbeat(): Promise<{ status: string }> {
    return this.requestAuth("POST", "/heartbeats", (raw) => {
      if (isRecord(raw) && typeof raw.status === "string") return { status: raw.status };
      return { status: "ok" };
    });
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let cachedClient: PolyClobClient | null = null;
let cachedBaseUrl: string | null = null;

export function getPolyClobClient(): PolyClobClient {
  const cfg = loadConfig();
  const baseUrl = cfg.polymarket?.clobBaseUrl ?? CLOB_BASE_URL;
  if (cachedClient && cachedBaseUrl === baseUrl) return cachedClient;
  cachedClient = new PolyClobClient(baseUrl);
  cachedBaseUrl = baseUrl;
  return cachedClient;
}
