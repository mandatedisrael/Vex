/**
 * Retrieval metadata for Polymarket CLOB tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/clob.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../polymarket/discovery-text.js";

export const POLYMARKET_CLOB_DISCOVERY = {
  // ── Market Data (public) ──────────────────────────────────────

  "polymarket.clob.orderbook": {
    canonicalSummary:
      "Full Polymarket prediction market orderbook on Polygon — bids, asks, tick size, last trade price.",
    embeddingText: embeddingText(
      `Get the full CLOB orderbook for one outcome token on Polymarket — a prediction market on Polygon — including the bid stack, ask stack, tick size, last trade price, and neg risk flag. ` +
      `Use this when the user wants to inspect market depth, see the full bid/ask ladder before placing a limit order, gauge how thin or fat the book is, or look up the price of one yes share or one no share. ` +
      `Example queries: orderbook for this polymarket outcome, show me the bids and asks, market depth on this prediction market, full clob book, tick size and last trade. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "orderbook", "clob book", "bids asks",
      "market depth", "yes share", "no share",
      "outcome token", "tick size", "neg risk",
    ],
    exampleIntents: [
      "orderbook for this polymarket outcome",
      "show bids and asks on this prediction market",
      "polymarket market depth",
      "full clob book for this token",
    ],
    preferredFor: ["orderbook", "bids asks", "clob book", "market depth"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.orderbooks": {
    canonicalSummary:
      "Batch full orderbooks for multiple Polymarket prediction-market outcomes on Polygon — one CLOB call across many tokens.",
    embeddingText: embeddingText(
      `Get full CLOB orderbooks for multiple outcome tokens on Polymarket prediction markets on Polygon in one batched call. ` +
      `Use this when the user is screening many markets at once, scanning a watchlist, or comparing depth across outcomes for arbitrage or LP planning. ` +
      `Example queries: orderbooks for these polymarket tokens, batch market depth check, scan many prediction markets at once, compare bids and asks across outcomes. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "orderbooks", "batch orderbooks", "batch market depth"],
    exampleIntents: [
      "orderbooks for these polymarket tokens",
      "batch market depth check across outcomes",
      "scan orderbooks across many prediction markets",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.price": {
    embeddingText: embeddingText(
      `Get the best available BUY or SELL price for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants the current best bid or best ask for a yes share or no share, a quick price check before placing a limit order, or a single-number snapshot of an outcome. ` +
      `Example queries: best bid on this polymarket outcome, best ask for yes shares, current price on this prediction market, what's the buy price right now. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "best bid", "best ask", "best bid best ask",
      "yes share", "no share", "outcome token",
    ],
    exampleIntents: [
      "best bid on this polymarket outcome",
      "best ask for this prediction market",
      "current price for yes shares",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.prices": {
    canonicalSummary:
      "Batch best BUY/SELL prices for multiple Polymarket prediction-market outcomes on Polygon — one CLOB call across many tokens.",
    embeddingText: embeddingText(
      `Get best BUY or SELL prices for multiple outcome tokens on Polymarket prediction markets on Polygon in one batched call. ` +
      `Use this when the user is screening many outcomes at once, scanning a watchlist for entries, or comparing best bids and asks across markets for arbitrage or LP planning. ` +
      `Example queries: prices across these polymarket outcomes, batch price check, scan many prediction markets, compare best bids for these tokens. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "prices", "batch prices", "batch best bid ask"],
    exampleIntents: [
      "prices across these polymarket tokens",
      "batch price check on prediction markets",
      "scan best bids and asks across outcomes",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.midpoint": {
    embeddingText: embeddingText(
      `Get the midpoint price (average of best bid and best ask) for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants a single fair-value estimate for a yes share or no share, a midpoint reference for limit-order placement, or a quick mark price for a position. ` +
      `Example queries: midpoint for this polymarket outcome, mid price on this prediction market, fair value for yes shares, mark price right now. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "midpoint", "mid price", "fair value", "mark price",
    ],
    exampleIntents: [
      "midpoint for this polymarket outcome",
      "mid price on this prediction market",
      "fair value for yes shares",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.midpoints": {
    canonicalSummary:
      "Batch midpoint prices for multiple Polymarket prediction-market outcomes on Polygon — one CLOB call across many tokens.",
    embeddingText: embeddingText(
      `Get midpoint prices for multiple outcome tokens on Polymarket prediction markets on Polygon in one batched call. ` +
      `Use this when the user is screening many markets at once, scanning a watchlist for fair-value moves, or comparing mid prices across outcomes for arbitrage or LP planning. ` +
      `Example queries: midpoints across these polymarket outcomes, batch mid price check, scan fair values on many prediction markets, compare mid prices. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "midpoints", "batch midpoints", "batch mid price"],
    exampleIntents: [
      "midpoints across these polymarket tokens",
      "batch mid price check on prediction markets",
      "scan fair values across outcomes",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.spread": {
    embeddingText: embeddingText(
      `Get the bid-ask spread for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants to check execution cost on a yes share or no share, compare liquidity across outcomes, or screen a market before placing a limit order. ` +
      `Example queries: spread on this polymarket outcome, bid ask spread for this prediction market, how tight is this market, execution cost check, liquidity screen. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "bid ask spread", "clob spread", "execution cost", "liquidity",
    ],
    exampleIntents: [
      "spread for this polymarket outcome",
      "bid ask on this prediction market",
      "how tight is this market",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.spreads": {
    canonicalSummary:
      "Batch bid-ask spreads for multiple Polymarket prediction-market outcomes on Polygon — one CLOB call across many tokens.",
    embeddingText: embeddingText(
      `Get bid-ask spreads for multiple outcome tokens on Polymarket prediction markets on Polygon in one batched call. ` +
      `Use this when the user is screening many markets at once, scanning a watchlist, or comparing spreads across outcomes for arbitrage or LP planning. ` +
      `Example queries: spreads across these polymarket outcomes, batch spread check, scan many prediction markets, compare spreads for these tokens. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "spreads", "batch spreads", "batch bid ask spread"],
    exampleIntents: [
      "spreads for these polymarket tokens",
      "batch spread check on prediction markets",
      "compare bid ask spreads across outcomes",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.lastTrade": {
    embeddingText: embeddingText(
      `Get the last trade price and side (BUY or SELL) for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants the most recent print on a yes share or no share, a quick reference for the last filled price, or to confirm where the market just traded. ` +
      `Example queries: last trade on this polymarket outcome, most recent print, last fill price for yes shares, where did this prediction market just trade. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "last trade", "last print", "last fill", "recent trade",
    ],
    exampleIntents: [
      "last trade on this polymarket outcome",
      "most recent print on this prediction market",
      "last fill price for yes shares",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.lastTrades": {
    canonicalSummary:
      "Batch last trade prints for multiple Polymarket prediction-market outcomes on Polygon — one CLOB call across many tokens.",
    embeddingText: embeddingText(
      `Get last trade prices for multiple outcome tokens on Polymarket prediction markets on Polygon in one batched call. ` +
      `Use this when the user is screening many markets at once, scanning a watchlist for fresh prints, or comparing recent fills across outcomes for arbitrage or LP planning. ` +
      `Example queries: last trades across these polymarket outcomes, batch last print check, scan recent fills on many prediction markets, compare last trades. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "last trades", "batch last trades", "batch last prints", "batch recent fills"],
    exampleIntents: [
      "last trades for these polymarket tokens",
      "batch last print check on prediction markets",
      "recent fills across many outcomes",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.priceHistory": {
    canonicalSummary:
      "OHLC price history time-series for a Polymarket prediction-market outcome on Polygon — 1h, 1d, 1w or all-time intervals.",
    embeddingText: embeddingText(
      `Get the price history time-series for a Polymarket prediction market on Polygon — OHLC data over a configurable interval (1h, 6h, 1d, 1w, 1m, all) with adjustable fidelity. ` +
      `Use this when the user wants a price chart for an outcome, historical odds, the trajectory of a yes share over time, a backtest data feed, or to plot how a prediction market has moved. ` +
      `Example queries: price history for this polymarket market, chart for this prediction market, historical odds, ohlc on this outcome, how has this market moved over time. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "price history", "chart", "ohlc",
      "historical odds", "time series", "condition id",
    ],
    exampleIntents: [
      "price history for this polymarket market",
      "chart for this prediction market",
      "historical odds on this outcome",
      "ohlc data on polymarket",
    ],
    preferredFor: ["price history", "ohlc", "historical odds", "polymarket chart"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.batchPriceHistory": {
    canonicalSummary:
      "Batch OHLC price history time-series for multiple Polymarket prediction-market outcomes on Polygon — up to 20 markets in one call.",
    embeddingText: embeddingText(
      `Get price history time-series for multiple Polymarket prediction markets on Polygon in one batched call (max 20 markets). ` +
      `Use this when the user wants a chart panel across many outcomes, comparing the trajectory of several yes shares at once, building a multi-market backtest, or plotting odds for a portfolio. ` +
      `Example queries: price history for these polymarket markets, batch chart, compare historical odds across outcomes, multi-market ohlc, plot many prediction markets. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "price history", "batch price history", "batch ohlc", "multi market chart"],
    exampleIntents: [
      "price history for these polymarket markets",
      "batch ohlc across prediction markets",
      "multi-market chart panel for outcomes",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.serverTime": {
    embeddingText: embeddingText(
      `Get the Polymarket CLOB server time as a unix timestamp — the canonical clock for the prediction market on Polygon. ` +
      `Use this when the user wants to align a client clock with the exchange, debug timestamp drift on a signed order, or stamp a request precisely against server time. ` +
      `Example queries: polymarket server time, clob clock, current unix timestamp on polymarket, server time check. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "server time", "clob time", "unix timestamp",
    ],
    exampleIntents: [
      "polymarket server time",
      "clob clock",
      "unix timestamp on polymarket",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.tickSize": {
    embeddingText: embeddingText(
      `Get the minimum tick size (price increment) for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants to round a limit-order price to a valid grid, check the smallest meaningful price step on a yes share or no share, or validate an order before signing it. ` +
      `Example queries: tick size for this polymarket outcome, minimum price increment, smallest tick on this prediction market, valid price grid. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "tick size", "price increment", "min tick",
    ],
    exampleIntents: [
      "tick size for this polymarket outcome",
      "minimum price increment on prediction market",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.feeRate": {
    embeddingText: embeddingText(
      `Get the trading fee rate in basis points for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants to estimate trading cost before placing an order, compare taker fees across markets, or check what the CLOB will charge on a fill. ` +
      `Example queries: fee rate for this polymarket outcome, trading fees on this prediction market, taker fee in bps, what does polymarket charge. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "fee rate", "trading fees", "taker fee", "basis points", "bps",
    ],
    exampleIntents: [
      "fee rate for this polymarket outcome",
      "trading fees on this prediction market",
      "taker fee bps",
    ],
    chains: POLYMARKET_CHAINS,
  },

  // ── Trading (authenticated) ───────────────────────────────────

  "polymarket.clob.buy": {
    canonicalSummary:
      "Place a YES/NO buy order on a Polymarket prediction-market outcome — Polygon CLOB, EIP-712 signed in pUSD.",
    embeddingText: embeddingText(
      `Buy YES or NO outcome shares on Polymarket — a prediction market on Polygon — by submitting an EIP-712 signed CLOB order in pUSD. ` +
      `Use this when the user wants to bet yes or no on an outcome, place a prediction trade, take a position, ape into a market, or open a YES/NO position with a limit or market price. Supports GTC, FOK, GTD and FAK order types, post-only and marketable limit orders. ` +
      `Example queries: bet yes on the election, buy yes shares at 0.65, place a no bet on this market, ape into trump 2028, take the yes side on bitcoin 100k, open a prediction position. ` +
      `Submitted as an EIP-712 signed order to the CLOB; pUSD is the collateral.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "buy yes", "buy no", "buy shares", "buy outcome shares",
      "place bet", "yes share", "no share",
      "EIP-712 order", "EIP-712 signed order",
      "GTC", "FOK", "GTD", "FAK", "post-only", "marketable limit order",
      "pUSD", "USDC.e", "bridged USDC",
    ],
    exampleIntents: [
      "bet yes on bitcoin hitting 100k",
      "buy no shares on polymarket",
      "place a prediction trade at 0.65",
      "ape into this polymarket market",
    ],
    preferredFor: ["place bet", "buy yes shares", "buy no shares"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.sell": {
    canonicalSummary:
      "Place a YES/NO sell order on a Polymarket prediction-market outcome — Polygon CLOB, EIP-712 signed.",
    embeddingText: embeddingText(
      `Sell YES or NO outcome shares on Polymarket — a prediction market on Polygon — by submitting an EIP-712 signed CLOB order. Pays out in pUSD on fill. ` +
      `Use this when the user wants to exit a position, take profit on a yes share or no share, dump a bet before resolution, sell shares back into the book at a limit or market price, or close out a prediction trade. Supports GTC, FOK, GTD and FAK order types. ` +
      `Example queries: sell my yes shares, exit this polymarket position, take profit on this prediction trade, dump no shares at 0.4, close my polymarket bet, get out of this market. ` +
      `Submitted as an EIP-712 signed order to the CLOB; settles in pUSD.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "sell yes", "sell no", "sell shares", "sell outcome shares",
      "exit position", "take profit", "close bet",
      "yes share", "no share",
      "EIP-712 order", "EIP-712 signed order",
      "GTC", "FOK", "GTD", "FAK",
      "pUSD", "USDC.e", "bridged USDC",
    ],
    exampleIntents: [
      "sell my yes shares on polymarket",
      "exit this prediction market position",
      "take profit on this polymarket bet",
      "dump no shares at 0.4",
    ],
    preferredFor: ["sell shares", "exit position", "close bet"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.cancel": {
    canonicalSummary:
      "Cancel a single open order on a Polymarket prediction-market outcome on Polygon by order ID.",
    embeddingText: embeddingText(
      `Cancel one specific open order on a Polymarket prediction market on Polygon by its order ID. ` +
      `Use this when the user wants to pull a single resting bid or ask, kill one limit order before it fills, or cancel a specific yes/no bet they placed earlier. ` +
      `Example queries: cancel this polymarket order, kill order abc-123, pull my limit on yes shares, cancel my pending bet. ` +
      `Cost is gas-free off-chain — the CLOB removes the order from the book on receipt.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "cancel order", "kill order", "pull order",
      "open order", "limit order",
    ],
    exampleIntents: [
      "cancel polymarket order",
      "kill this order on prediction market",
      "pull my limit order",
    ],
    preferredFor: ["cancel order", "kill order", "pull limit"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.cancelAll": {
    canonicalSummary:
      "Cancel every open order across all your Polymarket prediction-market outcomes on Polygon.",
    embeddingText: embeddingText(
      `Cancel every open order this account has across every Polymarket prediction market on Polygon in one shot. ` +
      `Use this when the user wants a panic-cancel, to flatten all resting bids and asks before stepping away, to kill every open bet on the book, or to clean up after a strategy run. ` +
      `Example queries: cancel all my polymarket orders, kill everything, panic cancel, pull all my limits, cancel all open bets, flatten polymarket book. ` +
      `Cost is gas-free off-chain; affects every order regardless of market.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "cancel all", "kill all orders", "panic cancel",
      "flatten book", "pull all limits",
    ],
    exampleIntents: [
      "cancel all my polymarket orders",
      "panic cancel everything",
      "kill all open bets on polymarket",
    ],
    preferredFor: ["cancel all", "panic cancel", "flatten orders"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.cancelMarket": {
    canonicalSummary:
      "Cancel all your open orders scoped to one Polymarket prediction-market outcome on Polygon (single condition id).",
    embeddingText: embeddingText(
      `Cancel every open order this account has in one specific Polymarket prediction market on Polygon, scoped by condition id and asset id. ` +
      `Use this when the user wants to clear all their bids and asks on a single market while leaving other markets untouched, pull all limits on one outcome, or reset a position before re-entering. ` +
      `Example queries: cancel all my orders on this polymarket market, pull all my limits on this prediction market, kill all bets on this outcome, clear my orders for this condition id. ` +
      `Cost is gas-free off-chain; scoped to the supplied market only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "cancel market orders", "cancel all in market",
      "kill orders on this market", "condition id", "clob token id",
    ],
    exampleIntents: [
      "cancel all my orders on this polymarket market",
      "pull all limits on this prediction market",
      "kill all my bets on this outcome",
    ],
    preferredFor: ["cancel market orders", "kill market orders"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.orders": {
    canonicalSummary:
      "List your open orders on a Polymarket prediction-market outcome on Polygon, with optional market or asset filter.",
    embeddingText: embeddingText(
      `List the user's open (resting, not yet filled) orders on Polymarket prediction markets on Polygon, with optional filter by order id, market condition id, or asset id. Paginated. ` +
      `Use this when the user wants to see their open orders, check what limits are still working on the book, look up an order by id before cancelling, or audit pending bets per market. ` +
      `Example queries: my open polymarket orders, what limits do I have working, show me my pending bets on this market, look up this order id, list resting orders. ` +
      `Read-only — does not place or cancel orders.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "open orders", "my orders", "resting orders",
      "order status", "pending bets",
    ],
    exampleIntents: [
      "my open polymarket orders",
      "show my pending bets on this prediction market",
      "list resting orders on polymarket",
      "look up this order id",
    ],
    preferredFor: ["order status", "my orders", "open orders", "cancel order"],
    avoidFor: ["orderbook", "market depth"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.order": {
    embeddingText: embeddingText(
      `Get the full state of one specific order on a Polymarket prediction market on Polygon by order id — side, price, size, fill status, market, asset. ` +
      `Use this when the user wants to inspect a single order they placed earlier, check whether it filled or is still resting, debug a stuck order, or look up the exact terms of one yes/no bet. ` +
      `Example queries: status of this polymarket order, look up order abc-123, did my order fill, details on this prediction bet. ` +
      `Read-only — does not modify the order.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "order details", "order status", "single order", "look up order",
    ],
    exampleIntents: [
      "status of this polymarket order",
      "look up this order id",
      "did my prediction order fill",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.trades": {
    canonicalSummary:
      "List your filled trades on a Polymarket prediction-market outcome on Polygon, with optional market or time filter.",
    embeddingText: embeddingText(
      `List the user's executed trades (fills) on Polymarket prediction markets on Polygon, with optional filter by trade id, market condition id, asset id, or before/after unix timestamps. Paginated. ` +
      `Use this when the user wants their trade history, fill history on a yes share or no share, an audit trail of bets they took, time-sliced trades for a tax export, or to reconcile a position. ` +
      `Example queries: my polymarket trade history, fills on this prediction market, polymarket trades since last week, csv of my polymarket fills, audit trail of my bets. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "trade history", "fills", "my trades",
      "polymarket fills", "executed trades", "tax export",
    ],
    exampleIntents: [
      "my polymarket trade history",
      "fills on this prediction market",
      "polymarket trades since last week",
      "audit trail of my bets",
    ],
    preferredFor: ["trade history", "my fills", "polymarket trades"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.simplifiedMarkets": {
    embeddingText: embeddingText(
      `List Polymarket prediction markets on Polygon in a lightweight paginated form — condition id, active/closed status, outcome tokens with current prices, and reward fields. Faster than the full markets endpoint. ` +
      `Use this when the user wants a quick scan of available markets, a thin enumeration for a screener, an iterator across all markets without the heavy gamma payload, or a fast way to discover condition ids. ` +
      `Example queries: list polymarket markets, browse prediction markets fast, simplified market enumeration, iterate condition ids, lightweight market scan. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "simplified markets", "market list", "condition id", "lightweight markets",
    ],
    exampleIntents: [
      "list polymarket markets fast",
      "simplified prediction market list",
      "iterate polymarket condition ids",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.rebates": {
    embeddingText: embeddingText(
      `Get the rebated maker fees for one wallet address on a Polymarket prediction market on Polygon for a specific date. ` +
      `Use this when the user wants to check how much maker rebate they earned on a given day, audit their LP-style rebate history, or reconcile rebates against on-book maker activity. ` +
      `Example queries: my polymarket maker rebates today, rebated fees for this address, how much did I make from rebates yesterday, polymarket maker rebate history. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "maker rebate", "taker rebate", "rebated fees", "rebates",
    ],
    exampleIntents: [
      "my polymarket maker rebates today",
      "rebated fees for this address",
      "polymarket rebate history",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.heartbeat": {
    embeddingText: embeddingText(
      `Send a keep-alive heartbeat to the Polymarket CLOB on Polygon to prevent automated orders from auto-cancelling. The CLOB cancels orders when heartbeats stop arriving. ` +
      `Use this when the user is running a market-making bot, keeping resting limits alive across a session, or implementing a watchdog for an automated prediction-market strategy. ` +
      `Example queries: keep my polymarket orders alive, send heartbeat, ping clob, watchdog for prediction market bot. ` +
      `Cost is gas-free off-chain; emits a single ping to the CLOB.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "heartbeat", "keep alive", "watchdog", "ping clob",
    ],
    exampleIntents: [
      "send polymarket heartbeat",
      "keep my prediction market orders alive",
      "watchdog ping for clob",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.cancelOrders": {
    canonicalSummary:
      "Cancel multiple specific orders on a Polymarket prediction-market outcome on Polygon by ID list (max 3000).",
    embeddingText: embeddingText(
      `Cancel a specific list of open orders on Polymarket prediction markets on Polygon in one batched call (up to 3000 ids). ` +
      `Use this when the user wants to cancel a curated subset of resting orders without nuking everything via cancel-all, kill a strategy's set of limits in one shot, or pull a hand-picked list of bids and asks. ` +
      `Example queries: cancel these polymarket orders, kill this list of order ids, batch cancel my prediction orders, pull these specific limits. ` +
      `Cost is gas-free off-chain; affects only the listed order ids.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "cancel orders", "batch cancel", "kill order list",
    ],
    exampleIntents: [
      "cancel these polymarket orders",
      "batch cancel prediction orders",
      "kill this list of order ids",
    ],
    preferredFor: ["batch cancel", "cancel orders list", "kill many orders"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.orderScoring": {
    embeddingText: embeddingText(
      `Check whether one specific open order on a Polymarket prediction market on Polygon is currently being scored for maker rewards. ` +
      `Use this when the user wants to verify a resting order qualifies for maker incentives, debug why an order is or isn't earning rewards, or check competitiveness against the min-spread / size requirements. ` +
      `Example queries: is this polymarket order earning rewards, am I being scored, reward eligibility on this order, check maker reward status. ` +
      `Read-only — does not modify the order.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "order scoring", "maker rewards", "reward eligibility", "competitiveness",
    ],
    exampleIntents: [
      "is this polymarket order earning rewards",
      "am I being scored on this prediction order",
      "maker reward eligibility on polymarket",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 28;
if (Object.keys(POLYMARKET_CLOB_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `POLYMARKET_CLOB_DISCOVERY has ${Object.keys(POLYMARKET_CLOB_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
