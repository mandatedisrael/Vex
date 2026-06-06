/**
 * Stateless HTTP shaping helpers for the Polymarket CLOB client.
 *
 * The class, all public endpoint methods, the request orchestration, and the
 * singleton stay in `../client.ts`. Extracted here are ONLY the stateless,
 * `this`-free pieces the orchestration reuses, single-sourced so the three
 * request paths (`requestPublic` / `requestAuth` / `requestPublicPost`) never
 * duplicate them:
 *
 *  - URL + query-string shaping (moved verbatim from the class `buildUrl`;
 *    `this.baseUrl` is now the `baseUrl` parameter),
 *  - the CLOB error-message derivation that was byte-identical at all three
 *    non-ok branches,
 *  - the authenticated request header shaping (the `Content-Type`-on-body
 *    spread).
 *
 * No behavior, ordering, or types change — these are faithful moves with the
 * former instance state passed in as arguments.
 */

import { isRecord } from "../../../../utils/validation-helpers.js";

/** URL + query shaping (moved verbatim from `PolyClobClient#buildUrl`). */
export function buildClobUrl(baseUrl: string, path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value.length > 0) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Derives the error message from a non-ok CLOB response body. Byte-identical to
 * the inline derivation the class used in every `!response.ok` branch.
 */
export function clobErrorMessage(raw: unknown, status: number): string {
  return isRecord(raw) && typeof raw.error === "string" ? raw.error : `HTTP ${status}`;
}

/**
 * Authenticated request header shaping: spreads the signed CLOB headers and
 * adds `Content-Type: application/json` only when a body is present. Moved
 * verbatim from the inline `requestAuth` header object.
 */
export function buildClobAuthHeaders(headers: Record<string, string>, body: unknown): Record<string, string> {
  return {
    ...headers,
    ...(body !== undefined ? { "Content-Type": "application/json" } : undefined),
  };
}
