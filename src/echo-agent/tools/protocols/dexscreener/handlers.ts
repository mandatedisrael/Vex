/**
 * DexScreener protocol handlers — direct TS client calls.
 *
 * All handlers import from @tools/dexscreener/client.
 * All read-only — no wallet, no signing, no mutations.
 */

import { getDexScreenerClient } from "@tools/dexscreener/client.js";
import type { DexBoost, DexTokenProfile, DexTrendingItem } from "@tools/dexscreener/types.js";
import type { ToolResult } from "../../types.js";
import type { ProtocolHandler } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────

function str(p: Record<string, unknown>, k: string): string {
  const v = p[k]; return typeof v === "string" ? v : "";
}
function num(p: Record<string, unknown>, k: string): number | undefined {
  const v = p[k]; return typeof v === "number" ? v : undefined;
}
function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}
function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}

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
    const client = getDexScreenerClient();
    const result = await client.getTokenPairs(chainId, tokenAddress);
    return ok({ chainId, tokenAddress, pairCount: result.length, pairs: result });
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
    const limit = num(p, "limit");
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
