/**
 * Runtime validators for DexScreener API responses.
 *
 * Hand-written validators following the Khalani pattern.
 * Every function throws EchoError on invalid shapes.
 */

import { EchoError, ErrorCodes } from "../../errors.js";
import { isRecord } from "../../utils/validation-helpers.js";
import type {
  DexAd,
  DexBoost,
  DexBoosts,
  DexCommunityTakeover,
  DexLink,
  DexLiquidity,
  DexOrder,
  DexPair,
  DexPairInfo,
  DexQuoteToken,
  DexToken,
  DexTokenProfile,
  DexTxnCounts,
  PairsResponse,
  SearchResponse,
  TokensPairsResponse,
  TokensResponse,
  WsHandshake,
} from "./types.js";

// ── Helpers (domain-specific: DexScreener uses null, not undefined) ──

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, `Invalid DexScreener response: expected string for ${field}`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, `Invalid DexScreener response: expected number for ${field}`);
  }
  return value;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

// ── Token parsers ───────────────────────────────────────────────────

function parseBaseToken(raw: unknown): DexToken {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: baseToken must be an object");
  }
  return {
    address: asString(raw.address, "baseToken.address"),
    name: asString(raw.name, "baseToken.name"),
    symbol: asString(raw.symbol, "baseToken.symbol"),
  };
}

function parseQuoteToken(raw: unknown): DexQuoteToken {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: quoteToken must be an object");
  }
  return {
    address: asOptionalString(raw.address),
    name: asOptionalString(raw.name),
    symbol: asOptionalString(raw.symbol),
  };
}

// ── Nested object parsers ───────────────────────────────────────────

function parseTxnCounts(raw: unknown): Record<string, DexTxnCounts> {
  if (!isRecord(raw)) return {};
  const result: Record<string, DexTxnCounts> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isRecord(value)) {
      result[key] = {
        buys: typeof value.buys === "number" ? value.buys : 0,
        sells: typeof value.sells === "number" ? value.sells : 0,
      };
    }
  }
  return result;
}

function parseNumberRecord(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {};
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number") {
      result[key] = value;
    }
  }
  return result;
}

function parseLiquidity(raw: unknown): DexLiquidity | null {
  if (!isRecord(raw)) return null;
  return {
    usd: asOptionalNumber(raw.usd),
    base: typeof raw.base === "number" ? raw.base : 0,
    quote: typeof raw.quote === "number" ? raw.quote : 0,
  };
}

function parseInfo(raw: unknown): DexPairInfo | null {
  if (!isRecord(raw)) return null;
  return {
    imageUrl: asOptionalString(raw.imageUrl),
    websites: Array.isArray(raw.websites)
      ? raw.websites.filter(isRecord).map(w => ({ url: typeof w.url === "string" ? w.url : "" }))
      : null,
    socials: Array.isArray(raw.socials)
      ? raw.socials.filter(isRecord).map(s => ({
          platform: typeof s.platform === "string" ? s.platform : "",
          handle: typeof s.handle === "string" ? s.handle : "",
        }))
      : null,
  };
}

function parseBoosts(raw: unknown): DexBoosts | null {
  if (!isRecord(raw)) return null;
  return { active: typeof raw.active === "number" ? raw.active : 0 };
}

function parseLabels(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((item): item is string => typeof item === "string");
}

// ── Pair parser ─────────────────────────────────────────────────────

function parsePair(raw: unknown): DexPair {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: pair must be an object");
  }

  return {
    chainId: asString(raw.chainId, "pair.chainId"),
    dexId: asString(raw.dexId, "pair.dexId"),
    url: asString(raw.url, "pair.url"),
    pairAddress: asString(raw.pairAddress, "pair.pairAddress"),
    labels: parseLabels(raw.labels),
    baseToken: parseBaseToken(raw.baseToken),
    quoteToken: parseQuoteToken(raw.quoteToken),
    priceNative: asString(raw.priceNative, "pair.priceNative"),
    priceUsd: asOptionalString(raw.priceUsd),
    txns: parseTxnCounts(raw.txns),
    volume: parseNumberRecord(raw.volume),
    priceChange: isRecord(raw.priceChange) ? parseNumberRecord(raw.priceChange) : null,
    liquidity: parseLiquidity(raw.liquidity),
    fdv: asOptionalNumber(raw.fdv),
    marketCap: asOptionalNumber(raw.marketCap),
    pairCreatedAt: asOptionalNumber(raw.pairCreatedAt),
    info: parseInfo(raw.info),
    boosts: parseBoosts(raw.boosts),
  };
}

// ── Response validators ─────────────────────────────────────────────

export function validatePairsResponse(raw: unknown): PairsResponse {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected pairs response object");
  }
  return {
    schemaVersion: typeof raw.schemaVersion === "string" ? raw.schemaVersion : "",
    pairs: Array.isArray(raw.pairs) ? raw.pairs.map(parsePair) : null,
  };
}

export function validateSearchResponse(raw: unknown): SearchResponse {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected search response object");
  }
  return {
    schemaVersion: typeof raw.schemaVersion === "string" ? raw.schemaVersion : "",
    pairs: Array.isArray(raw.pairs) ? raw.pairs.map(parsePair) : [],
  };
}

