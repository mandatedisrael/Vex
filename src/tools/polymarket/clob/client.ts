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
import {
  validateSimplifiedMarketsResponse, validateRebatesResponse,
  validateCurrentRewardsResponse, validateMarketRewardsResponse,
  validateMultiMarketRewardsResponse, validateUserEarningsResponse,
  validateUserTotalEarningsResponse, validateUserRewardPercentagesResponse,
  validateUserEarningsMarketsResponse,
} from "./validation/rewards.js";
import logger from "../../../utils/logger.js";
import { buildClobUrl, clobErrorMessage, buildClobAuthHeaders } from "./client/http.js";
import type { VexError } from "../../../errors.js";
import type {
  OrderBookSummary, SendOrderRequest, SendOrderResponse,
  OpenOrder, PaginatedOrders, CancelResponse, PaginatedTrades,
  PriceHistoryResponse, BookRequest, LastTradePrice, OrderScoringResponse,
  PaginatedSimplifiedMarkets, RebateEntry, PaginatedCurrentRewards,
  PaginatedMarketRewards, PaginatedMultiMarketInfo, PaginatedUserEarnings,
  UserTotalEarningEntry, UserRewardPercentages, PaginatedUserRewardsMarkets,
} from "./types.js";

/**
 * Per-call auth identity for CLOB HMAC headers. The wallet address is resolved
 * by the caller (session-scoped) and passed to every authenticated method — the
 * client never resolves a wallet itself, and never caches auth state on the
 * singleton (puzzle 5 phase 5D-protocols p3).
 */
export interface ClobAuthContext {
  address: string;
}

