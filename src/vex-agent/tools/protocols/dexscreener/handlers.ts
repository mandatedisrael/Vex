/**
 * DexScreener protocol handlers — direct TS client calls.
 *
 * All handlers import from @tools/dexscreener/client.
 * All read-only — no wallet, no signing, no mutations.
 */

import { getDexScreenerClient } from "@tools/dexscreener/client.js";
import type { DexBoost, DexPair, DexTokenProfile, DexTrendingItem } from "@tools/dexscreener/types.js";
import type { ProtocolHandler } from "../types.js";
import { str, num, ok, fail } from "../handler-helpers.js";
import { projectPairs } from "./projectors.js";

// ── Handler map ──────────────────────────────────────────────────

export const DEXSCREENER_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Core data ─────────────────────────────────────────────────

  "dexscreener.search": async (p) => {
    const query = str(p, "query");
    if (!query) return fail("Missing required: query");
    const client = getDexScreenerClient();
    const result = await client.search(query);
    return ok({ query, pairCount: result.pairs.length, pairs: result.pairs });
  },

  "dexscreener.pairs": async (p) => {
    const chainId = str(p, "chainId"), pairAddress = str(p, "pairAddress");
    if (!chainId || !pairAddress) return fail("Missing required: chainId, pairAddress");
    const client = getDexScreenerClient();
    const result = await client.getPairs(chainId, pairAddress);
    return ok({ chainId, pairAddress, pairs: result.pairs });
  },

  "dexscreener.tokens": async (p) => {
    const chainId = str(p, "chainId"), tokenAddresses = str(p, "tokenAddresses");
    if (!chainId || !tokenAddresses) return fail("Missing required: chainId, tokenAddresses");
    const client = getDexScreenerClient();
    const result = await client.getTokens(chainId, tokenAddresses);
    return ok({ chainId, pairCount: result.length, pairs: result });
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

  // ── Trending & signals ────────────────────────────────────────

  "dexscreener.profiles": async () => {
    const client = getDexScreenerClient();
    const profiles = await client.getProfiles();
    return ok({ count: profiles.length, profiles });
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

  "dexscreener.trending": async (p) => {
    // Default to 20 when the caller omits `limit` — the merged feed is unbounded
    // and a bare "show me trending" call should return a manageable ranked set.
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
