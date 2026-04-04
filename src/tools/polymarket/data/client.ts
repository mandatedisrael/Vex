/**
 * Polymarket Data API client — positions, activity, leaderboard, trades.
 *
 * All endpoints are public (no auth required).
 * Supports tracking any user by address.
 * Singleton via getPolyDataClient().
 */

import { loadConfig } from "../../../config/store.js";
import { fetchWithTimeout, readJson } from "../../../utils/http.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import { mapPolyTransportError, mapPolyApiError } from "../errors.js";
import { DATA_API_BASE_URL, DATA_API_TIMEOUT_MS } from "../constants.js";
import {
  validatePositionsResponse, validateClosedPositionsResponse,
  validateActivityResponse, validateTradesResponse,
  validateHoldersResponse, validateOpenInterestResponse,
  validateLiveVolumeResponse, validateLeaderboardResponse,
  validateBuilderLeaderboardResponse, validateBuilderVolumeResponse,
  validateValueResponse,
  validateTradedResponse, validateMarketPositionsResponse,
} from "./validation.js";
import logger from "../../../utils/logger.js";
import type { EchoError } from "../../../errors.js";
import type {
  DataPosition, DataClosedPosition, DataActivity, DataTrade,
  DataMetaHolder, DataOpenInterest, DataLiveVolume,
  DataLeaderboardEntry, DataBuilderEntry, DataBuilderVolumeEntry,
  DataMetaMarketPosition, PositionsParams, ClosedPositionsParams, ActivityParams, TradesParams,
} from "./types.js";

export class PolyDataClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = DATA_API_TIMEOUT_MS,
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
      logger.debug({ event: "polymarket.data.request.start", path });
      const response = await fetchWithTimeout(url, { timeoutMs: this.timeoutMs });
      if (!response.ok) {
        const raw = await readJson(response);
        const message = isRecord(raw) && typeof raw.error === "string" ? raw.error : `HTTP ${response.status}`;
        logger.warn({ event: "polymarket.data.request.error", path, status: response.status });
        throw mapPolyApiError(response.status, message, "Data");
      }
      const raw = await readJson(response);
      const result = validator(raw);
      logger.debug({ event: "polymarket.data.request.success", path });
      return result;
    } catch (err) {
      if ((err as EchoError).code?.startsWith("POLYMARKET_")) throw err;
      mapPolyTransportError(err);
    }
  }

  private qs(params: object): Record<string, string | undefined> {
    const q: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (v !== undefined && v !== null) q[k] = String(v);
    }
    return q;
  }

  // ── User Data ───────────────────────────────────────────────────

  getPositions(params: PositionsParams): Promise<DataPosition[]> {
    return this.request("/positions", validatePositionsResponse, this.qs(params));
  }

  getClosedPositions(params: ClosedPositionsParams): Promise<DataClosedPosition[]> {
    return this.request("/closed-positions", validateClosedPositionsResponse, this.qs(params));
  }

  getActivity(params: ActivityParams): Promise<DataActivity[]> {
    return this.request("/activity", validateActivityResponse, this.qs(params));
  }

  getTrades(params: TradesParams): Promise<DataTrade[]> {
    return this.request("/trades", validateTradesResponse, this.qs(params));
  }

  getValue(user: string, opts?: { market?: string }): Promise<{ user: string; value: number }> {
    return this.request("/value", validateValueResponse, this.qs({ user, ...opts }));
  }

  getTraded(user: string): Promise<{ user: string; traded: number }> {
    return this.request("/traded", validateTradedResponse, { user });
  }

  // ── Market Data ─────────────────────────────────────────────────

  getHolders(market: string, opts?: { limit?: number; minBalance?: number }): Promise<DataMetaHolder[]> {
    return this.request("/holders", validateHoldersResponse, this.qs({ market, ...opts }));
  }

  getOpenInterest(market?: string): Promise<DataOpenInterest[]> {
    return this.request("/oi", validateOpenInterestResponse, market ? { market } : undefined);
  }

  getLiveVolume(eventId: number): Promise<DataLiveVolume> {
    return this.request("/live-volume", validateLiveVolumeResponse, { id: String(eventId) });
  }

  getMarketPositions(market: string, opts?: { user?: string; status?: string; sortBy?: string; sortDirection?: string; limit?: number; offset?: number }): Promise<DataMetaMarketPosition[]> {
    return this.request("/v1/market-positions", validateMarketPositionsResponse, this.qs({ market, ...opts }));
  }

  // ── Leaderboard ─────────────────────────────────────────────────

  getLeaderboard(opts?: { category?: string; timePeriod?: string; orderBy?: string; limit?: number; offset?: number; user?: string }): Promise<DataLeaderboardEntry[]> {
    return this.request("/v1/leaderboard", validateLeaderboardResponse, opts ? this.qs(opts) : undefined);
  }

  getBuilderLeaderboard(opts?: { timePeriod?: string; limit?: number; offset?: number }): Promise<DataBuilderEntry[]> {
    return this.request("/v1/builders/leaderboard", validateBuilderLeaderboardResponse, opts ? this.qs(opts) : undefined);
  }

  getBuilderVolume(opts?: { timePeriod?: string }): Promise<DataBuilderVolumeEntry[]> {
    return this.request("/v1/builders/volume", validateBuilderVolumeResponse, opts ? this.qs(opts) : undefined);
  }

  // ── Accounting ──────────────────────────────────────────────────

  async getAccountingSnapshotUrl(user: string): Promise<string> {
    return this.buildUrl("/v1/accounting/snapshot", { user });
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let cachedClient: PolyDataClient | null = null;
let cachedBaseUrl: string | null = null;

export function getPolyDataClient(): PolyDataClient {
  const cfg = loadConfig();
  const baseUrl = cfg.polymarket?.dataApiBaseUrl ?? DATA_API_BASE_URL;
  if (cachedClient && cachedBaseUrl === baseUrl) return cachedClient;
  cachedClient = new PolyDataClient(baseUrl);
  cachedBaseUrl = baseUrl;
  return cachedClient;
}
