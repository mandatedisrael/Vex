/**
 * Jupiter Prediction API — POST/DELETE endpoints (write operations).
 */

import { fetchJson } from "../../../../../../utils/http.js";
import { JUPITER_PREDICTION_API_BASE_URL } from "../../constants.js";
import type {
  JupiterPredictionCreateOrderRequest,
  JupiterPredictionCreateOrderResponse,
  JupiterPredictionClosePositionRequest,
  JupiterPredictionCloseAllPositionsRequest,
  JupiterPredictionCloseAllPositionsResponse,
  JupiterPredictionClaimPositionRequest,
  JupiterPredictionClaimPositionResponse,
} from "../types.js";
import {
  getJupiterPredictionHeaders,
  requireJupiterPredictionApiKey,
  validateJupiterPredictionCreateOrderRequest,
  validateJupiterPredictionClosePositionRequest,
  validateJupiterPredictionCloseAllPositionsRequest,
  validateJupiterPredictionClaimPositionRequest,
  validateJupiterPredictionPositionParams,
} from "../validation.js";
import {
  jupiterPredictionCreateOrderResponseSchema,
  jupiterPredictionCloseAllPositionsResponseSchema,
  jupiterPredictionClaimPositionResponseSchema,
} from "../schemas.js";

export async function jupiterPredictionCreateOrder(
  request: JupiterPredictionCreateOrderRequest,
): Promise<JupiterPredictionCreateOrderResponse> {
  requireJupiterPredictionApiKey();

  return fetchJson<JupiterPredictionCreateOrderResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/orders`,
    {
      method: "POST",
      headers: getJupiterPredictionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterPredictionCreateOrderRequest(request)),
    },
    jupiterPredictionCreateOrderResponseSchema,
  );
}

export async function jupiterPredictionClosePosition(
  positionPubkey: string,
  request: JupiterPredictionClosePositionRequest,
): Promise<JupiterPredictionCreateOrderResponse> {
  requireJupiterPredictionApiKey();
  const validatedPosition = validateJupiterPredictionPositionParams({ positionPubkey });

  return fetchJson<JupiterPredictionCreateOrderResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/positions/${validatedPosition.positionPubkey}`,
    {
      method: "DELETE",
      headers: getJupiterPredictionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterPredictionClosePositionRequest(request)),
    },
    jupiterPredictionCreateOrderResponseSchema,
  );
}

export async function jupiterPredictionCloseAllPositions(
  request: JupiterPredictionCloseAllPositionsRequest,
): Promise<JupiterPredictionCloseAllPositionsResponse> {
  requireJupiterPredictionApiKey();

  return fetchJson<JupiterPredictionCloseAllPositionsResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/positions`,
    {
      method: "DELETE",
      headers: getJupiterPredictionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterPredictionCloseAllPositionsRequest(request)),
    },
    jupiterPredictionCloseAllPositionsResponseSchema,
  );
}

export async function jupiterPredictionClaimPosition(
  positionPubkey: string,
  request: JupiterPredictionClaimPositionRequest,
): Promise<JupiterPredictionClaimPositionResponse> {
  requireJupiterPredictionApiKey();
  const validatedPosition = validateJupiterPredictionPositionParams({ positionPubkey });

  return fetchJson<JupiterPredictionClaimPositionResponse>(
    `${JUPITER_PREDICTION_API_BASE_URL}/positions/${validatedPosition.positionPubkey}/claim`,
    {
      method: "POST",
      headers: getJupiterPredictionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterPredictionClaimPositionRequest(request)),
    },
    jupiterPredictionClaimPositionResponseSchema,
  );
}
