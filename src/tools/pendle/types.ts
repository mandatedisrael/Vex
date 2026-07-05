/**
 * Pendle provider-layer types — the NORMALIZED shapes the tolerant validators
 * (`./validation.ts`) produce from the hosted Pendle API. Every value here has
 * already passed type-narrowing; the trusted-field boundary
 * (`protocols/pendle/trusted-fields.ts`) still re-checks structural strings
 * before they reach model-facing output.
 *
 * Addresses on markets/assets arrive as `chainId-address` ids (e.g. "1-0x…");
 * the validators split the "1-" prefix so callers see bare `0x…` addresses.
 */

// ── markets/active ─────────────────────────────────────────────────

export interface PendleMarketDetails {
  liquidity: number | null;
  impliedApy: number | null;
  pendleApy: number | null;
  aggregatedApy: number | null;
  maxBoostedApy: number | null;
  feeRate: number | null;
}

export interface PendleMarket {
  /** Market (LP) contract address, bare 0x. */
  address: string;
  name: string | null;
  /** ISO expiry (immutable). */
  expiry: string | null;
  /** PT / YT / SY / underlying — bare 0x addresses (chainId prefix stripped). */
  pt: string | null;
  yt: string | null;
  sy: string | null;
  underlyingAsset: string | null;
  details: PendleMarketDetails;
  categoryIds: string[];
  isNew: boolean;
  isPrime: boolean;
}

// ── assets/all ─────────────────────────────────────────────────────

export interface PendleAsset {
  /** Bare 0x address (chainId prefix stripped). */
  address: string;
  symbol: string | null;
  decimals: number | null;
  /** ISO expiry for PT/YT/LP; null for generic assets. */
  expiry: string | null;
  /** PT | YT | SY | LP | GENERIC | NATIVE | IB … (raw upstream string). */
  baseType: string | null;
  /** Spot USD price. */
  priceUsd: number | null;
  /** Accounting-asset value (Pendle `price.acc`) — face for a matured PT. */
  priceAcc: number | null;
  /** ISO timestamp of the last price refresh. */
  priceUpdatedAt: string | null;
}

// ── dashboard positions ────────────────────────────────────────────

export interface PendlePositionLeg {
  balance: string;
  valuationUsd: number | null;
}

export interface PendleMarketPosition {
  /** `chainId-marketAddress` id from upstream. */
  marketId: string;
  pt: PendlePositionLeg | null;
  yt: PendlePositionLeg | null;
  lp: PendlePositionLeg | null;
}

export interface PendleUserPositions {
  chainId: number;
  openPositions: PendleMarketPosition[];
}

// ── convert (mutating quote / broadcast plan) ──────────────────────

/** Convert `action` discriminant (only the two we act on are meaningful). */
export type PendleConvertAction = "swap" | "redeem-py" | string;

export interface PendleTokenAmount {
  token: string;
  amount: string;
}

export interface PendleConvertRouteData {
  aggregatorType: string | null;
  priceImpact: number | null;
  feeUsd: number | null;
}

export interface PendleConvertContractParamInfo {
  method: string | null;
  /** Positional decoded params (`[receiver, market|YT, amount, …]`). */
  contractCallParams: unknown[];
}

export interface PendleConvertTx {
  /** Router address (asserted against PENDLE_ROUTER before any sign). */
  to: string;
  /** 0x calldata. */
  data: string;
  /** Sender (asserted absent-or-equal to the session wallet). */
  from: string | null;
  /** Present + non-zero ONLY for native ETH input. */
  value: string | null;
}

export interface PendleConvertRoute {
  contractParamInfo: PendleConvertContractParamInfo;
  tx: PendleConvertTx;
  outputs: PendleTokenAmount[];
  data: PendleConvertRouteData;
}

export interface PendleConvertResponse {
  action: PendleConvertAction;
  inputs: PendleTokenAmount[];
  /** Tokens the Router needs allowance for (spender is IMPLICIT = Router). */
  requiredApprovals: PendleTokenAmount[];
  routes: PendleConvertRoute[];
}

export interface PendleConvertRequest {
  receiver: string;
  slippage: number;
  inputs: PendleTokenAmount[];
  outputs: string[];
  enableAggregator: boolean;
  aggregators: string[];
  useLimitOrder: boolean;
}
