/**
 * DexScreener protocol handlers — direct TS client calls.
 *
 * All handlers import from @tools/dexscreener/client.
 * All read-only — no wallet, no signing, no mutations.
 *
 * Market-data handlers (search/pairs/tokens/tokenPairs) return the unified
 * concise pair projection (see `projectors.ts`) — never the raw fat DexPair.
 * The metas / recent-updates handlers hit LIVE but UNDOCUMENTED endpoints and
 * degrade to a clear "feed unavailable" result on any error rather than
 * throwing through the namespace.
 */

import { getDexScreenerClient } from "@tools/dexscreener/client.js";
import type { DexBoost, DexPair, DexTokenProfile, DexTrendingItem } from "@tools/dexscreener/types.js";
import type { ProtocolHandler } from "../types.js";
import type { ToolResult } from "../../types.js";
import { str, num, ok, fail } from "../handler-helpers.js";
import { projectPairs } from "./projectors.js";

// ── Search tuning ────────────────────────────────────────────────

/** Default result cap for `dexscreener.search` when the caller omits `limit`. */
const SEARCH_DEFAULT_LIMIT = 20;
/** Hard ceiling for `dexscreener.search` (DexScreener search returns ≤30 pairs). */
const SEARCH_MAX_LIMIT = 30;

function clampSearchLimit(requested: number | undefined): number {
  if (requested !== undefined && requested > 0) {
    return Math.min(Math.floor(requested), SEARCH_MAX_LIMIT);
  }
  return SEARCH_DEFAULT_LIMIT;
}

// ── Undocumented-feed degradation ────────────────────────────────

const UNDOCUMENTED_FEED_UNAVAILABLE =
  "Feed unavailable — this is a live but undocumented DexScreener endpoint that may have changed.";

/** Clean, never-throw fallback for the live/undocumented metas + recent tools. */
function feedUnavailable(source: string): ToolResult {
  return ok({ available: false, source, reason: UNDOCUMENTED_FEED_UNAVAILABLE });
}

// ── Handler map ──────────────────────────────────────────────────

