/**
 * Polymarket Rewards API handlers — market rewards, user earnings, percentages.
 * Public: active configs, per-market, multi-market search.
 * Authenticated: user earnings, totals, percentages, earnings+markets.
 */

import { getPolyClobClient } from "@tools/polymarket/clob/client.js";
import type { ProtocolHandler } from "../types.js";
import { str, num, ok, fail } from "../handler-helpers.js";

export const REWARDS_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Public ───────────────────────────────────────────────────────

  "polymarket.rewards.active": async (p) => {
    return ok(await getPolyClobClient().getActiveRewards({
      sponsored: p.sponsored === true ? true : undefined,
      next_cursor: str(p, "cursor") || undefined,
    }));
  },

  "polymarket.rewards.market": async (p) => {
    const conditionId = str(p, "conditionId");
    if (!conditionId) return fail("Missing required: conditionId");
    return ok(await getPolyClobClient().getMarketRewards(conditionId, {
      sponsored: p.sponsored === true ? true : undefined,
      next_cursor: str(p, "cursor") || undefined,
    }));
  },

  "polymarket.rewards.multi": async (p) => {
    return ok(await getPolyClobClient().getMultiMarketRewards({
      q: str(p, "query") || undefined,
      tag_slug: str(p, "tagSlug") || undefined,
      event_id: str(p, "eventId") || undefined,
      event_title: str(p, "eventTitle") || undefined,
      order_by: str(p, "orderBy") || undefined,
      position: str(p, "position") || undefined,
      min_volume_24hr: str(p, "minVolume24hr") || undefined,
      max_volume_24hr: str(p, "maxVolume24hr") || undefined,
      min_spread: str(p, "minSpread") || undefined,
      max_spread: str(p, "maxSpread") || undefined,
      min_price: str(p, "minPrice") || undefined,
      max_price: str(p, "maxPrice") || undefined,
      next_cursor: str(p, "cursor") || undefined,
      page_size: num(p, "pageSize") != null ? String(num(p, "pageSize")) : undefined,
    }));
  },

  // ── Authenticated ────────────────────────────────────────────────

  "polymarket.rewards.earnings": async (p) => {
    const date = str(p, "date");
    if (!date) return fail("Missing required: date (YYYY-MM-DD)");
    return ok(await getPolyClobClient().getUserEarnings({
      date,
      signature_type: num(p, "signatureType") != null ? String(num(p, "signatureType")) : undefined,
      maker_address: str(p, "makerAddress") || undefined,
      sponsored: p.sponsored === true ? "true" : undefined,
      next_cursor: str(p, "cursor") || undefined,
    }));
  },

  "polymarket.rewards.totalEarnings": async (p) => {
    const date = str(p, "date");
    if (!date) return fail("Missing required: date (YYYY-MM-DD)");
    return ok(await getPolyClobClient().getUserTotalEarnings({
      date,
      signature_type: num(p, "signatureType") != null ? String(num(p, "signatureType")) : undefined,
      maker_address: str(p, "makerAddress") || undefined,
      sponsored: p.sponsored === true ? "true" : undefined,
    }));
  },

  "polymarket.rewards.percentages": async (p) => {
    return ok(await getPolyClobClient().getUserRewardPercentages({
      signature_type: num(p, "signatureType") != null ? String(num(p, "signatureType")) : undefined,
      maker_address: str(p, "makerAddress") || undefined,
    }));
  },

  "polymarket.rewards.userMarkets": async (p) => {
    return ok(await getPolyClobClient().getUserEarningsMarkets({
      date: str(p, "date") || undefined,
      signature_type: num(p, "signatureType") != null ? String(num(p, "signatureType")) : undefined,
      maker_address: str(p, "makerAddress") || undefined,
      sponsored: p.sponsored === true ? "true" : undefined,
      next_cursor: str(p, "cursor") || undefined,
      page_size: num(p, "pageSize") != null ? String(num(p, "pageSize")) : undefined,
      q: str(p, "query") || undefined,
      tag_slug: str(p, "tagSlug") || undefined,
      order_by: str(p, "orderBy") || undefined,
      position: str(p, "position") || undefined,
    }));
  },
};
