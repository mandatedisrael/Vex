/**
 * Retrieval metadata for Polymarket rewards tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/rewards.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../polymarket/discovery-text.js";

export const POLYMARKET_REWARDS_DISCOVERY = {
  // ── Public ───────────────────────────────────────────────────────

  "polymarket.rewards.active": {
    embeddingText: embeddingText(
      `List the currently active liquidity-rewards configurations on Polymarket — a prediction market on Polygon — with daily reward rate, min size, max spread, and competitiveness per market. ` +
      `Use this when the user wants to see which polymarket markets are paying lp / maker rewards right now, scan reward rates, screen for high-yield incentives, or filter sponsored vs standard reward programs. ` +
      `Example queries: which polymarket markets are paying rewards, list active lp rewards, scan polymarket maker rewards, sponsored rewards programs, current reward rate per day. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "lp rewards", "maker rewards",
      "polymarket incentives", "reward configs",
      "sponsored rewards", "reward rate per day",
      "min size", "max spread",
    ],
    exampleIntents: [
      "list active polymarket lp rewards",
      "scan polymarket maker reward rates",
      "current sponsored rewards programs",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.rewards.market": {
    embeddingText: embeddingText(
      `Get the raw liquidity-rewards configuration for one specific market on Polymarket — a prediction market on Polygon — by condition id, including reward rate per day, competitiveness, min size, max spread, and current token prices. ` +
      `Use this when the user wants to inspect rewards on a single polymarket market, check the reward rate for a specific condition id, decide if a market is worth providing liquidity on, or fold sponsored rates into the base config. ` +
      `Example queries: rewards for this polymarket market, reward config by condition id, is this market paying lp rewards, competitiveness for this market, sponsored rate for this condition. ` +
      `Read-only — scoped to one market.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "reward config", "market rewards",
      "competitiveness", "min spread",
      "reward rate per day", "condition id rewards",
      "sponsored rewards",
    ],
    exampleIntents: [
      "rewards for this polymarket condition id",
      "reward rate for this market",
      "competitiveness on this prediction market",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.rewards.multi": {
    canonicalSummary:
      "Search and rank reward-paying Polymarket prediction-market outcomes on Polygon by rate per day, competitiveness, spread, or volume.",
    embeddingText: embeddingText(
      `Search and rank reward-paying markets on Polymarket — a prediction market on Polygon — with filters on tag, event, 24h volume, spread, price, and rich sorting (rate_per_day, competitiveness, spread, volume_24hr, end_date). ` +
      `Use this when the user wants to find the best polymarket lp reward opportunities, screen markets by reward rate, sort by competitiveness, build an lp watchlist, or filter for tight-spread high-volume reward markets. ` +
      `Example queries: best polymarket lp rewards today, top polymarket markets by rate per day, screen polymarket maker rewards by spread, find competitive reward markets, polymarket lp watchlist sorted by volume. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "reward search", "lp rewards screener",
      "maker rewards screener", "rate per day",
      "competitiveness", "min spread", "max spread",
      "polymarket incentives", "reward markets",
    ],
    exampleIntents: [
      "best polymarket lp rewards today",
      "top polymarket markets by rate per day",
      "screen polymarket maker rewards",
      "find competitive reward markets on polymarket",
    ],
    preferredFor: ["lp rewards screener", "maker rewards screener", "rank reward markets"],
    chains: POLYMARKET_CHAINS,
  },

  // ── Authenticated ────────────────────────────────────────────────

  "polymarket.rewards.earnings": {
    canonicalSummary:
      "Get your Polymarket prediction-market liquidity-rewards earnings on Polygon broken down per market for one date.",
    embeddingText: embeddingText(
      `Get your liquidity-rewards earnings on Polymarket — a prediction market on Polygon — broken down per market for one specific date, optionally restricted to sponsored earnings. ` +
      `Use this when the user wants to see their per-market polymarket reward earnings on a given day, audit yesterday's lp payouts, see today's payout per market, check sponsored earnings, or pull earnings for tax / accounting on a specific date. ` +
      `Example queries: my polymarket lp rewards today, my reward earnings on 2026-04-04, polymarket maker rewards i earned yesterday, my sponsored reward earnings, today's payout per market. ` +
      `Authenticated — requires POLYMARKET_API_KEY; scoped to your wallet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "my reward earnings", "lp rewards earned",
      "maker rewards earned", "today's payout",
      "polymarket payout", "sponsored earnings",
      "rewards by date", "per market earnings",
    ],
    exampleIntents: [
      "my polymarket lp rewards today",
      "my reward earnings on 2026-04-04",
      "polymarket maker rewards i earned yesterday",
      "today's polymarket reward payout per market",
    ],
    preferredFor: ["my lp rewards", "my maker rewards", "daily reward earnings"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.rewards.totalEarnings": {
    canonicalSummary:
      "Get your total Polymarket prediction-market liquidity-rewards earnings on Polygon for one date, aggregated across all markets.",
    embeddingText: embeddingText(
      `Get your total liquidity-rewards earnings on Polymarket — a prediction market on Polygon — aggregated across every market you provided liquidity on, for one specific date, optionally combining native and sponsored payouts. ` +
      `Use this when the user wants the single total dollar payout for a day rather than a per-market breakdown — daily lp summary, total polymarket payout for yesterday, combined native + sponsored total, single-number day payout. ` +
      `Example queries: total polymarket rewards today, my total lp payout for 2026-04-04, combined sponsored and native earnings, polymarket reward total yesterday, single-number daily payout. ` +
      `Authenticated — requires POLYMARKET_API_KEY; scoped to your wallet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "total reward earnings", "total lp payout",
      "daily payout total", "aggregate earnings",
      "today's payout total", "combined earnings",
      "sponsored plus native",
    ],
    exampleIntents: [
      "total polymarket rewards today",
      "my total lp payout for 2026-04-04",
      "combined sponsored and native earnings on polymarket",
    ],
    preferredFor: ["total daily rewards", "aggregate lp payout", "combined daily earnings"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.rewards.percentages": {
    embeddingText: embeddingText(
      `Get your share of liquidity-rewards on Polymarket — a prediction market on Polygon — expressed as a percentage of the total reward pool per market you maker on. ` +
      `Use this when the user wants to know what fraction of a market's rewards they're capturing, see their reward share per market, check if their orders are competitive enough to earn meaningful payout, or compare share across markets. ` +
      `Example queries: my reward share on polymarket, what percent of rewards am i earning, my lp share per market, am i competitive on this market, reward percentage breakdown. ` +
      `Authenticated — requires POLYMARKET_API_KEY; scoped to your wallet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "my reward share", "reward percentage",
      "lp share per market", "competitiveness share",
      "reward pool share",
    ],
    exampleIntents: [
      "my reward share on polymarket",
      "what percent of rewards am i earning",
      "my lp share per market",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.rewards.userMarkets": {
    canonicalSummary:
      "Browse your Polymarket prediction-market liquidity-rewards dashboard on Polygon — earnings combined with market configs, searchable and sortable.",
    embeddingText: embeddingText(
      `Browse your full liquidity-rewards dashboard on Polymarket — a prediction market on Polygon — combining your per-market earnings with each market's reward config (rate per day, competitiveness, min size, max spread), with search, tag filter, sort by rate / competitiveness / volume, and pagination. ` +
      `Use this when the user wants the full polymarket lp dashboard, my reward markets sorted by rate, search my reward markets by question, see earnings alongside market configs, or paginate through every market they've maker'd on. ` +
      `Example queries: my polymarket reward dashboard, my lp markets sorted by rate per day, search my reward markets by question, my reward markets by competitiveness, full polymarket lp overview. ` +
      `Authenticated — requires POLYMARKET_API_KEY; scoped to your wallet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "reward dashboard", "my reward markets",
      "lp dashboard", "my lp markets",
      "earnings with config", "rate per day",
      "competitiveness", "search my rewards",
    ],
    exampleIntents: [
      "my polymarket reward dashboard",
      "my lp markets sorted by rate per day",
      "search my polymarket reward markets",
      "my reward markets by competitiveness",
    ],
    preferredFor: ["my reward dashboard", "my lp markets", "reward dashboard"],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 7;
if (Object.keys(POLYMARKET_REWARDS_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `POLYMARKET_REWARDS_DISCOVERY has ${Object.keys(POLYMARKET_REWARDS_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