export const DEXSCREENER_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Core data ─────────────────────────────────────────────────

  "dexscreener.search": async (p) => {
    const query = str(p, "query");
    if (!query) return fail("Missing required: query");
    // Optional client-side filters — the search API has no server-side chain
    // or liquidity parameter, so we filter the returned pairs here.
    const chainId = str(p, "chainId");
    const minLiquidityUsd = num(p, "minLiquidityUsd");
    const requestedLimit = num(p, "limit");

    const client = getDexScreenerClient();
    const result = await client.search(query);

    let pairs = result.pairs;
    if (chainId) {
      const want = chainId.toLowerCase();
      pairs = pairs.filter((pr) => pr.chainId.toLowerCase() === want);
    }
    if (minLiquidityUsd !== undefined) {
      pairs = pairs.filter((pr) => (pr.liquidity?.usd ?? -Infinity) >= minLiquidityUsd);
    }

    // Deepest liquidity first, then cap for context economy.
    const sorted = [...pairs].sort(
      (a: DexPair, b: DexPair) => (b.liquidity?.usd ?? -Infinity) - (a.liquidity?.usd ?? -Infinity),
    );
    const limit = clampSearchLimit(requestedLimit);
    const projected = projectPairs(sorted).slice(0, limit);

    return ok({
      query,
      chainId: chainId || null,
      matched: sorted.length,
      pairCount: projected.length,
      pairs: projected,
    });
  },

  "dexscreener.pairs": async (p) => {
    const chainId = str(p, "chainId"), pairAddress = str(p, "pairAddress");
    if (!chainId || !pairAddress) return fail("Missing required: chainId, pairAddress");
    const client = getDexScreenerClient();
    const result = await client.getPairs(chainId, pairAddress);
    return ok({ chainId, pairAddress, pairs: projectPairs(result.pairs) });
  },

  "dexscreener.tokens": async (p) => {
    const chainId = str(p, "chainId"), tokenAddresses = str(p, "tokenAddresses");
    if (!chainId || !tokenAddresses) return fail("Missing required: chainId, tokenAddresses");
    const client = getDexScreenerClient();
    const result = await client.getTokens(chainId, tokenAddresses);
    return ok({ chainId, pairCount: result.length, pairs: projectPairs(result) });
  },

  "dexscreener.tokenPairs": async (p) => {
    const chainId = str(p, "chainId"), tokenAddress = str(p, "tokenAddress");
    if (!chainId || !tokenAddress) return fail("Missing required: chainId, tokenAddress");
    const limit = num(p, "limit");
    const client = getDexScreenerClient();
    const result = await client.getTokenPairs(chainId, tokenAddress);

    // Surface the deepest pools first: a token can have many pairs and the model
    // almost always wants the best-liquidity venue. `liquidity.usd` is
    // `number | null` — null-coalesce to -Infinity so missing-liquidity pairs
    // sink to the bottom. Sort a copy to avoid mutating the client response.
    const sorted = [...result].sort(
      (a: DexPair, b: DexPair) => (b.liquidity?.usd ?? -Infinity) - (a.liquidity?.usd ?? -Infinity),
    );

    // Apply `limit` ONLY when the caller provides it — no hardcoded default, so
    // an unqualified call still returns the full (sorted) pair set.
    const limited = limit && limit > 0 ? sorted.slice(0, limit) : sorted;

    return ok({ chainId, tokenAddress, pairCount: limited.length, pairs: projectPairs(limited) });
  },

  // ── Profiles & attention signals ──────────────────────────────

  "dexscreener.profiles": async () => {
    const client = getDexScreenerClient();
    const profiles = await client.getProfiles();
    return ok({ count: profiles.length, profiles });
  },

  "dexscreener.profiles.recent": async () => {
    // Live but undocumented — degrade cleanly instead of crashing the namespace.
    try {
      const client = getDexScreenerClient();
      const profiles = await client.getProfilesRecentUpdates();
      return ok({ available: true, count: profiles.length, profiles });
    } catch {
      return feedUnavailable("profiles.recent");
    }
  },

  "dexscreener.boosts": async () => {
    const client = getDexScreenerClient();
    const boosts = await client.getBoosts();
    return ok({ count: boosts.length, boosts });
  },

  "dexscreener.boosts.top": async () => {
    const client = getDexScreenerClient();
    const boosts = await client.getTopBoosts();
    return ok({ count: boosts.length, boosts });
  },

  "dexscreener.communityTakeovers": async () => {
    const client = getDexScreenerClient();
    const takeovers = await client.getCommunityTakeovers();
    return ok({ count: takeovers.length, takeovers });
  },

  "dexscreener.attention": async (p) => {
    // Synthetic attention signal: merge of token-profiles + boosts, ranked by
    // paid boost then profile presence. This is NOT the official trending feed
    // (that is `dexscreener.trending`) — it surfaces who is spending on
    // visibility. Default to 20 when the caller omits `limit`.
    const limit = num(p, "limit") ?? 20;
    const client = getDexScreenerClient();

    // Fetch profiles and boosts in parallel
    const [profiles, boosts] = await Promise.all([
      client.getProfiles(),
      client.getBoosts(),
    ]);

    // Merge by chainId:tokenAddress
    const map = new Map<string, DexTrendingItem>();

    for (const boost of boosts) {
      const key = `${boost.chainId}:${boost.tokenAddress}`;
      map.set(key, {
        chainId: boost.chainId,
        tokenAddress: boost.tokenAddress,
        url: boost.url,
        icon: boost.icon,
        header: boost.header,
        description: boost.description,
        links: boost.links,
        boostAmount: boost.amount,
        boostTotalAmount: boost.totalAmount,
        hasProfile: false,
      });
    }

    for (const profile of profiles) {
      const key = `${profile.chainId}:${profile.tokenAddress}`;
      const existing = map.get(key);
      if (existing) {
        existing.hasProfile = true;
        existing.icon = existing.icon ?? profile.icon;
        existing.description = existing.description ?? profile.description;
        existing.links = existing.links ?? profile.links;
      } else {
        map.set(key, {
          chainId: profile.chainId,
          tokenAddress: profile.tokenAddress,
          url: profile.url,
          icon: profile.icon,
          header: profile.header,
          description: profile.description,
          links: profile.links,
          boostAmount: 0,
          boostTotalAmount: 0,
          hasProfile: true,
        });
      }
    }

    // Sort: highest boost first, then profile presence
    let items = Array.from(map.values()).sort((a, b) => {
      if (b.boostTotalAmount !== a.boostTotalAmount) return b.boostTotalAmount - a.boostTotalAmount;
      if (a.hasProfile !== b.hasProfile) return a.hasProfile ? -1 : 1;
      return 0;
    });

    if (limit && limit > 0) {
      items = items.slice(0, limit);
    }

    return ok({ count: items.length, items });
  },

  // ── Metas / narratives (live, undocumented) ───────────────────

  "dexscreener.trending": async (p) => {
    // Official trending NARRATIVES/themes feed (live, undocumented endpoint).
    // Returns categories (ai, dog, "knockoff-legends"), NOT individual tokens.
    try {
      const limit = num(p, "limit");
      const client = getDexScreenerClient();
      const metas = await client.getMetasTrending();
      const limited = limit && limit > 0 ? metas.slice(0, limit) : metas;
      return ok({ available: true, count: limited.length, metas: limited });
    } catch {
      return feedUnavailable("metas.trending");
    }
  },

  "dexscreener.meta": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    // `slug` is a NARRATIVE slug from dexscreener.trending, not a chain slug.
    try {
      const client = getDexScreenerClient();
      const detail = await client.getMeta(slug);
      if (!detail) return feedUnavailable("metas.meta");
      return ok({
        available: true,
        slug: detail.slug,
        name: detail.name,
        description: detail.description,
        marketCap: detail.marketCap,
        liquidity: detail.liquidity,
        volume: detail.volume,
        tokenCount: detail.tokenCount,
        marketCapChange: detail.marketCapChange,
        pairCount: detail.pairs.length,
        pairs: projectPairs(detail.pairs),
      });
    } catch {
      return feedUnavailable("metas.meta");
    }
  },

  // ── Orders & ads ──────────────────────────────────────────────

  "dexscreener.orders": async (p) => {
    const chainId = str(p, "chainId"), tokenAddress = str(p, "tokenAddress");
    if (!chainId || !tokenAddress) return fail("Missing required: chainId, tokenAddress");
    const client = getDexScreenerClient();
    const orders = await client.getOrders(chainId, tokenAddress);
    return ok({ chainId, tokenAddress, count: orders.length, orders });
  },

  "dexscreener.ads": async () => {
    const client = getDexScreenerClient();
    const ads = await client.getAds();
    return ok({ count: ads.length, ads });
  },
};
