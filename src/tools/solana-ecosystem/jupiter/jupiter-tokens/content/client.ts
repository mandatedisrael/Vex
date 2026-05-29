/**
 * Low-level Jupiter Token Content API client.
 */

import { fetchJson } from "../../../../../utils/http.js";
import { JUPITER_TOKENS_V2_BASE_URL } from "../types.js";
import type {
  JupiterTokenContentFeedParams,
  JupiterTokenContentFeedResponse,
  JupiterTokenContentMultipleMintsResponse,
  JupiterTokenContentSummariesResponse,
} from "./types.js";
import {
  jupiterTokenContentFeedResponseSchema,
  jupiterTokenContentMultipleMintsResponseSchema,
  jupiterTokenContentSummariesResponseSchema,
} from "./schemas.js";
import {
  getJupiterContentHeaders,
  normalizeJupiterContentMints,
  requireJupiterContentApiKey,
  validateJupiterContentFeedParams,
} from "./validation.js";

function toQueryString(query: Record<string, string>): string {
  return new URLSearchParams(query).toString();
}

export async function jupiterTokenContentByMints(
  mints: string[],
): Promise<JupiterTokenContentMultipleMintsResponse> {
  requireJupiterContentApiKey();

  return fetchJson<JupiterTokenContentMultipleMintsResponse>(
    `${JUPITER_TOKENS_V2_BASE_URL}/content?${toQueryString({ mints: normalizeJupiterContentMints(mints) })}`,
    { headers: getJupiterContentHeaders() },
    jupiterTokenContentMultipleMintsResponseSchema,
  );
}

export async function jupiterTokenContentCooking(): Promise<JupiterTokenContentMultipleMintsResponse> {
  requireJupiterContentApiKey();

  return fetchJson<JupiterTokenContentMultipleMintsResponse>(
    `${JUPITER_TOKENS_V2_BASE_URL}/content/cooking`,
    { headers: getJupiterContentHeaders() },
    jupiterTokenContentMultipleMintsResponseSchema,
  );
}

export async function jupiterTokenContentFeed(
  params: JupiterTokenContentFeedParams,
): Promise<JupiterTokenContentFeedResponse> {
  requireJupiterContentApiKey();
  const validated = validateJupiterContentFeedParams(params);
  const query: Record<string, string> = { mint: validated.mint };

  if (validated.page != null) query.page = String(validated.page);
  if (validated.limit != null) query.limit = String(validated.limit);

  return fetchJson<JupiterTokenContentFeedResponse>(
    `${JUPITER_TOKENS_V2_BASE_URL}/content/feed?${toQueryString(query)}`,
    { headers: getJupiterContentHeaders() },
    jupiterTokenContentFeedResponseSchema,
  );
}

export async function jupiterTokenContentSummaries(
  mints: string[],
): Promise<JupiterTokenContentSummariesResponse> {
  requireJupiterContentApiKey();

  return fetchJson<JupiterTokenContentSummariesResponse>(
    `${JUPITER_TOKENS_V2_BASE_URL}/content/summaries?${toQueryString({ mints: normalizeJupiterContentMints(mints) })}`,
    { headers: getJupiterContentHeaders() },
    jupiterTokenContentSummariesResponseSchema,
  );
}
