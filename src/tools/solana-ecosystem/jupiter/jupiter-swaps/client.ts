/**
 * Low-level Jupiter Swap API V2 client.
 * Source-of-truth for /order, /build and /execute.
 */

import { fetchJson } from "../../../../utils/http.js";
import type {
  JupiterSwapBuildParams,
  JupiterSwapBuildResponse,
  JupiterSwapExecuteRequest,
  JupiterSwapExecuteResponse,
  JupiterSwapOrderParams,
  JupiterSwapOrderResponse,
} from "./types.js";
import { JUPITER_SWAP_V2_BASE_URL } from "./types.js";
import {
  jupiterSwapBuildResponseSchema,
  jupiterSwapExecuteResponseSchema,
  jupiterSwapOrderResponseSchema,
} from "./schemas.js";
import {
  getJupiterSwapHeaders,
  normalizeBuildQueryParams,
  normalizeOrderQueryParams,
  validateJupiterSwapExecuteRequest,
} from "./validation.js";

function toQueryString(query: Record<string, string>): string {
  return new URLSearchParams(query).toString();
}

export async function jupiterSwapOrder(params: JupiterSwapOrderParams): Promise<JupiterSwapOrderResponse> {
  const query = normalizeOrderQueryParams(params);
  return fetchJson<JupiterSwapOrderResponse>(
    `${JUPITER_SWAP_V2_BASE_URL}/order?${toQueryString(query)}`,
    { headers: getJupiterSwapHeaders() },
    jupiterSwapOrderResponseSchema,
  );
}

export async function jupiterSwapBuild(params: JupiterSwapBuildParams): Promise<JupiterSwapBuildResponse> {
  const query = normalizeBuildQueryParams(params);
  return fetchJson<JupiterSwapBuildResponse>(
    `${JUPITER_SWAP_V2_BASE_URL}/build?${toQueryString(query)}`,
    { headers: getJupiterSwapHeaders() },
    jupiterSwapBuildResponseSchema,
  );
}

export async function jupiterSwapExecute(
  request: JupiterSwapExecuteRequest,
): Promise<JupiterSwapExecuteResponse> {
  validateJupiterSwapExecuteRequest(request);

  return fetchJson<JupiterSwapExecuteResponse>(
    `${JUPITER_SWAP_V2_BASE_URL}/execute`,
    {
      method: "POST",
      headers: getJupiterSwapHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(request),
    },
    jupiterSwapExecuteResponseSchema,
  );
}
