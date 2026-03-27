/**
 * Polymarket Gamma API client — market discovery, events, search.
 *
 * All endpoints are public (no auth required).
 * Singleton via getPolyGammaClient().
 */

import { loadConfig } from "../../../config/store.js";
import { fetchWithTimeout, readJson } from "../../../utils/http.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import { mapPolyTransportError, mapPolyApiError } from "../errors.js";
import { GAMMA_BASE_URL, GAMMA_TIMEOUT_MS } from "../constants.js";
import {
  validateEventsResponse, validateEventResponse,
  validateMarketsResponse, validateMarketResponse,
  validateTagsResponse, validateRelatedTagsResponse,
  validateSeriesResponse, validateCommentsResponse,
  validateProfileResponse, validateSearchResponse,
  validateSportsMetadataResponse, validateTeamsResponse,
} from "./validation.js";
import logger from "../../../utils/logger.js";
import type { EchoError } from "../../../errors.js";
import type {
  GammaEvent, GammaMarket, GammaTag, GammaRelatedTag,
  GammaSeries, GammaComment, GammaProfile, GammaSportsMetadata,
  GammaTeam, GammaSearchResult, ListEventsParams, ListMarketsParams,
} from "./types.js";

export class PolyGammaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = GAMMA_TIMEOUT_MS,
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

  private async request<T>(path: string, validator: (raw: unknown) => T, query?: Record<string, string | undefined>): Promise<T> {
    const url = this.buildUrl(path, query);
    try {
      logger.debug({ event: "polymarket.gamma.request.start", path });
      const response = await fetchWithTimeout(url, { timeoutMs: this.timeoutMs });
      if (!response.ok) {
        const raw = await readJson(response);
        const message = isRecord(raw) && typeof raw.error === "string" ? raw.error : `HTTP ${response.status}`;
        logger.warn({ event: "polymarket.gamma.request.error", path, status: response.status });
        throw mapPolyApiError(response.status, message, "Gamma");
      }
      const raw = await readJson(response);
      const result = validator(raw);
      logger.debug({ event: "polymarket.gamma.request.success", path });
      return result;
    } catch (err) {
      if ((err as EchoError).code?.startsWith("POLYMARKET_")) throw err;
      mapPolyTransportError(err);
    }
  }

  private toQuery(params: object): Record<string, string | undefined> {
    const q: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (v !== undefined && v !== null) {
        q[k] = Array.isArray(v) ? v.join(",") : String(v);
      }
    }
    return q;
  }

  // ── Events ──────────────────────────────────────────────────────

  listEvents(params?: ListEventsParams): Promise<GammaEvent[]> {
    return this.request("/events", validateEventsResponse, params ? this.toQuery(params) : undefined);
  }

  getEvent(id: number | string): Promise<GammaEvent> {
    return this.request(`/events/${encodeURIComponent(id)}`, validateEventResponse);
  }

  getEventBySlug(slug: string): Promise<GammaEvent> {
    return this.request(`/events/slug/${encodeURIComponent(slug)}`, validateEventResponse);
  }

  getEventTags(id: number | string): Promise<GammaTag[]> {
    return this.request(`/events/${encodeURIComponent(id)}/tags`, validateTagsResponse);
  }

  // ── Markets ─────────────────────────────────────────────────────

  listMarkets(params?: ListMarketsParams): Promise<GammaMarket[]> {
    return this.request("/markets", validateMarketsResponse, params ? this.toQuery(params) : undefined);
  }

  getMarket(id: number | string): Promise<GammaMarket> {
    return this.request(`/markets/${encodeURIComponent(id)}`, validateMarketResponse);
  }

  getMarketBySlug(slug: string): Promise<GammaMarket> {
    return this.request(`/markets/slug/${encodeURIComponent(slug)}`, validateMarketResponse);
  }

  getMarketTags(id: number | string): Promise<GammaTag[]> {
    return this.request(`/markets/${encodeURIComponent(id)}/tags`, validateTagsResponse);
  }

  // ── Search ──────────────────────────────────────────────────────

  search(query: string, opts?: { limit_per_type?: number; page?: number; events_status?: string }): Promise<GammaSearchResult> {
    return this.request("/public-search", validateSearchResponse, {
      q: query,
      ...opts ? this.toQuery(opts) : {},
    });
  }

  // ── Tags ────────────────────────────────────────────────────────

  listTags(opts?: { is_carousel?: boolean }): Promise<GammaTag[]> {
    return this.request("/tags", validateTagsResponse, opts ? this.toQuery(opts) : undefined);
  }

  getTag(id: number | string): Promise<GammaTag> {
    return this.request(`/tags/${encodeURIComponent(id)}`, (raw) => {
      const tags = validateTagsResponse(Array.isArray(raw) ? raw : [raw]);
      return tags[0];
    });
  }

  getTagBySlug(slug: string): Promise<GammaTag> {
    return this.request(`/tags/slug/${encodeURIComponent(slug)}`, (raw) => {
      const tags = validateTagsResponse(Array.isArray(raw) ? raw : [raw]);
      return tags[0];
    });
  }

  getRelatedTags(id: number | string, opts?: { status?: string }): Promise<GammaRelatedTag[]> {
    return this.request(`/tags/${encodeURIComponent(id)}/related-tags`, validateRelatedTagsResponse, opts ? this.toQuery(opts) : undefined);
  }

  getTagsRelatedToTag(id: number | string, opts?: { status?: string }): Promise<GammaTag[]> {
    return this.request(`/tags/${encodeURIComponent(id)}/related-tags/tags`, validateTagsResponse, opts ? this.toQuery(opts) : undefined);
  }

  getRelatedTagsBySlug(slug: string, opts?: { status?: string }): Promise<GammaRelatedTag[]> {
    return this.request(`/tags/slug/${encodeURIComponent(slug)}/related-tags`, validateRelatedTagsResponse, opts ? this.toQuery(opts) : undefined);
  }

  getTagsRelatedToTagBySlug(slug: string, opts?: { status?: string }): Promise<GammaTag[]> {
    return this.request(`/tags/slug/${encodeURIComponent(slug)}/related-tags/tags`, validateTagsResponse, opts ? this.toQuery(opts) : undefined);
  }

  // ── Series ──────────────────────────────────────────────────────

  listSeries(opts?: { slug?: string[]; closed?: boolean }): Promise<GammaSeries[]> {
    return this.request("/series", validateSeriesResponse, opts ? this.toQuery(opts) : undefined);
  }

  getSeries(id: number | string): Promise<GammaSeries> {
    return this.request(`/series/${encodeURIComponent(id)}`, (raw) => {
      return validateSeriesResponse([raw])[0];
    });
  }

  // ── Comments ────────────────────────────────────────────────────

  listComments(opts?: { parent_entity_type?: string; parent_entity_id?: number; holders_only?: boolean; limit?: number }): Promise<GammaComment[]> {
    return this.request("/comments", validateCommentsResponse, opts ? this.toQuery(opts) : undefined);
  }

  getComment(id: number | string): Promise<GammaComment[]> {
    return this.request(`/comments/${encodeURIComponent(id)}`, validateCommentsResponse);
  }

  getCommentsByUser(address: string, opts?: { limit?: number; offset?: number }): Promise<GammaComment[]> {
    return this.request(`/comments/user_address/${encodeURIComponent(address)}`, validateCommentsResponse, opts ? this.toQuery(opts) : undefined);
  }

  // ── Profiles ────────────────────────────────────────────────────

  getPublicProfile(address: string): Promise<GammaProfile> {
    return this.request("/public-profile", validateProfileResponse, { address });
  }

  // ── Sports ──────────────────────────────────────────────────────

  getSportsMetadata(): Promise<GammaSportsMetadata[]> {
    return this.request("/sports", validateSportsMetadataResponse);
  }

  getSportsMarketTypes(): Promise<{ marketTypes: string[] }> {
    return this.request("/sports/market-types", (raw) => {
      if (!isRecord(raw) || !Array.isArray(raw.marketTypes)) return { marketTypes: [] };
      return { marketTypes: raw.marketTypes.filter((t): t is string => typeof t === "string") };
    });
  }

  listTeams(opts?: { league?: string[]; limit?: number }): Promise<GammaTeam[]> {
    return this.request("/teams", validateTeamsResponse, opts ? this.toQuery(opts) : undefined);
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let cachedClient: PolyGammaClient | null = null;
let cachedBaseUrl: string | null = null;

export function getPolyGammaClient(): PolyGammaClient {
  const cfg = loadConfig();
  const baseUrl = cfg.polymarket?.gammaBaseUrl ?? GAMMA_BASE_URL;
  if (cachedClient && cachedBaseUrl === baseUrl) return cachedClient;
  cachedClient = new PolyGammaClient(baseUrl);
  cachedBaseUrl = baseUrl;
  return cachedClient;
}
