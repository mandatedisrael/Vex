import type { ProtocolToolManifest } from "../../../types.js";
import { POLYMARKET_CLOB_DISCOVERY } from "../../../embeddings/polymarket/clob.js";

/**
 * CLOB authenticated-account manifests.
 *
 * These tools are interleaved with markets/orders in the original `CLOB_TOOLS`
 * tail, so they are split into three named segments — `trades`, the
 * `rebates`+`heartbeat` pair, and `orderScoring` — each spread at its original
 * position by the façade to preserve EXACT element order.
 */

// ── Account: trades (position 23 of CLOB_TOOLS) ──────────────────
export const CLOB_ACCOUNT_TRADES: readonly ProtocolToolManifest[] = [
  {
    toolId: "polymarket.clob.trades",
    namespace: "polymarket",
    lifecycle: "active",
    description: "List your CLOB trades with optional market/time filter. Paginated.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "id", type: "string", description: "Filter by specific trade ID." },
      { key: "market", type: "string", description: "Filter by market condition ID." },
      { key: "assetId", type: "string", description: "Filter by asset/token ID." },
      { key: "before", type: "string", description: "Filter trades before this unix timestamp." },
      { key: "after", type: "string", description: "Filter trades after this unix timestamp." },
      { key: "cursor", type: "string", description: "Pagination cursor." },
    ],
    exampleParams: {},
    requiresEnv: "POLYMARKET_API_KEY",
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.trades"],
  },
];

// ── Account: rebates + heartbeat (positions 25–26 of CLOB_TOOLS) ──
export const CLOB_ACCOUNT_REBATES_HEARTBEAT: readonly ProtocolToolManifest[] = [
  {
    toolId: "polymarket.clob.rebates",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get current rebated fees for a maker address on a given date.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "date", type: "string", required: true, description: "Date in YYYY-MM-DD format." },
      { key: "makerAddress", type: "string", required: true, description: "Maker wallet address." },
    ],
    exampleParams: { date: "2026-04-04", makerAddress: "0x1234..." },
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.rebates"],
  },
  {
    toolId: "polymarket.clob.heartbeat",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Send heartbeat to keep automated orders alive. Orders auto-cancel if heartbeats stop.",
    mutating: true,
    actionKind: "external_post",
    params: [],
    exampleParams: {},
    requiresEnv: "POLYMARKET_API_KEY",
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.heartbeat"],
  },
];

// ── Account: orderScoring (position 28 of CLOB_TOOLS) ─────────────
export const CLOB_ACCOUNT_ORDER_SCORING: readonly ProtocolToolManifest[] = [
  {
    toolId: "polymarket.clob.orderScoring",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Check if an order is being scored for rewards.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "orderId", type: "string", required: true, description: "Order ID." },
    ],
    exampleParams: { orderId: "abc-123..." },
    requiresEnv: "POLYMARKET_API_KEY",
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.orderScoring"],
  },
];
