/**
 * Pendle v2 hosted-API client (Ethereum v1, KEYLESS).
 *
 * Four endpoints back the fixed-yield PT tools:
 *   - GET  /v1/{chainId}/markets/active              → discovery / valuation
 *   - GET  /v1/assets/all                            → metadata + prices (cache 5m)
 *   - GET  /v1/dashboard/positions/database/{wallet} → session-wallet positions
 *   - POST /v3/sdk/{chainId}/convert                 → mutating quote/plan (201 = ok)
 *
 * All reads are CU-throttled + TTL-cached; convert is throttled but NEVER cached
 * (each broadcast plan must be fresh). Aggregators are restricted to
 * kyberswap/okx and `useLimitOrder` is FALSE (live-probed: deterministic
 * AMM-only routing, identical tx/approval semantics, cheaper to reason about).
 *
 * The upstream error body is HOSTILE input — it is logged as bounded metadata
 * only and NEVER copied into the thrown (model-facing) error. Singleton via
 * `getPendleClient()`.
 */

import { loadConfig } from "../../config/store.js";
import { fetchWithTimeout, readJson } from "../../utils/http.js";
import logger from "../../utils/logger.js";
import { mapPendleError, mapPendleTransportError } from "./errors.js";
import { PendleThrottle, PENDLE_TTL, PENDLE_CU, parseRetryAfterMs } from "./throttle.js";
import { PENDLE_AGGREGATORS, PENDLE_CHAIN_ID } from "./constants.js";
import {
  validateAssets,
  validateConvert,
  validateMarkets,
  validatePositions,
} from "./validation.js";
import type {
  PendleAsset,
  PendleConvertResponse,
  PendleMarket,
  PendleTokenAmount,
  PendleUserPositions,
} from "./types.js";

const USER_AGENT = "Vex-Agent/1.0 (+https://vexlabs.ai)";

export interface PendleConvertParams {
  receiver: string;
  input: PendleTokenAmount;
  /** Output token address. */
  outputToken: string;
  /** Slippage tolerance 0-1 (0.01 = 1%). */
  slippage: number;
}

export class PendleClient {
  private readonly throttle: PendleThrottle;

  constructor(private readonly baseUrl: string) {
    this.throttle = new PendleThrottle();
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value.length > 0) url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  /** GET through cache → dedupe → CU throttle. */
  private async get<T>(
    path: string,
    cost: number,
    ttlMs: number,
    validator: (raw: unknown) => T,
    query?: Record<string, string | undefined>,
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    try {
      return await this.throttle.run(url, cost, ttlMs, async () => {
        const response = await fetchWithTimeout(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        });
        if (!response.ok) {
          if (response.status === 429) {
            this.throttle.penalize(parseRetryAfterMs(response.headers?.get?.("retry-after")));
          }
          const raw = await readJson(response);
          logger.warn("pendle.api.http_error", {
            status: response.status,
            path,
            detail: raw === null ? null : JSON.stringify(raw).slice(0, 200),
          });
          throw mapPendleError(response.status, raw);
        }
        return validator(await readJson(response));
      });
    } catch (err) {
      mapPendleTransportError(err);
    }
  }

  /** Active markets on Ethereum (discovery + valuation source). */
  getActiveMarkets(): Promise<PendleMarket[]> {
    return this.get(`/v1/${PENDLE_CHAIN_ID}/markets/active`, PENDLE_CU.markets, PENDLE_TTL.markets, validateMarkets);
  }

  /** All Pendle assets (metadata + prices). Cached aggressively (5m, ~2.4k assets). */
  getAllAssets(): Promise<PendleAsset[]> {
    return this.get("/v1/assets/all", PENDLE_CU.assets, PENDLE_TTL.assets, validateAssets);
  }

  /** Dashboard positions for one wallet (valuation included per leg). */
  getPositions(wallet: string): Promise<PendleUserPositions[]> {
    return this.get(
      `/v1/dashboard/positions/database/${encodeURIComponent(wallet)}`,
      PENDLE_CU.positions,
      PENDLE_TTL.positions,
      validatePositions,
    );
  }

  /**
   * POST convert — build a mutating quote/broadcast plan. NEVER cached; still
   * CU-throttled + in-flight-deduped. Aggregators restricted to kyberswap/okx;
   * `useLimitOrder` false. Returns null when the body has no usable route.
   */
  async convert(params: PendleConvertParams): Promise<PendleConvertResponse | null> {
    const url = this.buildUrl(`/v3/sdk/${PENDLE_CHAIN_ID}/convert`);
    const body = {
      receiver: params.receiver,
      slippage: params.slippage,
      inputs: [params.input],
      outputs: [params.outputToken],
      enableAggregator: true,
      aggregators: [...PENDLE_AGGREGATORS],
      useLimitOrder: false,
    };
    // Dedupe key includes the body so identical concurrent converts share a call.
    const key = `${url}#${JSON.stringify(body)}`;
    try {
      return await this.throttle.run(key, PENDLE_CU.convert, PENDLE_TTL.convert, async () => {
        const response = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          if (response.status === 429) {
            this.throttle.penalize(parseRetryAfterMs(response.headers?.get?.("retry-after")));
          }
          const raw = await readJson(response);
          logger.warn("pendle.api.http_error", {
            status: response.status,
            path: "/v3/sdk/convert",
            detail: raw === null ? null : JSON.stringify(raw).slice(0, 200),
          });
          throw mapPendleError(response.status, raw);
        }
        return validateConvert(await readJson(response));
      });
    } catch (err) {
      mapPendleTransportError(err);
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let cachedClient: PendleClient | null = null;
let cachedBaseUrl: string | null = null;

export function getPendleClient(): PendleClient {
  const baseUrl = loadConfig().services.pendleApiUrl;
  if (cachedClient && cachedBaseUrl === baseUrl) return cachedClient;
  cachedClient = new PendleClient(baseUrl);
  cachedBaseUrl = baseUrl;
  return cachedClient;
}
