/**
 * Polymarket CLOB API types — orderbook, trading, orders.
 * Base URL: https://clob.polymarket.com
 */

// ── Orderbook ───────────────────────────────────────────────────────

export interface OrderSummary {
  price: string;
  size: string;
}

export interface OrderBookSummary {
  market: string;
  asset_id: string;
  timestamp: string;
  hash: string;
  bids: OrderSummary[];
  asks: OrderSummary[];
  min_order_size: string;
  tick_size: string;
  neg_risk: boolean;
  last_trade_price: string;
}

// ── Order ───────────────────────────────────────────────────────────

export interface ClobOrder {
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  side: "BUY" | "SELL";
  expiration: string;
  nonce: string;
  feeRateBps: string;
  signature: string;
  salt: number;
  signatureType: 0 | 1 | 2;
}

export interface SendOrderRequest {
  order: ClobOrder;
  owner: string;
  orderType?: "GTC" | "FOK" | "GTD" | "FAK";
  deferExec?: boolean;
}

export interface SendOrderResponse {
  success: boolean;
  orderID: string;
  status: "live" | "matched" | "delayed";
  makingAmount?: string;
  takingAmount?: string;
  transactionsHashes?: string[];
  tradeIDs?: string[];
  errorMsg: string;
}

// ── Open Order ──────────────────────────────────────────────────────

export interface OpenOrder {
  id: string;
  status: string;
  owner: string;
  maker_address: string;
  market: string;
  asset_id: string;
  side: "BUY" | "SELL";
  original_size: string;
  size_matched: string;
  price: string;
  outcome: string;
  expiration: string;
  order_type: "GTC" | "FOK" | "GTD" | "FAK";
  associate_trades: string[];
  created_at: number;
}

export interface PaginatedOrders {
  limit: number;
  next_cursor: string;
  count: number;
  data: OpenOrder[];
}

// ── Cancel ──────────────────────────────────────────────────────────

export interface CancelResponse {
  canceled: string[];
  not_canceled: Record<string, string>;
}

// ── Trade ───────────────────────────────────────────────────────────

export interface ClobTrade {
  id: string;
  taker_order_id: string;
  market: string;
  asset_id: string;
  side: "BUY" | "SELL";
  size: string;
  fee_rate_bps: string;
  price: string;
  status: string;
  match_time: string;
  last_update: string;
  outcome: string;
  owner: string;
  maker_address: string;
  transaction_hash: string | null;
  trader_side: "TAKER" | "MAKER";
}

export interface PaginatedTrades {
  limit: number;
  next_cursor: string;
  count: number;
  data: ClobTrade[];
}

// ── Batch request ──────────────────────────────────────────────────

export interface BookRequest {
  token_id: string;
  side?: "BUY" | "SELL";
}

export interface LastTradePrice {
  token_id: string;
  price: string;
  side: "BUY" | "SELL";
}

// ── Order scoring ──────────────────────────────────────────────────

export interface OrderScoringResponse {
  scoring: boolean;
}

// ── Price History ───────────────────────────────────────────────────

export interface PriceHistoryPoint {
  t: number;
  p: number;
}

export interface PriceHistoryResponse {
  history: PriceHistoryPoint[];
}
