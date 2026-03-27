/**
 * Runtime validators for Polymarket Data API responses.
 */

import { ErrorCodes } from "../../../errors.js";
import { isRecord, createFieldValidators } from "../../../utils/validation-helpers.js";
import type {
  DataPosition, DataClosedPosition, DataActivity, DataTrade,
  DataMetaHolder, DataOpenInterest, DataLiveVolume,
  DataLeaderboardEntry, DataBuilderEntry, DataBuilderVolumeEntry,
  DataMetaMarketPosition,
} from "./types.js";

const { asOptionalString, asOptionalNumber } = createFieldValidators(
  ErrorCodes.POLYMARKET_API_ERROR, "Polymarket Data",
);

function num(v: unknown, def = 0): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : def;
}

function str(v: unknown, def = ""): string {
  return typeof v === "string" ? v : def;
}

export function validatePositionsResponse(raw: unknown): DataPosition[] {
  if (!Array.isArray(raw)) throw new Error("Expected positions array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("position must be an object");
    return {
      proxyWallet: str(r.proxyWallet),
      asset: str(r.asset),
      conditionId: str(r.conditionId),
      size: num(r.size),
      avgPrice: num(r.avgPrice),
      initialValue: num(r.initialValue),
      currentValue: num(r.currentValue),
      cashPnl: num(r.cashPnl),
      percentPnl: num(r.percentPnl),
      totalBought: num(r.totalBought),
      realizedPnl: num(r.realizedPnl),
      curPrice: num(r.curPrice),
      redeemable: r.redeemable === true,
      mergeable: r.mergeable === true,
      title: asOptionalString(r.title) ?? null,
      slug: asOptionalString(r.slug) ?? null,
      eventSlug: asOptionalString(r.eventSlug) ?? null,
      outcome: asOptionalString(r.outcome) ?? null,
      outcomeIndex: typeof r.outcomeIndex === "number" ? r.outcomeIndex : 0,
      endDate: asOptionalString(r.endDate) ?? null,
      negativeRisk: r.negativeRisk === true,
    };
  });
}

export function validateClosedPositionsResponse(raw: unknown): DataClosedPosition[] {
  if (!Array.isArray(raw)) throw new Error("Expected closed positions array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("closed position must be an object");
    return {
      proxyWallet: str(r.proxyWallet),
      asset: str(r.asset),
      conditionId: str(r.conditionId),
      avgPrice: num(r.avgPrice),
      totalBought: num(r.totalBought),
      realizedPnl: num(r.realizedPnl),
      curPrice: num(r.curPrice),
      timestamp: typeof r.timestamp === "number" ? r.timestamp : 0,
      title: asOptionalString(r.title) ?? null,
      slug: asOptionalString(r.slug) ?? null,
      eventSlug: asOptionalString(r.eventSlug) ?? null,
      outcome: asOptionalString(r.outcome) ?? null,
      outcomeIndex: typeof r.outcomeIndex === "number" ? r.outcomeIndex : 0,
      endDate: asOptionalString(r.endDate) ?? null,
    };
  });
}

export function validateActivityResponse(raw: unknown): DataActivity[] {
  if (!Array.isArray(raw)) throw new Error("Expected activity array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("activity must be an object");
    return {
      proxyWallet: str(r.proxyWallet),
      timestamp: typeof r.timestamp === "number" ? r.timestamp : 0,
      conditionId: str(r.conditionId),
      type: str(r.type, "TRADE") as DataActivity["type"],
      size: num(r.size),
      usdcSize: num(r.usdcSize),
      price: num(r.price),
      asset: str(r.asset),
      side: r.side === "BUY" || r.side === "SELL" ? r.side : null,
      outcomeIndex: typeof r.outcomeIndex === "number" ? r.outcomeIndex : 0,
      title: asOptionalString(r.title) ?? null,
      slug: asOptionalString(r.slug) ?? null,
      outcome: asOptionalString(r.outcome) ?? null,
      transactionHash: asOptionalString(r.transactionHash) ?? null,
    };
  });
}

export function validateTradesResponse(raw: unknown): DataTrade[] {
  if (!Array.isArray(raw)) throw new Error("Expected trades array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("trade must be an object");
    return {
      proxyWallet: str(r.proxyWallet),
      side: r.side === "SELL" ? "SELL" : "BUY",
      asset: str(r.asset),
      conditionId: str(r.conditionId),
      size: num(r.size),
      price: num(r.price),
      timestamp: typeof r.timestamp === "number" ? r.timestamp : 0,
      title: asOptionalString(r.title) ?? null,
      slug: asOptionalString(r.slug) ?? null,
      outcome: asOptionalString(r.outcome) ?? null,
      outcomeIndex: typeof r.outcomeIndex === "number" ? r.outcomeIndex : 0,
      transactionHash: asOptionalString(r.transactionHash) ?? null,
      name: asOptionalString(r.name) ?? null,
      pseudonym: asOptionalString(r.pseudonym) ?? null,
      profileImage: asOptionalString(r.profileImage) ?? null,
    };
  });
}

