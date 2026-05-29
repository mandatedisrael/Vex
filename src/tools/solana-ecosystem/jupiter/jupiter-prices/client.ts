/**
 * Low-level Jupiter Price API V3 client.
 * Source-of-truth for current USD pricing endpoints.
 */

import { fetchJson } from "../../../../utils/http.js";
import { jupiterPriceResponseSchema } from "./schemas.js";
import { JUPITER_PRICE_V3_BASE_URL, type JupiterPriceRequestParams, type JupiterPriceResponse } from "./types.js";
import {
  getJupiterPriceHeaders,
  normalizeJupiterPriceMintList,
  requireJupiterPriceApiKey,
  validateJupiterPriceRequestParams,
} from "./validation.js";

function toQueryString(query: Record<string, string>): string {
  return new URLSearchParams(query).toString();
}

export async function jupiterPrices(params: JupiterPriceRequestParams): Promise<JupiterPriceResponse> {
  requireJupiterPriceApiKey();
  const validated = validateJupiterPriceRequestParams(params);

  return fetchJson<JupiterPriceResponse>(
    `${JUPITER_PRICE_V3_BASE_URL}/price/v3?${toQueryString({ ids: validated.ids.join(",") })}`,
    { headers: getJupiterPriceHeaders() },
    jupiterPriceResponseSchema,
  );
}

export async function jupiterPricesByMint(mints: string[]): Promise<JupiterPriceResponse> {
  requireJupiterPriceApiKey();

  return fetchJson<JupiterPriceResponse>(
    `${JUPITER_PRICE_V3_BASE_URL}/price/v3?${toQueryString({ ids: normalizeJupiterPriceMintList(mints) })}`,
    { headers: getJupiterPriceHeaders() },
    jupiterPriceResponseSchema,
  );
}

