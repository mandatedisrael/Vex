/**
 * Runtime validators for KyberSwap Limit Order API responses.
 */

import { ErrorCodes } from "../../../errors.js";
import { isRecord, createFieldValidators } from "../../../utils/validation-helpers.js";
import type {
  LimitOrder,
  LimitOrderEip712Message,
  LimitOrderEip712Domain,
  OperatorSignatureResponse,
  EncodedCalldata,
  TradingPair,
  ContractAddresses,
} from "./types.js";

const { asString, asNumber, asOptionalString } = createFieldValidators(
  ErrorCodes.KYBER_API_ERROR, "KyberSwap Limit Order",
);

function parseDomain(raw: unknown): LimitOrderEip712Domain {
  if (!isRecord(raw)) throw new Error("EIP-712 domain must be an object");
  return {
    name: asString(raw.name, "domain.name"),
    version: asString(raw.version, "domain.version"),
    chainId: asNumber(raw.chainId, "domain.chainId"),
    verifyingContract: asString(raw.verifyingContract, "domain.verifyingContract") as LimitOrderEip712Domain["verifyingContract"],
  };
}

export function validateEip712Message(raw: unknown): LimitOrderEip712Message {
  if (!isRecord(raw)) throw new Error("Expected EIP-712 message object");
  const message = raw.message;
  if (!isRecord(message)) throw new Error("EIP-712 message.message must be an object");

  return {
    domain: parseDomain(raw.domain),
    types: (raw.types ?? {}) as LimitOrderEip712Message["types"],
    primaryType: asString(raw.primaryType, "primaryType"),
    message: { ...message, salt: asString(message.salt, "message.salt") } as LimitOrderEip712Message["message"],
  };
}

function parseOrder(raw: unknown): LimitOrder {
  if (!isRecord(raw)) throw new Error("order must be an object");
  return {
    id: asNumber(raw.id, "order.id"),
    chainId: asString(raw.chainId, "order.chainId"),
    makerAsset: asString(raw.makerAsset, "order.makerAsset"),
    takerAsset: asString(raw.takerAsset, "order.takerAsset"),
    maker: asString(raw.maker, "order.maker"),
    makingAmount: asString(raw.makingAmount, "order.makingAmount"),
    takingAmount: asString(raw.takingAmount, "order.takingAmount"),
    filledMakingAmount: typeof raw.filledMakingAmount === "string" ? raw.filledMakingAmount : "0",
    filledTakingAmount: typeof raw.filledTakingAmount === "string" ? raw.filledTakingAmount : "0",
    status: asString(raw.status, "order.status") as LimitOrder["status"],
    expiredAt: asNumber(raw.expiredAt, "order.expiredAt"),
    salt: asString(raw.salt, "order.salt"),
    signature: asString(raw.signature, "order.signature"),
    createdAt: asString(raw.createdAt, "order.createdAt"),
    updatedAt: asString(raw.updatedAt, "order.updatedAt"),
    makerAssetSymbol: asOptionalString(raw.makerAssetSymbol),
    takerAssetSymbol: asOptionalString(raw.takerAssetSymbol),
    makerAssetDecimals: typeof raw.makerAssetDecimals === "number" ? raw.makerAssetDecimals : undefined,
    takerAssetDecimals: typeof raw.takerAssetDecimals === "number" ? raw.takerAssetDecimals : undefined,
  };
}

export function validateOrdersResponse(raw: unknown): LimitOrder[] {
  if (!isRecord(raw) || !Array.isArray(raw.orders)) {
    if (Array.isArray(raw)) return raw.map(parseOrder);
    throw new Error("Expected orders response");
  }
  return raw.orders.map(parseOrder);
}

export function validateCreateOrderResponse(raw: unknown): { orderId: number } {
  if (!isRecord(raw)) throw new Error("Expected create order response");
  return { orderId: asNumber(raw.id ?? raw.orderId, "orderId") };
}

export function validateActiveMakingAmount(raw: unknown): string {
  if (!isRecord(raw)) throw new Error("Expected active making amount response");
  return asString(raw.activeMakingAmount ?? raw.data, "activeMakingAmount");
}

export function validateOperatorSignature(raw: unknown): OperatorSignatureResponse {
  if (!isRecord(raw)) throw new Error("Expected operator signature response");
  const sigs = Array.isArray(raw.operatorSignatures) ? raw.operatorSignatures : [];
  return {
    operatorSignatures: sigs.filter((s): s is string => typeof s === "string"),
  };
}

export function validateEncodedCalldata(raw: unknown): EncodedCalldata {
  if (!isRecord(raw)) throw new Error("Expected encoded calldata response");
  return {
    encodedData: asString(raw.encodedData, "encodedData"),
    routerAddress: asOptionalString(raw.routerAddress) as EncodedCalldata["routerAddress"],
  };
}

export function validateTradingPairsResponse(raw: unknown): TradingPair[] {
  if (!Array.isArray(raw)) {
    if (isRecord(raw) && Array.isArray(raw.pairs)) return (raw.pairs as unknown[]).map(parseTradingPair);
    if (isRecord(raw) && Array.isArray(raw.data)) return (raw.data as unknown[]).map(parseTradingPair);
    throw new Error("Expected trading pairs response");
  }
  return raw.map(parseTradingPair);
}

function parseTradingPair(raw: unknown): TradingPair {
  if (!isRecord(raw)) throw new Error("trading pair must be an object");
  return {
    makerAsset: asString(raw.makerAsset, "pair.makerAsset"),
    takerAsset: asString(raw.takerAsset, "pair.takerAsset"),
    chainId: asString(raw.chainId, "pair.chainId"),
  };
}

export function validateContractAddressResponse(raw: unknown): ContractAddresses {
  if (!isRecord(raw)) throw new Error("Expected contract address response");
  const result: ContractAddresses = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}
