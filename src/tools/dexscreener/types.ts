/**
 * DexScreener API type definitions.
 *
 * Covers REST responses and WebSocket handshake shapes.
 * All fields mirror the official OpenAPI spec at https://docs.dexscreener.com/api/reference
 */

// ── Pair (core schema, used across most endpoints) ──────────────────

export interface DexToken {
  address: string;
  name: string;
  symbol: string;
}

export interface DexQuoteToken {
  address: string | null;
  name: string | null;
  symbol: string | null;
}

export interface DexTxnCounts {
  buys: number;
  sells: number;
}

export interface DexLiquidity {
  usd: number | null;
  base: number;
  quote: number;
}

export interface DexPairInfo {
  imageUrl: string | null;
  websites: Array<{ url: string }> | null;
  socials: Array<{ platform: string; handle: string }> | null;
}

export interface DexBoosts {
  active: number;
}

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels: string[] | null;
  baseToken: DexToken;
  quoteToken: DexQuoteToken;
  priceNative: string;
  priceUsd: string | null;
  txns: Record<string, DexTxnCounts>;
  volume: Record<string, number>;
  priceChange: Record<string, number> | null;
  liquidity: DexLiquidity | null;
  fdv: number | null;
  marketCap: number | null;
  pairCreatedAt: number | null;
  info: DexPairInfo | null;
  boosts: DexBoosts | null;
}

// ── Response wrappers ───────────────────────────────────────────────

export interface PairsResponse {
  schemaVersion: string;
  pairs: DexPair[] | null;
}

export interface SearchResponse {
  schemaVersion: string;
  pairs: DexPair[];
}

// TokensResponse and TokensPairsResponse are bare arrays of DexPair
export type TokensResponse = DexPair[];
export type TokensPairsResponse = DexPair[];

// ── Token Profiles ──────────────────────────────────────────────────

export interface DexLink {
  type: string | null;
  label: string | null;
  url: string;
}

export interface DexTokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon: string;
  header: string | null;
  description: string | null;
  links: DexLink[] | null;
}

// ── Token Boosts ────────────────────────────────────────────────────

export interface DexBoost {
  url: string;
  chainId: string;
  tokenAddress: string;
  amount: number;
  totalAmount: number;
  icon: string | null;
  header: string | null;
  description: string | null;
  links: DexLink[] | null;
}

// ── Orders ──────────────────────────────────────────────────────────

export type DexOrderType = "tokenProfile" | "communityTakeover" | "tokenAd" | "trendingBarAd";
export type DexOrderStatus = "processing" | "cancelled" | "on-hold" | "approved" | "rejected";

export interface DexOrder {
  type: DexOrderType;
  status: DexOrderStatus;
  paymentTimestamp: number;
}

// ── Community Takeovers ─────────────────────────────────────────────

export interface DexCommunityTakeover {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon: string;
  header: string | null;
  description: string | null;
  links: DexLink[] | null;
  claimDate: string;
}

// ── Ads ─────────────────────────────────────────────────────────────

export interface DexAd {
  url: string;
  chainId: string;
  tokenAddress: string;
  date: string;
  type: string;
  durationHours: number | null;
  impressions: number | null;
}

// ── Trending (combined profiles + boosts) ───────────────────────────

export interface DexTrendingItem {
  chainId: string;
  tokenAddress: string;
  url: string | null;
  icon: string | null;
  header: string | null;
  description: string | null;
  links: DexLink[] | null;
  boostAmount: number;
  boostTotalAmount: number;
  hasProfile: boolean;
}

// ── WebSocket handshake ─────────────────────────────────────────────

export interface WsHandshake<T> {
  limit: number;
  data: T[];
}

export type DexStreamChannel = "profiles" | "boosts" | "boosts-top" | "community-takeovers" | "ads";
