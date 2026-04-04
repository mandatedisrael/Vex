/**
 * Jupiter Prediction API — base types: constants re-export, union types, params, pagination.
 */

import {
  JUPITER_PREDICTION_API_BASE_URL,
  JUPITER_PREDICTION_DEFAULT_PROVIDER,
  JUPITER_PREDICTION_JUPUSD_MINT,
  JUPITER_PREDICTION_USDC_MINT,
} from "../../constants.js";

export {
  JUPITER_PREDICTION_API_BASE_URL,
  JUPITER_PREDICTION_DEFAULT_PROVIDER,
  JUPITER_PREDICTION_JUPUSD_MINT,
  JUPITER_PREDICTION_USDC_MINT,
};

export type JupiterPredictionProvider = "kalshi" | "polymarket";
export type JupiterPredictionCategory =
  | "all"
  | "crypto"
  | "sports"
  | "politics"
  | "esports"
  | "culture"
  | "economics"
  | "tech";
export type JupiterPredictionFilter = "new" | "live" | "trending";
export type JupiterPredictionSortBy = "volume" | "beginAt";
export type JupiterPredictionSortDirection = "asc" | "desc";
export type JupiterPredictionMarketStatus = "open" | "closed" | "cancelled" | (string & {});
export type JupiterPredictionLeaderboardPeriod = "all_time" | "weekly" | "monthly";
export type JupiterPredictionLeaderboardMetric = "pnl" | "volume" | "win_rate";
export type JupiterPredictionPnlInterval = "24h" | "1w" | "1m";

export interface JupiterPredictionEventsParams {
  provider?: JupiterPredictionProvider;
  includeMarkets?: boolean;
  start?: number;
  end?: number;
  category?: JupiterPredictionCategory;
  subcategory?: string | string[];
  sortBy?: JupiterPredictionSortBy;
  sortDirection?: JupiterPredictionSortDirection;
  filter?: JupiterPredictionFilter;
}

export interface JupiterPredictionSearchEventsParams {
  provider?: JupiterPredictionProvider;
  query: string;
  limit?: number;
}

export interface JupiterPredictionGetEventParams {
  eventId: string;
  includeMarkets?: boolean;
}

export interface JupiterPredictionSuggestedEventsParams {
  pubkey: string;
  provider?: JupiterPredictionProvider;
}

export interface JupiterPredictionEventMarketsParams {
  eventId: string;
  start?: number;
  end?: number;
}

export interface JupiterPredictionEventMarketParams {
  eventId: string;
  marketId: string;
}

export interface JupiterPredictionMarketParams {
  marketId: string;
}

export interface JupiterPredictionOrdersParams {
  start?: number;
  end?: number;
  ownerPubkey?: string;
}

export interface JupiterPredictionOrderParams {
  orderPubkey: string;
}

export interface JupiterPredictionPositionsParams {
  start?: number;
  end?: number;
  ownerPubkey?: string;
  marketPubkey?: string;
  marketId?: string;
  isYes?: boolean;
}

export interface JupiterPredictionPositionParams {
  positionPubkey: string;
}

export interface JupiterPredictionHistoryParams {
  start?: number;
  end?: number;
  ownerPubkey?: string;
  id?: number;
  positionPubkey?: string;
}

export interface JupiterPredictionProfileParams {
  ownerPubkey: string;
}

export interface JupiterPredictionPnlHistoryParams {
  ownerPubkey: string;
  interval?: JupiterPredictionPnlInterval;
  count?: number;
}

export interface JupiterPredictionLeaderboardsParams {
  period?: JupiterPredictionLeaderboardPeriod;
  limit?: number;
  metric?: JupiterPredictionLeaderboardMetric;
}

export interface JupiterPredictionCreateOrderRequest {
  ownerPubkey: string;
  marketId?: string;
  positionPubkey?: string;
  isYes?: boolean;
  isBuy: boolean;
  contracts?: string | number;
  depositAmount?: string | number;
  depositMint?: string;
}

export interface JupiterPredictionClosePositionRequest {
  ownerPubkey: string;
}

export interface JupiterPredictionCloseAllPositionsRequest {
  ownerPubkey: string;
}

export interface JupiterPredictionClaimPositionRequest {
  ownerPubkey: string;
}

export interface JupiterPredictionPagination {
  start: number;
  end: number;
  total: number;
  hasNext: boolean;
}
