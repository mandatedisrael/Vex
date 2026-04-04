/**
 * URL helpers for Jupiter Prediction API client.
 */

import { JUPITER_PREDICTION_API_BASE_URL } from "../../constants.js";

export function toQueryString(query: Record<string, string | undefined>): string {
  const defined = Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return new URLSearchParams(defined).toString();
}

export function withQuery(path: string, query: Record<string, string | undefined>): string {
  const qs = toQueryString(query);
  return qs ? `${JUPITER_PREDICTION_API_BASE_URL}${path}?${qs}` : `${JUPITER_PREDICTION_API_BASE_URL}${path}`;
}