export class PolyClobClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = CLOB_TIMEOUT_MS,
  ) {}

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    return buildClobUrl(this.baseUrl, path, query);
  }

  /** Unauthenticated request (market data). */
  private async requestPublic<T>(path: string, validator: (raw: unknown) => T, query?: Record<string, string | undefined>): Promise<T> {
    const url = this.buildUrl(path, query);
    try {
      logger.debug({ event: "polymarket.clob.request.start", path });
      const response = await fetchWithTimeout(url, { timeoutMs: this.timeoutMs });
      if (!response.ok) {
        const raw = await readJson(response);
        const message = clobErrorMessage(raw, response.status);
        logger.warn({ event: "polymarket.clob.request.error", path, status: response.status });
        throw mapPolyApiError(response.status, message, "CLOB");
      }
      const raw = await readJson(response);
      const result = validator(raw);
      logger.debug({ event: "polymarket.clob.request.success", path });
      return result;
    } catch (err) {
      if ((err as VexError).code?.startsWith("POLYMARKET_")) throw err;
      mapPolyTransportError(err);
    }
  }

  /** Authenticated request (trading). Uses HMAC-SHA256 headers.
   *  HMAC signs path only (without query string) — query params go to URL separately. */
  private async requestAuth<T>(
    auth: ClobAuthContext,
    method: string,
    path: string,
    validator: (raw: unknown) => T,
    body?: unknown,
    query?: Record<string, string | undefined>,
  ): Promise<T> {
    const { address } = auth;
    const creds = requirePolyClobCredentials(address);
    const bodyStr = body !== undefined ? JSON.stringify(body) : "";
    // HMAC signs path without query — per Polymarket CLOB auth spec
    const headers = buildClobHeaders(creds.apiKey, address, creds.passphrase, method, path, bodyStr, creds.apiSecret);

    const url = this.buildUrl(path, query);
    try {
      logger.debug({ event: "polymarket.clob.auth_request.start", path, method });
      const response = await fetchWithTimeout(url, {
        method,
        headers: buildClobAuthHeaders(headers, body),
        body: body !== undefined ? bodyStr : undefined,
        timeoutMs: this.timeoutMs,
      });
      if (!response.ok) {
        const raw = await readJson(response);
        const message = clobErrorMessage(raw, response.status);
        logger.warn({ event: "polymarket.clob.auth_request.error", path, status: response.status });
        throw mapPolyApiError(response.status, message, "CLOB");
      }
      const raw = await readJson(response);
      const result = validator(raw);
      logger.debug({ event: "polymarket.clob.auth_request.success", path });
      return result;
    } catch (err) {
      if ((err as VexError).code?.startsWith("POLYMARKET_")) throw err;
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
        const message = clobErrorMessage(raw, response.status);
        throw mapPolyApiError(response.status, message, "CLOB");
      }
      return validator(await readJson(response));
    } catch (err) {
      if ((err as VexError).code?.startsWith("POLYMARKET_")) throw err;
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

  getBatchPriceHistory(markets: string[], opts?: { startTs?: number; endTs?: number; interval?: string; fidelity?: number }): Promise<PriceHistoryResponse[]> {
    const body: Record<string, unknown> = { markets };
    if (opts?.startTs != null) body.start_ts = opts.startTs;
    if (opts?.endTs != null) body.end_ts = opts.endTs;
    if (opts?.interval) body.interval = opts.interval;
    if (opts?.fidelity != null) body.fidelity = opts.fidelity;
    return this.requestPublicPost("/prices-history", (raw) => {
      if (Array.isArray(raw)) return raw.map(r => validatePriceHistoryResponse(r));
      return [validatePriceHistoryResponse(raw)];
    }, body);
  }

  getSimplifiedMarkets(nextCursor?: string): Promise<PaginatedSimplifiedMarkets> {
    return this.requestPublic("/simplified-markets", validateSimplifiedMarketsResponse, nextCursor ? { next_cursor: nextCursor } : undefined);
  }

  getRebates(date: string, makerAddress: string): Promise<RebateEntry[]> {
    return this.requestPublic("/rebates/current", validateRebatesResponse, { date, maker_address: makerAddress });
  }

  // ── Rewards (public) ───────────────────────────────────────────────

  getActiveRewards(opts?: { sponsored?: boolean; next_cursor?: string }): Promise<PaginatedCurrentRewards> {
    return this.requestPublic("/rewards/markets/current", validateCurrentRewardsResponse, {
      sponsored: opts?.sponsored != null ? String(opts.sponsored) : undefined,
      next_cursor: opts?.next_cursor,
    });
  }

  getMarketRewards(conditionId: string, opts?: { sponsored?: boolean; next_cursor?: string }): Promise<PaginatedMarketRewards> {
    return this.requestPublic(`/rewards/markets/${encodeURIComponent(conditionId)}`, validateMarketRewardsResponse, {
      sponsored: opts?.sponsored != null ? String(opts.sponsored) : undefined,
      next_cursor: opts?.next_cursor,
    });
  }

  getMultiMarketRewards(opts?: Record<string, string | undefined>): Promise<PaginatedMultiMarketInfo> {
    return this.requestPublic("/rewards/markets/multi", validateMultiMarketRewardsResponse, opts);
  }

  // ── Rewards (authenticated) ────────────────────────────────────────

  getUserEarnings(auth: ClobAuthContext, opts: Record<string, string | undefined>): Promise<PaginatedUserEarnings> {
    return this.requestAuth(auth, "GET", "/rewards/user", validateUserEarningsResponse, undefined, opts);
  }

  getUserTotalEarnings(auth: ClobAuthContext, opts: Record<string, string | undefined>): Promise<UserTotalEarningEntry[]> {
    return this.requestAuth(auth, "GET", "/rewards/user/total", validateUserTotalEarningsResponse, undefined, opts);
  }

  getUserRewardPercentages(auth: ClobAuthContext, opts?: Record<string, string | undefined>): Promise<UserRewardPercentages> {
    return this.requestAuth(auth, "GET", "/rewards/user/percentages", validateUserRewardPercentagesResponse, undefined, opts);
  }

  getUserEarningsMarkets(auth: ClobAuthContext, opts?: Record<string, string | undefined>): Promise<PaginatedUserRewardsMarkets> {
    return this.requestAuth(auth, "GET", "/rewards/user/markets", validateUserEarningsMarketsResponse, undefined, opts);
  }

  getOrderScoring(auth: ClobAuthContext, orderId: string): Promise<OrderScoringResponse> {
    return this.requestAuth(auth, "GET", "/order-scoring", validateOrderScoringResponse, undefined, { order_id: orderId });
  }

  // ── Trading (authenticated) ─────────────────────────────────────

  postOrder(auth: ClobAuthContext, order: SendOrderRequest): Promise<SendOrderResponse> {
    return this.requestAuth(auth, "POST", "/order", validateSendOrderResponse, order);
  }

  postOrders(auth: ClobAuthContext, orders: SendOrderRequest[]): Promise<SendOrderResponse[]> {
    return this.requestAuth(auth, "POST", "/orders", validateSendOrdersResponse, orders);
  }

  cancelOrder(auth: ClobAuthContext, orderId: string): Promise<CancelResponse> {
    return this.requestAuth(auth, "DELETE", "/order", validateCancelResponse, { orderID: orderId });
  }

  cancelOrders(auth: ClobAuthContext, orderIds: string[]): Promise<CancelResponse> {
    return this.requestAuth(auth, "DELETE", "/orders", validateCancelResponse, orderIds);
  }

  cancelAll(auth: ClobAuthContext): Promise<CancelResponse> {
    return this.requestAuth(auth, "DELETE", "/cancel-all", validateCancelResponse);
  }

  cancelMarketOrders(auth: ClobAuthContext, market: string, assetId: string): Promise<CancelResponse> {
    return this.requestAuth(auth, "DELETE", "/cancel-market-orders", validateCancelResponse, { market, asset_id: assetId });
  }

  getOrders(auth: ClobAuthContext, opts?: { id?: string; market?: string; asset_id?: string; next_cursor?: string }): Promise<PaginatedOrders> {
    return this.requestAuth(auth, "GET", "/data/orders", validatePaginatedOrders, undefined, {
      id: opts?.id,
      market: opts?.market,
      asset_id: opts?.asset_id,
      next_cursor: opts?.next_cursor,
    });
  }

  getOrder(auth: ClobAuthContext, orderId: string): Promise<OpenOrder> {
    return this.requestAuth(auth, "GET", `/order/${encodeURIComponent(orderId)}`, validateOpenOrder);
  }

  getTrades(auth: ClobAuthContext, opts?: { id?: string; maker_address?: string; market?: string; asset_id?: string; before?: string; after?: string; next_cursor?: string }): Promise<PaginatedTrades> {
    return this.requestAuth(auth, "GET", "/data/trades", validatePaginatedTrades, undefined, {
      id: opts?.id,
      maker_address: opts?.maker_address,
      market: opts?.market,
      asset_id: opts?.asset_id,
      before: opts?.before,
      after: opts?.after,
      next_cursor: opts?.next_cursor,
    });
  }

  sendHeartbeat(auth: ClobAuthContext): Promise<{ status: string }> {
    return this.requestAuth(auth, "POST", "/heartbeats", (raw) => {
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
