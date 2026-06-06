import type { ProtocolToolManifest } from "../../../types.js";
import { POLYMARKET_CLOB_DISCOVERY } from "../../../embeddings/polymarket/clob.js";

/**
 * CLOB market-data manifests (public, read-only).
 *
 * Split into two named segments to preserve the EXACT original `CLOB_TOOLS`
 * element order: the bulk of market-data tools form the head of the array,
 * while `simplifiedMarkets` is interleaved in the authenticated tail. The
 * façade spreads each segment at its original position.
 */

// ── Market Data head (positions 1–15 of CLOB_TOOLS) ──────────────
export const CLOB_MARKETS_HEAD: readonly ProtocolToolManifest[] = [
  // ── Market Data (public) ──────────────────────────────────────

  {
    toolId: "polymarket.clob.orderbook",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get full orderbook for a token — bids, asks, tick size, last trade price, neg risk flag.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenId", type: "string", required: true, description: "CLOB token ID (outcome token asset ID)." },
    ],
    exampleParams: { tokenId: "71321..." },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.orderbook"],
  },
  {
    toolId: "polymarket.clob.orderbooks",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get orderbooks for multiple tokens in one call.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenIds", type: "string", required: true, description: "Comma-separated CLOB token IDs." },
    ],
    exampleParams: { tokenIds: "71321...,82432..." },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.orderbooks"],
  },
  {
    toolId: "polymarket.clob.price",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get best available price for a token on BUY or SELL side.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenId", type: "string", required: true, description: "CLOB token ID." },
      { key: "side", type: "string", required: true, description: "Side: BUY or SELL." },
    ],
    exampleParams: { tokenId: "71321...", side: "BUY" },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.price"],
  },
  {
    toolId: "polymarket.clob.prices",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get prices for multiple tokens and sides in one call.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenIds", type: "string", required: true, description: "Comma-separated CLOB token IDs." },
      { key: "sides", type: "string", required: true, description: "Comma-separated sides (BUY/SELL) matching tokenIds order." },
    ],
    exampleParams: { tokenIds: "71321...,82432...", sides: "BUY,SELL" },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.prices"],
  },
  {
    toolId: "polymarket.clob.midpoint",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get midpoint price (average of best bid and best ask) for a token.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenId", type: "string", required: true, description: "CLOB token ID." },
    ],
    exampleParams: { tokenId: "71321..." },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.midpoint"],
  },
  {
    toolId: "polymarket.clob.midpoints",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get midpoint prices for multiple tokens in one call.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenIds", type: "string", required: true, description: "Comma-separated CLOB token IDs." },
    ],
    exampleParams: { tokenIds: "71321...,82432..." },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.midpoints"],
  },
  {
    toolId: "polymarket.clob.spread",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get bid-ask spread for a token.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenId", type: "string", required: true, description: "CLOB token ID." },
    ],
    exampleParams: { tokenId: "71321..." },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.spread"],
  },
  {
    toolId: "polymarket.clob.spreads",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get spreads for multiple tokens in one call.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenIds", type: "string", required: true, description: "Comma-separated CLOB token IDs." },
    ],
    exampleParams: { tokenIds: "71321...,82432..." },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.spreads"],
  },
  {
    toolId: "polymarket.clob.lastTrade",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get last trade price and side for a token.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenId", type: "string", required: true, description: "CLOB token ID." },
    ],
    exampleParams: { tokenId: "71321..." },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.lastTrade"],
  },
  {
    toolId: "polymarket.clob.lastTrades",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get last trade prices for multiple tokens in one call.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenIds", type: "string", required: true, description: "Comma-separated CLOB token IDs." },
    ],
    exampleParams: { tokenIds: "71321...,82432..." },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.lastTrades"],
  },
  {
    toolId: "polymarket.clob.priceHistory",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get price history time-series for a market — OHLC data with configurable interval and fidelity.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "market", type: "string", required: true, description: "Market condition ID." },
      { key: "interval", type: "string", description: "Time interval: 1h, 6h, 1d, 1w, 1m, all." },
      { key: "fidelity", type: "number", description: "Data point granularity in minutes." },
      { key: "startTs", type: "number", description: "Start timestamp (unix seconds)." },
      { key: "endTs", type: "number", description: "End timestamp (unix seconds)." },
    ],
    exampleParams: { market: "0xabc...", interval: "1d" },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.priceHistory"],
  },
  {
    toolId: "polymarket.clob.batchPriceHistory",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get price history for multiple markets in one call (max 20). POST endpoint.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "markets", type: "string", required: true, description: "Comma-separated market asset IDs (max 20)." },
      { key: "interval", type: "string", description: "Time interval: 1h, 6h, 1d, 1w, 1m, all, max." },
      { key: "fidelity", type: "number", description: "Data point granularity in minutes." },
      { key: "startTs", type: "number", description: "Start timestamp (unix seconds)." },
      { key: "endTs", type: "number", description: "End timestamp (unix seconds)." },
    ],
    exampleParams: { markets: "0xabc...,0xdef...", interval: "1d" },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.batchPriceHistory"],
  },
  {
    toolId: "polymarket.clob.serverTime",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get Polymarket CLOB server time (unix timestamp).",
    mutating: false,
    actionKind: "read",
    params: [],
    exampleParams: {},
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.serverTime"],
  },

  {
    toolId: "polymarket.clob.tickSize",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get minimum tick size (price increment) for a token.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenId", type: "string", required: true, description: "CLOB token ID." },
    ],
    exampleParams: { tokenId: "71321..." },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.tickSize"],
  },
  {
    toolId: "polymarket.clob.feeRate",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get trading fee rate in basis points for a token.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "tokenId", type: "string", required: true, description: "CLOB token ID." },
    ],
    exampleParams: { tokenId: "71321..." },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.feeRate"],
  },
];

// ── Market Data tail outlier (position 24 of CLOB_TOOLS) ──────────
export const CLOB_MARKETS_SIMPLIFIED: readonly ProtocolToolManifest[] = [
  {
    toolId: "polymarket.clob.simplifiedMarkets",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Lightweight paginated market list — condition_id, active/closed status, tokens with prices, rewards. Faster than full markets.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "cursor", type: "string", description: "Pagination cursor." },
    ],
    exampleParams: {},
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.simplifiedMarkets"],
  },
];
