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

// ── Rewards / Rebates / Simplified Markets ───────────────────────────

export interface RewardsToken {
  token_id: string;
  outcome: string;
  price: number;
}

export interface RewardsConfigItem {
  id: number;
  asset_address: string;
  start_date: string;
  end_date: string;
  rate_per_day: number;
  total_rewards: number;
  remaining_reward_amount?: number;
  total_days?: number;
}

export interface SimplifiedMarketRewardsRate {
  asset_address: string;
  rewards_daily_rate: number;
}

export interface SimplifiedMarketRewards {
  rates: SimplifiedMarketRewardsRate[];
  min_size: number;
  max_spread: number;
}

export interface SimplifiedMarketToken {
  token_id: string;
  outcome: string;
  price: number;
  winner: boolean;
}

export interface SimplifiedMarket {
  condition_id: string;
  rewards: SimplifiedMarketRewards;
  tokens: SimplifiedMarketToken[];
  active: boolean;
  closed: boolean;
  archived: boolean;
  accepting_orders: boolean;
}

export interface PaginatedSimplifiedMarkets {
  limit: number;
  next_cursor: string;
  count: number;
  data: SimplifiedMarket[];
}

export interface RebateEntry {
  date: string;
  condition_id: string;
  asset_address: string;
  maker_address: string;
  rebated_fees_usdc: string;
}

export interface CurrentReward {
  condition_id: string;
  rewards_max_spread: number;
  rewards_min_size: number;
  rewards_config: RewardsConfigItem[];
  sponsored_daily_rate?: number;
  sponsors_count?: number;
  native_daily_rate?: number;
  total_daily_rate?: number;
}

export interface PaginatedCurrentRewards {
  limit: number;
  count: number;
  next_cursor: string;
  data: CurrentReward[];
}

export interface MarketReward {
  condition_id: string;
  question: string;
  market_slug: string;
  event_slug: string;
  image: string;
  rewards_max_spread: number;
  rewards_min_size: number;
  market_competitiveness: number;
  tokens: RewardsToken[];
  rewards_config: RewardsConfigItem[];
}

export interface PaginatedMarketRewards {
  limit: number;
  count: number;
  next_cursor: string;
  data: MarketReward[];
}

export interface MultiMarketInfo {
  condition_id: string;
  event_id: string;
  event_slug: string;
  created_at: string;
  group_item_title: string;
  image: string;
  market_competitiveness: number;
  market_id: string;
  market_slug: string;
  one_day_price_change: number;
  question: string;
  rewards_max_spread: number;
  rewards_min_size: number;
  spread: number;
  end_date: string;
  tokens: RewardsToken[];
  volume_24hr: number;
  rewards_config: RewardsConfigItem[];
}

export interface PaginatedMultiMarketInfo {
  limit: number;
  count: number;
  next_cursor: string;
  data: MultiMarketInfo[];
}

export interface UserEarning {
  date: string;
  condition_id: string;
  asset_address: string;
  maker_address: string;
  earnings: number;
  asset_rate: number;
}

export interface PaginatedUserEarnings {
  limit: number;
  count: number;
  next_cursor: string;
  data: UserEarning[];
}

export interface UserTotalEarningEntry {
  date: string;
  asset_address: string;
  maker_address: string;
  earnings: number;
  asset_rate: number;
}

/** `condition_id → reward percentage`, per `/rewards/user/percentages`. */
export type UserRewardPercentages = Record<string, number>;

export interface AssetEarning {
  asset_address: string;
  earnings: number;
  asset_rate: number;
}

export interface UserRewardsMarket {
  condition_id: string;
  market_id: string;
  event_id: string;
  question: string;
  market_slug: string;
  event_slug: string;
  image: string;
  rewards_max_spread: number;
  rewards_min_size: number;
  volume_24hr: number;
  spread: number;
  market_competitiveness: number;
  tokens: RewardsToken[];
  rewards_config: RewardsConfigItem[];
  maker_address: string;
  earning_percentage: number;
  earnings: AssetEarning[];
}

export interface PaginatedUserRewardsMarkets {
  limit: number;
  count: number;
  total_count: number;
  next_cursor: string;
  data: UserRewardsMarket[];
}
