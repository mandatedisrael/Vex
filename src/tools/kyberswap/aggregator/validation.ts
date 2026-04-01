/**
 * Runtime validators for KyberSwap Aggregator API responses.
 */

import { ErrorCodes } from "../../../errors.js";
import { isRecord, createFieldValidators } from "../../../utils/validation-helpers.js";
import type { SwapRouteResponse, SwapRouteSummary, SwapRouteStep, SwapBuildResponse, SwapExtraFee } from "./types.js";

const { asString, asNumber, asOptionalString } = createFieldValidators(
  ErrorCodes.KYBER_API_ERROR, "KyberSwap Aggregator",
);

function parseExtraFee(raw: unknown): SwapExtraFee | undefined {
  if (!isRecord(raw)) return undefined;
  return {
    feeAmount: typeof raw.feeAmount === "string" ? raw.feeAmount : "",
    chargeFeeBy: raw.chargeFeeBy === "currency_in" || raw.chargeFeeBy === "currency_out" ? raw.chargeFeeBy : undefined,
    isInBps: typeof raw.isInBps === "boolean" ? raw.isInBps : undefined,
    feeReceiver: typeof raw.feeReceiver === "string" ? raw.feeReceiver : undefined,
  };
}

function parseRouteStep(raw: unknown): SwapRouteStep {
  if (!isRecord(raw)) {
    throw new Error("route step must be an object");
  }
  return {
    pool: asString(raw.pool, "route.pool"),
    tokenIn: asString(raw.tokenIn, "route.tokenIn"),
    tokenOut: asString(raw.tokenOut, "route.tokenOut"),
    swapAmount: asString(raw.swapAmount, "route.swapAmount"),
    amountOut: asString(raw.amountOut, "route.amountOut"),
    exchange: asString(raw.exchange, "route.exchange"),
    poolType: asString(raw.poolType, "route.poolType"),
    poolExtra: raw.poolExtra ?? null,
    extra: raw.extra ?? null,
  };
}

function parseRouteSummary(raw: unknown): SwapRouteSummary {
  if (!isRecord(raw)) {
    throw new Error("routeSummary must be an object");
  }

  const route = Array.isArray(raw.route)
    ? raw.route.map((path) => {
        if (!Array.isArray(path)) return [];
        return path.map(parseRouteStep);
      })
    : [];

  return {
    tokenIn: asString(raw.tokenIn, "routeSummary.tokenIn"),
    amountIn: asString(raw.amountIn, "routeSummary.amountIn"),
    amountInUsd: asString(raw.amountInUsd, "routeSummary.amountInUsd"),
    tokenOut: asString(raw.tokenOut, "routeSummary.tokenOut"),
    amountOut: asString(raw.amountOut, "routeSummary.amountOut"),
    amountOutUsd: asString(raw.amountOutUsd, "routeSummary.amountOutUsd"),
    gas: asString(raw.gas, "routeSummary.gas"),
    gasPrice: asString(raw.gasPrice, "routeSummary.gasPrice"),
    gasUsd: asString(raw.gasUsd, "routeSummary.gasUsd"),
    l1FeeUsd: asOptionalString(raw.l1FeeUsd),
    extraFee: parseExtraFee(raw.extraFee),
    route,
    routeID: asString(raw.routeID, "routeSummary.routeID"),
    checksum: asString(raw.checksum, "routeSummary.checksum"),
    timestamp: asOptionalString(raw.timestamp),
  };
}

export function validateSwapRouteResponse(raw: unknown): SwapRouteResponse {
  if (!isRecord(raw)) {
    throw new Error("Expected KyberSwap route response object");
  }
  const code = asNumber(raw.code, "code");
  const data = raw.data;
  if (!isRecord(data)) {
    throw new Error("Expected KyberSwap route response data");
  }

  return {
    code,
    message: asOptionalString(raw.message),
    data: {
      routeSummary: parseRouteSummary(data.routeSummary),
      routerAddress: asString(data.routerAddress, "data.routerAddress") as SwapRouteResponse["data"]["routerAddress"],
    },
    requestId: asOptionalString(raw.requestId),
  };
}

export function validateSwapBuildResponse(raw: unknown): SwapBuildResponse {
  if (!isRecord(raw)) {
    throw new Error("Expected KyberSwap build response object");
  }
  const code = asNumber(raw.code, "code");
  const data = raw.data;
  if (!isRecord(data)) {
    throw new Error("Expected KyberSwap build response data");
  }

  return {
    code,
    message: asOptionalString(raw.message),
    data: {
      amountIn: asString(data.amountIn, "data.amountIn"),
      amountInUsd: asString(data.amountInUsd, "data.amountInUsd"),
      amountOut: asString(data.amountOut, "data.amountOut"),
      amountOutUsd: asString(data.amountOutUsd, "data.amountOutUsd"),
      gas: asString(data.gas, "data.gas"),
      gasUsd: asString(data.gasUsd, "data.gasUsd"),
      additionalCostUsd: asOptionalString(data.additionalCostUsd),
      additionalCostMessage: asOptionalString(data.additionalCostMessage),
      data: asString(data.data, "data.data"),
      routerAddress: asString(data.routerAddress, "data.routerAddress") as SwapBuildResponse["data"]["routerAddress"],
      transactionValue: asString(data.transactionValue, "data.transactionValue"),
    },
    requestId: asOptionalString(raw.requestId),
  };
}
