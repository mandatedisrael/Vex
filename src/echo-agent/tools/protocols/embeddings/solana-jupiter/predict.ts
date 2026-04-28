/**
 * Retrieval metadata for Solana / Jupiter predict tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `solana-jupiter/manifests/predict.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { SOLANA_CHAINS } from "../../solana-jupiter/discovery-text.js";

export const SOLANA_PREDICT_DISCOVERY = {
  "solana.predict.events": {
    canonicalSummary:
      "Browse events on a Jupiter prediction market on Solana — sports, crypto, politics, esports, culture, economics, tech.",
    embeddingText: embeddingText(
      `Browse events on Jupiter — a prediction market on Solana — across sports, crypto, politics, esports, culture, economics, tech — with binary YES/NO markets. ` +
      `Use this when the user wants to browse what they can bet on, see live or trending prediction markets, browse by category, or discover prediction opportunities. ` +
      `Example queries: browse prediction markets, what can I bet on, live sports markets, trending crypto predictions, politics prediction events, prediction events on solana.`,
    ),
    aliases: [
      "prediction market", "jupiter predict",
      "browse events", "trending markets",
      "live markets", "prediction events",
      "yes share", "no share", "outcome shares",
    ],
    exampleIntents: [
      "browse jupiter prediction markets",
      "trending prediction events on solana",
      "what can I bet on solana",
      "live prediction markets",
    ],
    preferredFor: ["browse prediction events", "trending jupiter markets", "discover bets"],
    chains: SOLANA_CHAINS,
  },

  "solana.predict.search": {
    canonicalSummary:
      "Search a Jupiter prediction market on Solana by keyword across sports, crypto, politics, esports, culture, economics, and tech.",
    embeddingText: embeddingText(
      `Search Jupiter prediction market events on Solana by keyword across sports, crypto, politics, esports, culture, economics, and tech. ` +
      `Use this when the user wants to find a specific prediction market, search by topic (bitcoin, election, super bowl), filter the prediction catalog by keyword, or look up a specific event. ` +
      `Example queries: find bitcoin prediction markets, search election predictions, look up super bowl bets, find solana price markets, search prediction by keyword, find this prediction event.`,
    ),
    aliases: [
      "prediction market", "jupiter predict",
      "search predictions", "find market",
      "find event", "lookup prediction",
      "yes share", "no share", "outcome shares",
    ],
    exampleIntents: [
      "search bitcoin prediction on solana",
      "find election prediction markets",
      "look up super bowl bets on jupiter",
      "search jupiter predict by keyword",
    ],
    preferredFor: ["search jupiter predict", "find prediction event", "lookup bet"],
    chains: SOLANA_CHAINS,
  },

  "solana.predict.market": {
    embeddingText: embeddingText(
      `Get full details of a single Jupiter prediction market on Solana — YES/NO prices, probability, volume, status, payout, metadata. ` +
      `Use this when the user wants the deep stats on one specific market, check the current odds before betting, see how a market is priced, or review trading conditions. ` +
      `Example queries: details for this prediction market, what's the current odds on this, yes no prices for this market, market depth before betting, status of this prediction.`,
    ),
    aliases: [
      "prediction market", "jupiter predict",
      "market details", "market by id",
      "yes no price", "odds check",
      "yes share", "no share", "outcome shares",
    ],
    exampleIntents: [
      "details for this jupiter prediction market",
      "yes no price for this market",
      "current odds on this prediction",
    ],
    chains: SOLANA_CHAINS,
  },

  "solana.predict.positions": {
    canonicalSummary:
      "List a wallet's open YES/NO positions on a Jupiter prediction-market outcome on Solana — exposure, unrealized PnL.",
    embeddingText: embeddingText(
      `Get a wallet's open Jupiter prediction positions on Solana — YES/NO sides, exposure, unrealized PnL, payout. ` +
      `Use this when the user wants to see their open prediction bets, check pending exposure, review unrealized PnL on bets, or list active prediction positions. ` +
      `Example queries: my open prediction bets, show my prediction positions, unrealized pnl on prediction, what bets do I have, active yes no positions.`,
    ),
    aliases: [
      "prediction market", "jupiter predict",
      "open positions", "open bets",
      "unrealized pnl", "active bets",
      "yes share", "no share", "outcome shares",
    ],
    exampleIntents: [
      "my open solana prediction bets",
      "show my jupiter prediction positions",
      "unrealized pnl on jupiter predict",
      "active yes no bets on solana",
    ],
    preferredFor: ["my prediction positions", "open jupiter bets", "active prediction exposure"],
    chains: SOLANA_CHAINS,
  },

  "solana.predict.history": {
    canonicalSummary:
      "Get a wallet's settled trade history on a Jupiter prediction-market outcome on Solana — past buys, sells, claims, realized PnL.",
    embeddingText: embeddingText(
      `Get a wallet's full Jupiter prediction trade history on Solana — past buys, sells, claims, realized PnL, closed positions, settlement events. ` +
      `Use this when the user wants to review past prediction trades, see realized PnL on closed bets, audit their prediction activity, look at past prediction settlements, or browse closed positions paginated. ` +
      `Example queries: my prediction history, past prediction trades, realized pnl on prediction, closed prediction bets, audit my prediction activity, prediction trade log.`,
    ),
    aliases: [
      "prediction market", "jupiter predict",
      "trade history", "closed positions",
      "realized pnl", "settlement log",
      "yes share", "no share", "outcome shares",
    ],
    exampleIntents: [
      "my jupiter prediction history",
      "past prediction trades on solana",
      "realized pnl on jupiter predict",
      "closed prediction bets",
    ],
    preferredFor: ["my prediction history", "closed jupiter bets", "realized prediction pnl"],
    chains: SOLANA_CHAINS,
  },

  "solana.predict.buy": {
    canonicalSummary:
      "Place a YES/NO buy order on a Jupiter prediction-market outcome on Solana, settled in USDC SPL.",
    embeddingText: embeddingText(
      `Buy YES or NO shares in a Jupiter prediction market on Solana to bet on the outcome of a real-world event — sports, crypto prices, politics, culture, tech. ` +
      `Use this when the user wants to bet on something, take a position on an outcome, buy yes or no shares, speculate on an event, or open a prediction trade. ` +
      `Example queries: bet on solana hitting 500, buy yes on this market, take the no side, speculate on the election, trade prediction outcome, place a bet.`,
    ),
    aliases: [
      "prediction market", "jupiter predict",
      "buy yes", "buy no", "buy shares", "buy outcome shares",
      "place bet", "yes share", "no share", "outcome shares",
      "USDC", "usdc spl", "open position",
    ],
    exampleIntents: [
      "bet yes on solana",
      "buy no shares on jupiter predict",
      "place a prediction trade on solana",
      "ape into this jupiter prediction market",
    ],
    preferredFor: ["place bet", "buy yes shares", "buy no shares", "open prediction position"],
    chains: SOLANA_CHAINS,
  },

  "solana.predict.sell": {
    canonicalSummary:
      "Sell or close a single position on a Jupiter prediction-market outcome on Solana before settlement.",
    embeddingText: embeddingText(
      `Sell or close one Jupiter prediction position on Solana. ` +
      `Use this when the user wants to exit a prediction bet, close a yes or no position before settlement, take profit on a prediction, or reduce exposure on a market. ` +
      `Example queries: sell my prediction position, exit this bet, close my yes shares, take profit on prediction, get out of this market early.`,
    ),
    aliases: [
      "prediction market", "jupiter predict",
      "sell position", "close bet", "exit position",
      "take profit", "early exit",
      "yes share", "no share", "outcome shares",
    ],
    exampleIntents: [
      "exit my prediction position on solana",
      "sell my jupiter prediction position",
      "close my yes shares before settlement",
      "take profit on this jupiter bet",
    ],
    preferredFor: ["close prediction position", "exit jupiter bet", "take profit on prediction"],
    chains: SOLANA_CHAINS,
  },

  "solana.predict.claim": {
    canonicalSummary:
      "Claim a payout from a resolved position on a Jupiter prediction-market outcome on Solana.",
    embeddingText: embeddingText(
      `Claim winnings from a resolved Jupiter prediction position on Solana. ` +
      `Use this when the user wants to redeem a winning bet, settle a resolved position, claim payout for correct yes or no shares, cash out a successful prediction, or collect earnings from a finished prediction market. ` +
      `Example queries: claim my winning bet, redeem this prediction payout, settle resolved position, collect my prediction winnings, claim payout, cash out winning shares.`,
    ),
    aliases: [
      "prediction market", "jupiter predict",
      "claim payout", "redeem winnings", "settle position",
      "collect winnings", "winning bet",
      "yes share", "no share", "outcome shares",
    ],
    exampleIntents: [
      "claim winning prediction bet on solana",
      "redeem my jupiter prediction payout",
      "settle resolved prediction position",
      "collect winnings on jupiter predict",
    ],
    preferredFor: ["claim prediction payout", "redeem winning bet", "settle resolved position"],
    chains: SOLANA_CHAINS,
  },

  "solana.predict.closeAll": {
    canonicalSummary:
      "Batch-close every open position on a Jupiter prediction-market outcome on Solana for a wallet.",
    embeddingText: embeddingText(
      `Close every open Jupiter prediction position on Solana for a wallet in batch. ` +
      `Use this when the user wants to wipe out all open prediction bets, panic-exit the prediction portfolio, settle every claimable position, or close out their prediction exposure entirely. ` +
      `Example queries: close all my prediction positions, panic exit prediction portfolio, settle all bets, wipe out my prediction exposure, batch close prediction.`,
    ),
    aliases: [
      "prediction market", "jupiter predict",
      "close all", "batch close", "panic exit",
      "wipe positions", "settle all",
      "yes share", "no share", "outcome shares",
    ],
    exampleIntents: [
      "close all my jupiter prediction positions",
      "panic exit prediction portfolio on solana",
      "batch close prediction bets",
      "wipe out my jupiter predict exposure",
    ],
    preferredFor: ["close all prediction positions", "panic exit prediction", "batch settle bets"],
    chains: SOLANA_CHAINS,
  },

  "solana.predict.event": {
    embeddingText: embeddingText(
      `Get a single prediction event with all of its included markets on Solana. ` +
      `Use this when the user wants to see one event (e.g. an election, a sports match) along with every related market it spawns, before picking which specific market to trade. ` +
      `Example queries: get this event with all markets, full event details, markets for this election, all bets for this match, browse one event.`,
    ),
    aliases: [
      "prediction market", "jupiter predict",
      "event by id", "event details", "event markets",
      "yes share", "no share", "outcome shares",
    ],
    exampleIntents: [
      "get this jupiter prediction event with all markets",
      "full event details on solana predict",
      "markets for this election event",
    ],
    chains: SOLANA_CHAINS,
  },

  "solana.predict.position": {
    embeddingText: embeddingText(
      `Get one Jupiter prediction position on Solana by public key — open or resolved, contracts, payout, market reference, claimability. ` +
      `Use this when the user wants the deep details on one specific bet, check whether a position is claimable, review the state of one prediction position, or look up a single bet by pubkey. ` +
      `Example queries: details for this prediction position, is this position claimable, status of one bet, look up position by pubkey, full state of one bet.`,
    ),
    aliases: [
      "prediction market", "jupiter predict",
      "position by pubkey", "position details",
      "claimable check", "single bet lookup",
      "yes share", "no share", "outcome shares",
    ],
    exampleIntents: [
      "details for this jupiter prediction position",
      "is this jupiter predict position claimable",
      "look up prediction position by pubkey",
    ],
    chains: SOLANA_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 11;
if (Object.keys(SOLANA_PREDICT_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `SOLANA_PREDICT_DISCOVERY has ${Object.keys(SOLANA_PREDICT_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
