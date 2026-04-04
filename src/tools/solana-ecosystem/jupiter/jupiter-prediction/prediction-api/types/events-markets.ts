/**
 * Jupiter Prediction API — event and market types.
 */

import type {
  JupiterPredictionMarketStatus,
  JupiterPredictionPagination,
} from "./base.js";

export interface JupiterPredictionEventMetadata {
  eventId: string;
  title?: string;
  subtitle?: string;
  slug?: string;
  series?: string;
  closeTime?: string;
  imageUrl?: string;
  isLive?: boolean;
}

export interface JupiterPredictionMarketMetadata {
  marketId: string;
  eventId?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  status?: string;
  result?: string;
  closeTime?: number;
  openTime?: number;
  isTeamMarket?: boolean;
  rulesPrimary?: string;
  rulesSecondary?: string;
}

export interface JupiterPredictionMarketPricing {
  buyYesPriceUsd?: number | null;
  buyNoPriceUsd?: number | null;
  sellYesPriceUsd?: number | null;
  sellNoPriceUsd?: number | null;
  volume?: number;
}

export interface JupiterPredictionMarket {
  marketId: string;
  status: JupiterPredictionMarketStatus;
  result: string | null;
  openTime: number;
  closeTime: number;
  resolveAt: number | null;
  marketResultPubkey?: string | null;
  imageUrl?: string | null;
  metadata?: JupiterPredictionMarketMetadata;
  pricing?: JupiterPredictionMarketPricing;
}

export interface JupiterPredictionEvent {
  eventId: string;
  isActive: boolean;
  isLive: boolean;
  category: string;
  subcategory: string;
  tags?: string[];
  metadata?: JupiterPredictionEventMetadata;
  markets?: JupiterPredictionMarket[];
  volumeUsd: string;
  closeCondition: string;
  beginAt: string | null;
  rulesPdf: string;
}

export interface JupiterPredictionEventsResponse {
  data: JupiterPredictionEvent[];
  pagination: JupiterPredictionPagination;
}

export interface JupiterPredictionSearchEventsResponse {
  data: JupiterPredictionEvent[];
}

export interface JupiterPredictionSuggestedEventsResponse {
  data: JupiterPredictionEvent[];
}

export interface JupiterPredictionEventMarketsResponse {
  data: JupiterPredictionMarket[];
  pagination: JupiterPredictionPagination;
}

export type JupiterPredictionEventMarketResponse = JupiterPredictionMarket;
export type JupiterPredictionMarketResponse = JupiterPredictionMarket;