export function validateTokensResponse(raw: unknown): TokensResponse {
  if (!Array.isArray(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected tokens array");
  }
  return raw.map(parsePair);
}

export function validateTokensPairsResponse(raw: unknown): TokensPairsResponse {
  if (!Array.isArray(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected token-pairs array");
  }
  return raw.map(parsePair);
}

// ── Links parser (shared by profiles + boosts) ──────────────────────

function parseLinks(raw: unknown): DexLink[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter(isRecord).map(item => ({
    type: asOptionalString(item.type),
    label: asOptionalString(item.label),
    url: typeof item.url === "string" ? item.url : "",
  }));
}

// ── Profiles ────────────────────────────────────────────────────────

function parseProfile(raw: unknown): DexTokenProfile {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: profile must be an object");
  }
  return {
    url: asString(raw.url, "profile.url"),
    chainId: asString(raw.chainId, "profile.chainId"),
    tokenAddress: asString(raw.tokenAddress, "profile.tokenAddress"),
    icon: typeof raw.icon === "string" ? raw.icon : "",
    header: asOptionalString(raw.header),
    description: asOptionalString(raw.description),
    links: parseLinks(raw.links),
  };
}

export function validateProfilesResponse(raw: unknown): DexTokenProfile[] {
  if (!Array.isArray(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected profiles array");
  }
  return raw.map(parseProfile);
}

// ── Boosts ──────────────────────────────────────────────────────────

function parseBoost(raw: unknown): DexBoost {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: boost must be an object");
  }
  return {
    url: asString(raw.url, "boost.url"),
    chainId: asString(raw.chainId, "boost.chainId"),
    tokenAddress: asString(raw.tokenAddress, "boost.tokenAddress"),
    amount: asNumber(raw.amount, "boost.amount"),
    totalAmount: asNumber(raw.totalAmount, "boost.totalAmount"),
    icon: asOptionalString(raw.icon),
    header: asOptionalString(raw.header),
    description: asOptionalString(raw.description),
    links: parseLinks(raw.links),
  };
}

export function validateBoostsResponse(raw: unknown): DexBoost[] {
  if (!Array.isArray(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected boosts array");
  }
  return raw.map(parseBoost);
}

// ── Orders ──────────────────────────────────────────────────────────

function parseOrder(raw: unknown): DexOrder {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: order must be an object");
  }
  return {
    type: asString(raw.type, "order.type") as DexOrder["type"],
    status: asString(raw.status, "order.status") as DexOrder["status"],
    paymentTimestamp: asNumber(raw.paymentTimestamp, "order.paymentTimestamp"),
  };
}

export function validateOrdersResponse(raw: unknown): DexOrder[] {
  if (!Array.isArray(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected orders array");
  }
  return raw.map(parseOrder);
}

// ── WebSocket handshake ─────────────────────────────────────────────

export function validateWsHandshake<T>(
  raw: unknown,
  itemValidator: (item: unknown) => T,
): WsHandshake<T> {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener WS handshake: expected object");
  }
  return {
    limit: typeof raw.limit === "number" ? raw.limit : 0,
    data: Array.isArray(raw.data) ? raw.data.map(itemValidator) : [],
  };
}

export function validateWsProfile(raw: unknown): DexTokenProfile {
  return parseProfile(raw);
}

export function validateWsBoost(raw: unknown): DexBoost {
  return parseBoost(raw);
}

// ── Community Takeovers ─────────────────────────────────────────────

function parseCommunityTakeover(raw: unknown): DexCommunityTakeover {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: community takeover must be an object");
  }
  return {
    url: asString(raw.url, "cto.url"),
    chainId: asString(raw.chainId, "cto.chainId"),
    tokenAddress: asString(raw.tokenAddress, "cto.tokenAddress"),
    icon: typeof raw.icon === "string" ? raw.icon : "",
    header: asOptionalString(raw.header),
    description: asOptionalString(raw.description),
    links: parseLinks(raw.links),
    claimDate: asString(raw.claimDate, "cto.claimDate"),
  };
}

export function validateCommunityTakeoversResponse(raw: unknown): DexCommunityTakeover[] {
  if (!Array.isArray(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected community takeovers array");
  }
  return raw.map(parseCommunityTakeover);
}

export function validateWsCommunityTakeover(raw: unknown): DexCommunityTakeover {
  return parseCommunityTakeover(raw);
}

// ── Ads ─────────────────────────────────────────────────────────────

function parseAd(raw: unknown): DexAd {
  if (!isRecord(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: ad must be an object");
  }
  return {
    url: asString(raw.url, "ad.url"),
    chainId: asString(raw.chainId, "ad.chainId"),
    tokenAddress: asString(raw.tokenAddress, "ad.tokenAddress"),
    date: asString(raw.date, "ad.date"),
    type: asString(raw.type, "ad.type"),
    durationHours: asOptionalNumber(raw.durationHours),
    impressions: asOptionalNumber(raw.impressions),
  };
}

export function validateAdsResponse(raw: unknown): DexAd[] {
  if (!Array.isArray(raw)) {
    throw new EchoError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected ads array");
  }
  return raw.map(parseAd);
}

export function validateWsAd(raw: unknown): DexAd {
  return parseAd(raw);
}
