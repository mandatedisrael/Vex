/**
 * ChainScan HTTP transport layer.
 * Rate limiting, retry logic, and raw API fetch functions.
 */

import { EchoError, ErrorCodes } from "../../errors.js";
import { loadConfig } from "../../config/store.js";
import logger from "../../utils/logger.js";
import { TokenBucket, ConcurrencyLimiter } from "../../utils/rateLimit.js";
import { CHAINSCAN_DEFAULTS } from "./constants.js";

// --- Instances ---

const bucket = new TokenBucket(CHAINSCAN_DEFAULTS.RATE_LIMIT_PER_SEC);
const limiter = new ConcurrencyLimiter(CHAINSCAN_DEFAULTS.MAX_CONCURRENT);

// --- Helpers ---

function getBaseUrl(): string {
  return loadConfig().services.chainScanBaseUrl;
}

function getApiKey(): string {
  return process.env.CHAINSCAN_API_KEY ?? "";
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = CHAINSCAN_DEFAULTS.MAX_RETRIES): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message;
      const isRetryable = msg.includes("429") || /HTTP [5]\d{2}/.test(msg);
      if (!isRetryable || attempt === maxRetries) throw lastError;
      const backoff = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
      logger.warn(`[ChainScan] Retry ${attempt + 1}/${maxRetries} after ${Math.round(backoff)}ms: ${msg}`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  throw lastError;
}

// --- Etherscan-style fetch: GET /api?module=...&action=... ---

export async function fetchEtherscanApi<T>(params: Record<string, string>): Promise<T> {
  await bucket.acquire();
  await limiter.acquire();

  try {
    return await withRetry(async () => {
      const url = new URL(`${getBaseUrl()}${CHAINSCAN_DEFAULTS.API_PATH}`);
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
      const apiKey = getApiKey();
      if (apiKey) url.searchParams.set("apikey", apiKey);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CHAINSCAN_DEFAULTS.TIMEOUT_MS);

      try {
        const res = await fetch(url.toString(), { signal: controller.signal });
        if (!res.ok) {
          if (res.status === 429) {
            throw new EchoError(ErrorCodes.CHAINSCAN_RATE_LIMITED, `ChainScan HTTP 429`);
          }
          throw new EchoError(ErrorCodes.CHAINSCAN_API_ERROR, `ChainScan HTTP ${res.status}`);
        }

        const json = (await res.json()) as { status?: string; message?: string; result?: unknown };

        if (json.status !== "1" && json.message !== "OK") {
          if (json.message === "No transactions found" || json.result === null || json.message === "No records found") {
            return [] as unknown as T;
          }
          throw new EchoError(
            ErrorCodes.CHAINSCAN_API_ERROR,
            json.message || "ChainScan API error",
            "Check the request parameters"
          );
        }

        return json.result as T;
      } catch (err) {
        if (err instanceof EchoError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new EchoError(
            ErrorCodes.CHAINSCAN_TIMEOUT,
            `ChainScan request timed out after ${CHAINSCAN_DEFAULTS.TIMEOUT_MS}ms`,
            "Try again or check network connectivity"
          );
        }
        throw new EchoError(
          ErrorCodes.CHAINSCAN_API_ERROR,
          err instanceof Error ? err.message : "ChainScan request failed"
        );
      } finally {
        clearTimeout(timer);
      }
    });
  } finally {
    limiter.release();
  }
}

// --- Custom endpoints fetch: GET /util/decode/..., /nft/..., /statistics/... ---

export async function fetchCustomApi<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  await bucket.acquire();
  await limiter.acquire();

  try {
    return await withRetry(async () => {
      const url = new URL(`${getBaseUrl()}${path}`);
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
      const apiKey = getApiKey();
      if (apiKey) url.searchParams.set("apikey", apiKey);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CHAINSCAN_DEFAULTS.TIMEOUT_MS);

      try {
        const res = await fetch(url.toString(), { signal: controller.signal });
        if (!res.ok) {
          if (res.status === 429) {
            throw new EchoError(ErrorCodes.CHAINSCAN_RATE_LIMITED, `ChainScan HTTP 429`);
          }
          throw new EchoError(ErrorCodes.CHAINSCAN_API_ERROR, `ChainScan HTTP ${res.status}`);
        }

        const json = await res.json() as Record<string, unknown>;

        // Defensively handle both response formats
        // Etherscan-style: { status: "1", message: "OK", result: T }
        if (typeof json.status === "string" && json.status === "1") {
          return json.result as T;
        }
        // Custom-style: { status: 0, message: "success", result: T }
        if (typeof json.status === "number" && json.status === 0) {
          return json.result as T;
        }
        // NFT/data-style: { code: 0, message: "...", data: T }
        if (typeof json.code === "number" && json.code === 0 && json.data !== undefined) {
          return json.data as T;
        }
        // Fallback: if result is present, return it
        if (json.result !== undefined && json.result !== null) {
          return json.result as T;
        }
        // Array response (some endpoints return raw arrays)
        if (Array.isArray(json)) {
          return json as unknown as T;
        }

        throw new EchoError(
          ErrorCodes.CHAINSCAN_INVALID_RESPONSE,
          `Unexpected ChainScan response format`,
          `status=${String(json.status)}, message=${String(json.message)}`
        );
      } catch (err) {
        if (err instanceof EchoError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new EchoError(
            ErrorCodes.CHAINSCAN_TIMEOUT,
            `ChainScan request timed out after ${CHAINSCAN_DEFAULTS.TIMEOUT_MS}ms`,
            "Try again or check network connectivity"
          );
        }
        throw new EchoError(
          ErrorCodes.CHAINSCAN_API_ERROR,
          err instanceof Error ? err.message : "ChainScan request failed"
        );
      } finally {
        clearTimeout(timer);
      }
    });
  } finally {
    limiter.release();
  }
}
