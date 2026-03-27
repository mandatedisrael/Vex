/**
 * DexScreener REST API client.
 *
 * Wraps all public DexScreener endpoints with typed responses
 * and runtime validation. Singleton via getDexScreenerClient().
 */

import { loadConfig } from "../../config/store.js";
import { EchoError } from "../../errors.js";
import { fetchWithTimeout, readJson } from "../../utils/http.js";
import { mapDexScreenerError, mapTransportError } from "./errors.js";
import type {
  DexAd,
  DexBoost,
  DexCommunityTakeover,
  DexOrder,
  DexPair,
  DexTokenProfile,
  PairsResponse,
  SearchResponse,
  TokensPairsResponse,
  TokensResponse,
} from "./types.js";
import {
  validateAdsResponse,
  validateBoostsResponse,
  validateCommunityTakeoversResponse,
  validateOrdersResponse,
  validatePairsResponse,
  validateProfilesResponse,
  validateSearchResponse,
  validateTokensPairsResponse,
  validateTokensResponse,
} from "./validation.js";

export class DexScreenerClient {
  constructor(private readonly baseUrl: string) {}

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path, this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value.length > 0) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    validator: (raw: unknown) => T,
    query?: Record<string, string | undefined>,
  ): Promise<T> {
    try {
      const response = await fetchWithTimeout(this.buildUrl(path, query));

      if (!response.ok) {
        const raw = await readJson(response);
        const message = typeof raw === "object" && raw !== null && "error" in raw
          ? String((raw as Record<string, unknown>).error)
          : undefined;
        throw mapDexScreenerError(response.status, message);
      }

      const raw = await readJson(response);
      return validator(raw);
    } catch (err) {
      mapTransportError(err);
    }
  }

  // ── Core DEX data ───────────────────────────────────────────────

  /** Search DEX pairs across all chains. */
  search(query: string): Promise<SearchResponse> {
    return this.request("/latest/dex/search", validateSearchResponse, { q: query });
  }

  /** Get pair details by chain and pair address. */
  getPairs(chainId: string, pairId: string): Promise<PairsResponse> {
    return this.request(
      `/latest/dex/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairId)}`,
      validatePairsResponse,
    );
  }

  /** Get all pair data for one or more tokens (comma-separated, max 30). */
  getTokens(chainId: string, tokenAddresses: string): Promise<TokensResponse> {
    return this.request(
      `/tokens/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddresses)}`,
      validateTokensResponse,
    );
  }

  /** Get all trading pools for a specific token. */
  getTokenPairs(chainId: string, tokenAddress: string): Promise<TokensPairsResponse> {
    return this.request(
      `/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`,
      validateTokensPairsResponse,
    );
  }

  // ── Profiles & boosts ─────────────────────────────────────────

  /** Get latest trending token profiles. */
  getProfiles(): Promise<DexTokenProfile[]> {
    return this.request("/token-profiles/latest/v1", validateProfilesResponse);
  }

  /** Get latest boosted tokens. */
  getBoosts(): Promise<DexBoost[]> {
    return this.request("/token-boosts/latest/v1", validateBoostsResponse);
  }

  /** Get tokens with most active boosts. */
  getTopBoosts(): Promise<DexBoost[]> {
    return this.request("/token-boosts/top/v1", validateBoostsResponse);
  }

  // ── Community Takeovers ──────────────────────────────────────

  /** Get latest community takeovers. */
  getCommunityTakeovers(): Promise<DexCommunityTakeover[]> {
    return this.request("/community-takeovers/latest/v1", validateCommunityTakeoversResponse);
  }

  // ── Ads ─────────────────────────────────────────────────────

  /** Get latest ads. */
  getAds(): Promise<DexAd[]> {
    return this.request("/ads/latest/v1", validateAdsResponse);
  }

  // ── Orders ────────────────────────────────────────────────────

  /** Check paid orders for a token. */
  getOrders(chainId: string, tokenAddress: string): Promise<DexOrder[]> {
    return this.request(
      `/orders/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`,
      validateOrdersResponse,
    );
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let cachedClient: DexScreenerClient | null = null;
let cachedBaseUrl: string | null = null;

export function getDexScreenerClient(): DexScreenerClient {
  const baseUrl = loadConfig().services.dexScreenerApiUrl;
  if (cachedClient && cachedBaseUrl === baseUrl) {
    return cachedClient;
  }

  cachedClient = new DexScreenerClient(baseUrl);
  cachedBaseUrl = baseUrl;
  return cachedClient;
}
