/**
 * KyberSwap Aggregator API types.
 *
 * V1 two-step flow: GET /{chain}/api/v1/routes → POST /{chain}/api/v1/route/build
 */

import type { Address } from "viem";
import type { KyberChainSlug } from "../types.js";

// ── GET /routes request params ──────────────────────────────────────

export interface SwapRouteParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  includedSources?: string;
  excludedSources?: string;
  excludeRFQSources?: boolean;
  onlyScalableSources?: boolean;
  onlyDirectPools?: boolean;
  onlySinglePath?: boolean;
  gasInclude?: boolean;
  gasPrice?: string;
  origin?: Address;
  feeAmount?: string;
  chargeFeeBy?: "currency_in" | "currency_out";
  isInBps?: boolean;
  feeReceiver?: string;
}

// ── GET /routes response ────────────────────────────────────────────

export interface SwapRouteStep {
  pool: string;
  tokenIn: string;
  tokenOut: string;
  swapAmount: string;
  amountOut: string;
  exchange: string;
  poolType: string;
  poolExtra: unknown;
  extra: unknown;
}

export interface SwapExtraFee {
  feeAmount: string;
  chargeFeeBy?: "currency_in" | "currency_out";
  isInBps?: boolean;
  feeReceiver?: string;
}

export interface SwapRouteSummary {
  tokenIn: string;
  amountIn: string;
  amountInUsd: string;
  tokenOut: string;
  amountOut: string;
  amountOutUsd: string;
  gas: string;
  gasPrice: string;
  gasUsd: string;
  l1FeeUsd?: string;
  extraFee?: SwapExtraFee;
  route: SwapRouteStep[][];
  routeID: string;
  checksum: string;
  timestamp?: string;
}

export interface SwapRouteResponse {
  code: number;
  message?: string;
  data: {
    routeSummary: SwapRouteSummary;
    routerAddress: Address;
  };
  requestId?: string;
}

// ── POST /route/build request body ──────────────────────────────────

export interface SwapBuildRequest {
  routeSummary: SwapRouteSummary;
  sender: Address;
  recipient: Address;
  slippageTolerance: number;
  deadline?: number;
  origin?: Address;
  permit?: string;
  source?: string;
  referral?: string;
  enableGasEstimation?: boolean;
  ignoreCappedSlippage?: boolean;
}

// ── POST /route/build response ──────────────────────────────────────

export interface SwapBuildResponse {
  code: number;
  message?: string;
  data: {
    amountIn: string;
    amountInUsd: string;
    amountOut: string;
    amountOutUsd: string;
    gas: string;
    gasUsd: string;
    additionalCostUsd?: string;
    additionalCostMessage?: string;
    data: string;
    routerAddress: Address;
    transactionValue: string;
  };
  requestId?: string;
}
