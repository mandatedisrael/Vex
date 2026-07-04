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

// ── Metas / narratives (live, undocumented API surface) ─────────────
//
// `GET /metas/trending/v1` returns trending NARRATIVES (themes/categories such
// as "knockoff-legends", "ai", "dog"), NOT individual tokens. `GET
// /metas/meta/v1/{slug}` returns one narrative plus the DEX pairs inside it.
// These endpoints are live-verified but absent from the official reference, so
// every field is nullable and parsers are tolerant (see `validation/metas.ts`).

export interface DexMetaIcon {
  type: string | null;
  value: string | null;
}

/** Change/delta windows keyed by timeframe (percent for change, absolute USD for delta). */
export interface DexMetaWindows {
  m5: number | null;
  h1: number | null;
  h6: number | null;
  h24: number | null;
}

export interface DexMeta {
  slug: string | null;
  name: string | null;
  description: string | null;
  icon: DexMetaIcon | null;
  marketCap: number | null;
  liquidity: number | null;
  volume: number | null;
  tokenCount: number | null;
  marketCapChange: DexMetaWindows | null;
  marketCapDelta: DexMetaWindows | null;
}

/** One narrative plus the DEX pairs indexed under it. */
export interface DexMetaDetail extends DexMeta {
  pairs: DexPair[];
}

// ── Token profile updates (recent-updates feed, live/undocumented) ──
//
// `GET /token-profiles/recent-updates/v1` — profile-shaped rows enriched with
// `updatedAt` (ISO 8601) and a `cto` flag. Superset of `DexTokenProfile`.

export interface DexProfileUpdate extends DexTokenProfile {
  updatedAt: string | null;
  cto: boolean | null;
}

// ── WebSocket handshake ─────────────────────────────────────────────

export interface WsHandshake<T> {
  limit: number;
  data: T[];
}

export type DexStreamChannel = "profiles" | "boosts" | "boosts-top" | "community-takeovers" | "ads";