export function validateHoldersResponse(raw: unknown): DataMetaHolder[] {
  if (!Array.isArray(raw)) throw new Error("Expected holders array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("meta holder must be an object");
    return {
      token: str(r.token),
      holders: Array.isArray(r.holders) ? r.holders.map((h: unknown) => {
        if (!isRecord(h)) return { proxyWallet: "", bio: null, asset: "", pseudonym: null, amount: 0, displayUsernamePublic: false, outcomeIndex: 0, name: null, profileImage: null };
        return {
          proxyWallet: str(h.proxyWallet),
          bio: asOptionalString(h.bio) ?? null,
          asset: str(h.asset),
          pseudonym: asOptionalString(h.pseudonym) ?? null,
          amount: num(h.amount),
          displayUsernamePublic: h.displayUsernamePublic === true,
          outcomeIndex: typeof h.outcomeIndex === "number" ? h.outcomeIndex : 0,
          name: asOptionalString(h.name) ?? null,
          profileImage: asOptionalString(h.profileImage) ?? null,
        };
      }) : [],
    };
  });
}

export function validateOpenInterestResponse(raw: unknown): DataOpenInterest[] {
  if (!Array.isArray(raw)) throw new Error("Expected OI array");
  return raw.map((r) => {
    if (!isRecord(r)) return { market: "", value: 0 };
    return { market: str(r.market), value: num(r.value) };
  });
}

export function validateLiveVolumeResponse(raw: unknown): DataLiveVolume {
  if (!Array.isArray(raw) || !isRecord(raw[0])) return { total: 0, markets: [] };
  const r = raw[0];
  return {
    total: num(r.total),
    markets: Array.isArray(r.markets) ? r.markets.map((m: unknown) => {
      if (!isRecord(m)) return { market: "", value: 0 };
      return { market: str(m.market), value: num(m.value) };
    }) : [],
  };
}

export function validateLeaderboardResponse(raw: unknown): DataLeaderboardEntry[] {
  if (!Array.isArray(raw)) throw new Error("Expected leaderboard array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("leaderboard entry must be an object");
    return {
      rank: str(r.rank),
      proxyWallet: str(r.proxyWallet),
      userName: asOptionalString(r.userName) ?? null,
      vol: num(r.vol),
      pnl: num(r.pnl),
      profileImage: asOptionalString(r.profileImage) ?? null,
      xUsername: asOptionalString(r.xUsername) ?? null,
      verifiedBadge: r.verifiedBadge === true,
    };
  });
}

export function validateBuilderLeaderboardResponse(raw: unknown): DataBuilderEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    if (!isRecord(r)) return { rank: "", builder: "", volume: 0, activeUsers: 0, verified: false, builderLogo: null };
    return {
      rank: str(r.rank),
      builder: str(r.builder),
      volume: num(r.volume),
      activeUsers: typeof r.activeUsers === "number" ? r.activeUsers : 0,
      verified: r.verified === true,
      builderLogo: asOptionalString(r.builderLogo) ?? null,
    };
  });
}

export function validateBuilderVolumeResponse(raw: unknown): DataBuilderVolumeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    if (!isRecord(r)) return { dt: "", builder: "", builderLogo: null, verified: false, volume: 0, activeUsers: 0, rank: "" };
    return {
      dt: str(r.dt),
      builder: str(r.builder),
      builderLogo: asOptionalString(r.builderLogo) ?? null,
      verified: r.verified === true,
      volume: num(r.volume),
      activeUsers: typeof r.activeUsers === "number" ? r.activeUsers : 0,
      rank: str(r.rank),
    };
  });
}

export function validateValueResponse(raw: unknown): { user: string; value: number } {
  if (Array.isArray(raw) && isRecord(raw[0])) {
    return { user: str(raw[0].user), value: num(raw[0].value) };
  }
  if (isRecord(raw)) return { user: str(raw.user), value: num(raw.value) };
  return { user: "", value: 0 };
}

export function validateTradedResponse(raw: unknown): { user: string; traded: number } {
  if (isRecord(raw)) return { user: str(raw.user), traded: typeof raw.traded === "number" ? raw.traded : 0 };
  return { user: "", traded: 0 };
}

export function validateMarketPositionsResponse(raw: unknown): DataMetaMarketPosition[] {
  if (!Array.isArray(raw)) throw new Error("Expected market positions array");
  return raw.map((r) => {
    if (!isRecord(r)) return { token: "", positions: [] };
    return {
      token: str(r.token),
      positions: Array.isArray(r.positions) ? r.positions.map((p: unknown) => {
        if (!isRecord(p)) return { proxyWallet: "", name: null, profileImage: null, verified: false, asset: "", conditionId: "", avgPrice: 0, size: 0, currPrice: 0, currentValue: 0, cashPnl: 0, totalBought: 0, realizedPnl: 0, totalPnl: 0, outcome: null, outcomeIndex: 0 };
        return {
          proxyWallet: str(p.proxyWallet), name: asOptionalString(p.name) ?? null,
          profileImage: asOptionalString(p.profileImage) ?? null, verified: p.verified === true,
          asset: str(p.asset), conditionId: str(p.conditionId),
          avgPrice: num(p.avgPrice), size: num(p.size), currPrice: num(p.currPrice),
          currentValue: num(p.currentValue), cashPnl: num(p.cashPnl),
          totalBought: num(p.totalBought), realizedPnl: num(p.realizedPnl),
          totalPnl: num(p.totalPnl), outcome: asOptionalString(p.outcome) ?? null,
          outcomeIndex: typeof p.outcomeIndex === "number" ? p.outcomeIndex : 0,
        };
      }) : [],
    };
  });
}
