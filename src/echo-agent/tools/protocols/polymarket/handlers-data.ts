/**
 * Polymarket Data API handlers — positions, activity, leaderboard, trades.
 * All public, no auth. 14 methods on PolyDataClient fully covered.
 */

import { getPolyDataClient } from "@tools/polymarket/data/client.js";
import type { ProtocolHandler } from "../types.js";
import { str, num, bool, ok, fail } from "../handler-helpers.js";


export const DATA_HANDLERS: Record<string, ProtocolHandler> = {
  // ── User Data ─────────────────────────────────────────────────

  "polymarket.data.positions": async (p) => {
    const user = str(p, "user");
    if (!user) return fail("Missing required: user");
    const positions = await getPolyDataClient().getPositions({
      user,
      market: str(p, "market") || undefined,
      eventId: num(p, "eventId"),
      sizeThreshold: num(p, "sizeThreshold"),
      redeemable: bool(p, "redeemable"),
      mergeable: bool(p, "mergeable"),
      limit: num(p, "limit"),
      offset: num(p, "offset"),
      sortBy: (str(p, "sortBy") || undefined) as any,
      sortDirection: (str(p, "sortDirection") || undefined) as any,
      title: str(p, "title") || undefined,
    });
    return ok({ count: positions.length, positions });
  },

  "polymarket.data.closedPositions": async (p) => {
    const user = str(p, "user");
    if (!user) return fail("Missing required: user");
    const positions = await getPolyDataClient().getClosedPositions({
      user,
      market: str(p, "market") || undefined,
      eventId: num(p, "eventId"),
      title: str(p, "title") || undefined,
      limit: num(p, "limit"),
      offset: num(p, "offset"),
      sortBy: (str(p, "sortBy") || undefined) as any,
      sortDirection: (str(p, "sortDirection") || undefined) as any,
    });
    return ok({ count: positions.length, positions });
  },

  "polymarket.data.activity": async (p) => {
    const user = str(p, "user");
    if (!user) return fail("Missing required: user");
    const activity = await getPolyDataClient().getActivity({
      user,
      market: str(p, "market") || undefined,
      eventId: num(p, "eventId"),
      type: str(p, "type") || undefined,
      side: str(p, "side") || undefined,
      start: num(p, "start"),
      end: num(p, "end"),
      limit: num(p, "limit"),
      offset: num(p, "offset"),
      sortBy: (str(p, "sortBy") || undefined) as any,
      sortDirection: (str(p, "sortDirection") || undefined) as any,
    });
    return ok({ count: activity.length, activity });
  },

  "polymarket.data.trades": async (p) => {
    const trades = await getPolyDataClient().getTrades({
      user: str(p, "user") || undefined,
      market: str(p, "market") || undefined,
      eventId: num(p, "eventId"),
      side: str(p, "side") || undefined,
      takerOnly: bool(p, "takerOnly"),
      filterType: (str(p, "filterType") || undefined) as any,
      filterAmount: num(p, "filterAmount"),
      limit: num(p, "limit"),
      offset: num(p, "offset"),
    });
    return ok({ count: trades.length, trades });
  },

  "polymarket.data.value": async (p) => {
    const user = str(p, "user");
    if (!user) return fail("Missing required: user");
    return ok(await getPolyDataClient().getValue(user, {
      market: str(p, "market") || undefined,
    }));
  },

  "polymarket.data.traded": async (p) => {
    const user = str(p, "user");
    if (!user) return fail("Missing required: user");
    return ok(await getPolyDataClient().getTraded(user));
  },

  // ── Market Data ───────────────────────────────────────────────

  "polymarket.data.holders": async (p) => {
    const market = str(p, "market");
    if (!market) return fail("Missing required: market");
    const holders = await getPolyDataClient().getHolders(market, {
      limit: num(p, "limit"),
      minBalance: num(p, "minBalance"),
    });
    return ok({ count: holders.length, holders });
  },

  "polymarket.data.openInterest": async (p) => {
    const market = str(p, "market") || undefined;
    const oi = await getPolyDataClient().getOpenInterest(market);
    return ok({ count: oi.length, openInterest: oi });
  },

  "polymarket.data.liveVolume": async (p) => {
    const eventId = num(p, "eventId");
    if (eventId == null) return fail("Missing required: eventId");
    return ok(await getPolyDataClient().getLiveVolume(eventId));
  },

  "polymarket.data.marketPositions": async (p) => {
    const market = str(p, "market");
    if (!market) return fail("Missing required: market");
    const positions = await getPolyDataClient().getMarketPositions(market, {
      user: str(p, "user") || undefined,
      status: str(p, "status") || undefined,
      sortBy: str(p, "sortBy") || undefined,
      sortDirection: str(p, "sortDirection") || undefined,
      limit: num(p, "limit"),
      offset: num(p, "offset"),
    });
    return ok({ count: positions.length, positions });
  },

  // ── Leaderboard ───────────────────────────────────────────────

  "polymarket.data.leaderboard": async (p) => {
    const entries = await getPolyDataClient().getLeaderboard({
      category: str(p, "category") || undefined,
      timePeriod: str(p, "timePeriod") || undefined,
      orderBy: str(p, "orderBy") || undefined,
      limit: num(p, "limit"),
      offset: num(p, "offset"),
      user: str(p, "user") || undefined,
      userName: str(p, "userName") || undefined,
    });
    return ok({ count: entries.length, leaderboard: entries });
  },

  "polymarket.data.builderLeaderboard": async (p) => {
    const entries = await getPolyDataClient().getBuilderLeaderboard({
      timePeriod: str(p, "timePeriod") || undefined,
      limit: num(p, "limit"),
      offset: num(p, "offset"),
    });
    return ok({ count: entries.length, builders: entries });
  },

  "polymarket.data.builderVolume": async (p) => {
    const entries = await getPolyDataClient().getBuilderVolume({
      timePeriod: str(p, "timePeriod") || undefined,
    });
    return ok({ count: entries.length, volume: entries });
  },

  // ── Accounting ────────────────────────────────────────────────

  "polymarket.data.accountingSnapshot": async (p) => {
    const user = str(p, "user");
    if (!user) return fail("Missing required: user");
    const url = await getPolyDataClient().getAccountingSnapshotUrl(user);
    return ok({ user, downloadUrl: url });
  },
};
