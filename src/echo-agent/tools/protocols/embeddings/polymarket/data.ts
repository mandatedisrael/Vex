/**
 * Retrieval metadata for Polymarket data tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/data.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../polymarket/discovery-text.js";

export const POLYMARKET_DATA_DISCOVERY = {
  // ── User Data ─────────────────────────────────────────────────

  "polymarket.data.positions": {
    canonicalSummary:
      "List a wallet's open Polymarket prediction market positions on Polygon with size, average price, unrealized PnL, and redeemable / mergeable status.",
    embeddingText: embeddingText(
      `List a wallet's open positions on Polymarket — a prediction market on Polygon — including position size, average entry price, current price, unrealized PnL, and redeemable / mergeable status per outcome token. ` +
      `Use this when the user wants to see their open bets, current polymarket portfolio, unrealized pnl, what positions are still live, what's redeemable after resolution, or which YES/NO shares they can merge back to pUSD. ` +
      `Example queries: show my open polymarket positions, my open bets, polymarket portfolio, unrealized pnl on polymarket, what can I redeem, my live prediction positions, list my YES shares. ` +
      `Read-only — does not place or close positions.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "open positions", "open bets",
      "my positions", "polymarket portfolio",
      "unrealized pnl", "redeemable", "mergeable",
      "yes share", "no share", "outcome shares",
      "pUSD", "USDC.e",
    ],
    exampleIntents: [
      "show my open polymarket positions",
      "my open bets on polymarket",
      "unrealized pnl on polymarket",
      "what can I redeem on polymarket",
    ],
    preferredFor: ["open positions", "my positions", "unrealized pnl"],
    avoidFor: ["orderbook", "clob"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.data.closedPositions": {
    canonicalSummary:
      "List a wallet's closed Polymarket prediction market positions on Polygon with realized PnL per settled market.",
    embeddingText: embeddingText(
      `List a wallet's closed positions on Polymarket — a prediction market on Polygon — including realized PnL, average entry price, settle price, and the title of each settled market. ` +
      `Use this when the user wants their settled bets, polymarket trade history, realized pnl, prediction win/loss record, my prediction history, or a tax-export style listing of past markets. ` +
      `Example queries: my realized pnl on polymarket, settled bets, closed prediction positions, my polymarket history, past polymarket trades, prediction market win loss. ` +
      `Read-only — open positions live on polymarket.data.positions instead.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "closed positions", "settled bets",
      "realized pnl", "prediction history",
      "my prediction history", "polymarket history",
      "settled markets", "win loss",
      "pUSD", "USDC.e",
    ],
    exampleIntents: [
      "my realized pnl on polymarket",
      "settled bets on polymarket",
      "closed polymarket positions",
      "my polymarket trade history",
    ],
    preferredFor: ["closed positions", "realized pnl", "settled markets"],
    avoidFor: ["orderbook"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.data.activity": {
    embeddingText: embeddingText(
      `Get a wallet's full activity stream on Polymarket — a prediction market on Polygon — covering trades, splits, merges, redeems, rewards, conversions, maker rebates, and referral rewards with timestamps and amounts. ` +
      `Use this when the user wants a complete polymarket activity log, every event on their account, tx-shaped history, redemption and merge records, or a feed they can filter by type or time range. ` +
      `Example queries: my polymarket activity, full account history on polymarket, every redeem and merge, polymarket account log, show my maker rebates, prediction market activity stream. ` +
      `Read-only — broader than data.trades and includes non-trade events.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "activity", "account history",
      "polymarket activity log", "redeem history",
      "merge history", "maker rebate",
      "referral reward",
    ],
    exampleIntents: [
      "my polymarket activity",
      "full polymarket account history",
      "show my redeems and merges on polymarket",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.data.trades": {
    embeddingText: embeddingText(
      `List individual fills on Polymarket — a prediction market on Polygon — with tx hash, price, size, side and timestamp, filterable by user, market, or event. ` +
      `Use this when the user wants raw trade-level data, tx hashes for prediction trades, fills on a specific polymarket market, recent buys and sells on an event, or a tape they can scrub through. ` +
      `Example queries: recent polymarket trades, fills on this prediction market, tx hashes for my polymarket trades, taker trades on this event, scrub the tape for this market. ` +
      `Read-only — narrower than data.activity and limited to trade events.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "trades", "fills",
      "trade history", "tx hashes",
      "tape", "taker trades",
    ],
    exampleIntents: [
      "recent polymarket trades",
      "fills on this prediction market",
      "tx hashes for my polymarket trades",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.data.value": {
    embeddingText: embeddingText(
      `Get the total USD value of a wallet's positions on Polymarket — a prediction market on Polygon — across all open outcome tokens, optionally scoped to one market. ` +
      `Use this when the user wants their polymarket account value, current portfolio worth, total exposure on prediction markets, or how much their open bets are worth right now. ` +
      `Example queries: how much is my polymarket account worth, polymarket portfolio value, total exposure on prediction markets, what's my polymarket balance worth. ` +
      `Read-only — for per-position breakdown use data.positions.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "portfolio value", "account value",
      "total exposure", "polymarket worth",
      "tvl on prediction market",
    ],
    exampleIntents: [
      "how much is my polymarket account worth",
      "polymarket portfolio value",
      "total exposure on prediction markets",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.data.traded": {
    embeddingText: embeddingText(
      `Count how many distinct markets a wallet has ever traded on Polymarket — a prediction market on Polygon — as a single number across the wallet's full history. ` +
      `Use this when the user wants their polymarket experience metric, number of markets traded, lifetime market count, or a quick "how active am I" stat for their account. ` +
      `Example queries: how many polymarket markets have I traded, my polymarket market count, lifetime markets traded, how active is this trader on polymarket. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "markets traded", "market count",
      "lifetime markets",
    ],
    exampleIntents: [
      "how many polymarket markets have I traded",
      "lifetime markets traded on polymarket",
      "polymarket market count",
    ],
    chains: POLYMARKET_CHAINS,
  },

  // ── Market Data ───────────────────────────────────────────────

  "polymarket.data.holders": {
    embeddingText: embeddingText(
      `List the top YES and NO holders for a Polymarket prediction market on Polygon — wallet addresses, balances, pseudonyms, and profile images per outcome token. ` +
      `Use this when the user wants to see polymarket whales on a market, who's holding the YES side, biggest no holders, smart-money concentration, or top wallets in this prediction. ` +
      `Example queries: top holders on this polymarket market, polymarket whales, who's biggest on yes, smart money on this prediction, biggest no holders. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "top holders", "polymarket whales",
      "yes holders", "no holders",
      "smart money",
    ],
    exampleIntents: [
      "top holders on this polymarket market",
      "polymarket whales on this prediction",
      "biggest yes holders",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.data.openInterest": {
    embeddingText: embeddingText(
      `Get open interest — total value locked across YES and NO sides — for one Polymarket prediction market on Polygon, or for every market when no condition ID is supplied. ` +
      `Use this when the user wants oi on a polymarket market, tvl on a prediction, total stake on this event, or a global view of where capital sits across polymarket. ` +
      `Example queries: open interest on this polymarket market, tvl on prediction market, polymarket oi, global polymarket open interest, total stake on this prediction. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "open interest", "oi",
      "tvl on prediction market", "total value locked",
    ],
    exampleIntents: [
      "open interest on this polymarket market",
      "tvl on prediction market",
      "polymarket oi",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.data.liveVolume": {
    embeddingText: embeddingText(
      `Get live trading volume for a Polymarket prediction market event on Polygon — total event volume plus a per-market breakdown across all sub-markets in the event. ` +
      `Use this when the user wants live polymarket volume on an event, volume per sub-market, how much is being traded right now, or a hotness check on a prediction event. ` +
      `Example queries: live volume on this polymarket event, how much is being traded on this prediction, polymarket event volume, hottest sub-market in this event. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "live volume", "event volume",
      "polymarket volume", "trading volume",
    ],
    exampleIntents: [
      "live volume on this polymarket event",
      "how much is being traded on this prediction",
      "polymarket event volume",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.data.marketPositions": {
    embeddingText: embeddingText(
      `List every wallet's position in a single Polymarket prediction market on Polygon — per-user size, average price, current price, and PnL across that market's outcome tokens. ` +
      `Use this when the user wants the full participant list on a polymarket market, every position on a prediction, who's in this market, or a market-wide leaderboard scoped to one event. ` +
      `Example queries: all positions in this polymarket market, who's holding this prediction, market participant list, every wallet on this polymarket market. ` +
      `Read-only — for one wallet's positions across all markets use data.positions instead.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "market positions", "all positions",
      "participant list", "market wallets",
    ],
    exampleIntents: [
      "all positions in this polymarket market",
      "who's holding this prediction",
      "every wallet on this polymarket market",
    ],
    chains: POLYMARKET_CHAINS,
  },

  // ── Leaderboard ───────────────────────────────────────────────

  "polymarket.data.leaderboard": {
    canonicalSummary:
      "Rank top traders on a Polymarket prediction-market outcome on Polygon by PnL or volume across day, week, month, or all-time, filtered by category.",
    embeddingText: embeddingText(
      `Rank top traders on Polymarket — a prediction market on Polygon — by PnL or volume over day / week / month / all-time, scoped to a category like POLITICS, SPORTS, CRYPTO, CULTURE, MENTIONS, WEATHER, ECONOMICS, TECH, or FINANCE. ` +
      `Use this when the user wants the polymarket leaderboard, top traders this week, biggest pnl on prediction markets, top crypto polymarket traders, polymarket whales by volume, or where a specific user ranks. ` +
      `Example queries: polymarket leaderboard this week, top polymarket traders, biggest pnl on prediction markets, top sports prediction traders, who's #1 on polymarket. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "leaderboard", "top traders",
      "polymarket leaderboard", "top pnl",
      "polymarket whales", "biggest traders",
    ],
    exampleIntents: [
      "polymarket leaderboard this week",
      "top polymarket traders",
      "biggest pnl on prediction markets",
      "who's #1 on polymarket",
    ],
    preferredFor: ["polymarket leaderboard", "top traders", "biggest pnl"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.data.builderLeaderboard": {
    embeddingText: embeddingText(
      `Rank builders — API integrators routing flow into Polymarket — a prediction market on Polygon — by total volume and active users over day, week, month, or all-time. ` +
      `Use this when the user wants the polymarket builder leaderboard, top API integrators, biggest third-party clients, builder volume rankings, or which apps are sending the most prediction-market flow. ` +
      `Example queries: polymarket builder leaderboard, top api integrators, which apps drive the most polymarket volume, builder rankings this month. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "builder leaderboard", "api integrator",
      "third party clients", "builder volume",
    ],
    exampleIntents: [
      "polymarket builder leaderboard",
      "top api integrators on polymarket",
      "biggest third party clients on prediction markets",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.data.builderVolume": {
    embeddingText: embeddingText(
      `Get a daily time-series of builder volume and active users on Polymarket — a prediction market on Polygon — over day, week, month, or all-time, broken down per integrator. ` +
      `Use this when the user wants polymarket builder volume over time, daily integrator activity, builder growth charts, prediction market api volume time-series, or trend lines per third-party client. ` +
      `Example queries: polymarket builder volume time series, daily api integrator activity, polymarket builder trends, builder growth over time. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "builder volume", "integrator volume",
      "builder time series", "daily builder activity",
    ],
    exampleIntents: [
      "polymarket builder volume over time",
      "daily api integrator activity",
      "polymarket builder trends",
    ],
    chains: POLYMARKET_CHAINS,
  },

  // ── Accounting ────────────────────────────────────────────────

  "polymarket.data.accountingSnapshot": {
    embeddingText: embeddingText(
      `Get a downloadable URL for a wallet's full accounting snapshot — every trade, split, merge, redeem, reward, and conversion — on Polymarket — a prediction market on Polygon — as a CSV ready for spreadsheet or tax tooling. ` +
      `Use this when the user wants a polymarket csv export, tax export of prediction-market activity, full accounting dump, downloadable history, or a cost-basis-ready ledger from polymarket. ` +
      `Example queries: polymarket csv, tax export from polymarket, download my full polymarket history, accounting snapshot for my prediction market activity, cost basis ledger from polymarket. ` +
      `Read-only — returns the URL only; the user downloads the CSV themselves.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket csv", "tax export",
      "accounting snapshot", "csv export",
      "cost basis", "downloadable history",
    ],
    exampleIntents: [
      "polymarket csv export",
      "tax export from polymarket",
      "download my full polymarket history",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 14;
if (Object.keys(POLYMARKET_DATA_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `POLYMARKET_DATA_DISCOVERY has ${Object.keys(POLYMARKET_DATA_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
