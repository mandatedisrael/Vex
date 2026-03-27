/**
 * KyberSwap Limit Order API types.
 *
 * Base URL: https://limit-order.kyberswap.com
 * Maker flows: sign → create → query → cancel
 * Taker flows: query → operator-signature → fill
 */

import type { Address } from "viem";

// ── EIP-712 signing ─────────────────────────────────────────────────

export interface LimitOrderSignMessageRequest {
  chainId: string;
  makerAsset: Address;
  takerAsset: Address;
  maker: Address;
  makingAmount: string;
  takingAmount: string;
  expiredAt: number;
  receiver?: Address;
  allowedSenders?: Address[];
}

export interface LimitOrderEip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

export interface LimitOrderEip712Message {
  domain: LimitOrderEip712Domain;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown> & { salt: string };
}

// ── Create order ────────────────────────────────────────────────────

export interface LimitOrderCreateRequest {
  chainId: string;
  makerAsset: Address;
  takerAsset: Address;
  maker: Address;
  makingAmount: string;
  takingAmount: string;
  expiredAt: number;
  salt: string;
  signature: string;
  receiver?: Address;
  allowedSenders?: Address[];
}

// ── Order data ──────────────────────────────────────────────────────

export type LimitOrderStatus =
  | "active" | "open" | "filled" | "partially_filled"
  | "cancelled" | "expired" | "invalid";

export interface LimitOrder {
  id: number;
  chainId: string;
  makerAsset: string;
  takerAsset: string;
  maker: string;
  makingAmount: string;
  takingAmount: string;
  filledMakingAmount: string;
  filledTakingAmount: string;
  status: LimitOrderStatus;
  expiredAt: number;
  salt: string;
  signature: string;
  createdAt: string;
  updatedAt: string;
  makerAssetSymbol?: string;
  takerAssetSymbol?: string;
  makerAssetDecimals?: number;
  takerAssetDecimals?: number;
}

// ── Cancel ──────────────────────────────────────────────────────────

export interface LimitOrderCancelSignRequest {
  chainId: string;
  maker: Address;
  orderIds: number[];
}

// ── Taker ───────────────────────────────────────────────────────────

export interface OperatorSignatureResponse {
  operatorSignatures: string[];
}

export interface FillOrderRequest {
  orderId: number;
  takingAmount: string;
  thresholdAmount: string;
  target: Address;
  operatorSignature: string;
}

export interface FillBatchOrdersRequest {
  orderIds: number[];
  takingAmounts: string[];
  thresholdAmount: string;
  target: Address;
  operatorSignatures: string[];
}

export interface EncodedCalldata {
  encodedData: string;
  routerAddress?: Address;
}

// ── General ────────────────────────────────────────────────────────

export interface TradingPair {
  makerAsset: string;
  takerAsset: string;
  chainId: string;
}

export interface ContractAddresses {
  [chainId: string]: string;
}
