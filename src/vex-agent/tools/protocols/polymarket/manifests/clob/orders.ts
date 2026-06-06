import type { ProtocolToolManifest } from "../../../types.js";
import { POLYMARKET_CLOB_DISCOVERY } from "../../../embeddings/polymarket/clob.js";

/**
 * CLOB order/trading manifests (authenticated).
 *
 * Split into two named segments to preserve the EXACT original `CLOB_TOOLS`
 * element order: the contiguous order-lifecycle block (buy…order) plus the
 * tail-interleaved `cancelOrders`. The façade spreads each segment at its
 * original position.
 */

// ── Trading core block (positions 16–22 of CLOB_TOOLS) ───────────
export const CLOB_ORDERS_CORE: readonly ProtocolToolManifest[] = [
  // ── Trading (authenticated) ───────────────────────────────────

  {
    toolId: "polymarket.clob.buy",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Buy YES or NO outcome shares on Polymarket. Resolves market, builds EIP-712 signed order, submits to CLOB.",
    mutating: true,
    actionKind: "external_post",
    params: [
      { key: "conditionId", type: "string", required: true, description: "Market condition ID." },
      { key: "outcome", type: "string", required: true, description: "Outcome to buy: yes or no." },
      { key: "amount", type: "number", required: true, description: "Amount in USDC to spend." },
      { key: "price", type: "number", description: "Limit price (0-1). Omit for market order at best ask." },
      { key: "orderType", type: "string", description: "Order type: GTC, FOK, GTD, FAK (default: GTC)." },
      { key: "deferExec", type: "boolean", description: "Defer execution (default: false)." },
      { key: "dryRun", type: "boolean", description: "Preview order without submitting." },
    ],
    exampleParams: { conditionId: "0xabc...", outcome: "yes", amount: 10, price: 0.65 },
    requiresEnv: "POLYMARKET_API_KEY",
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.buy"],
  },
  {
    toolId: "polymarket.clob.sell",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Sell YES or NO outcome shares on Polymarket. EIP-712 signed order submitted to CLOB.",
    mutating: true,
    actionKind: "external_post",
    params: [
      { key: "conditionId", type: "string", required: true, description: "Market condition ID." },
      { key: "outcome", type: "string", required: true, description: "Outcome to sell: yes or no." },
      { key: "amount", type: "number", required: true, description: "Number of shares to sell." },
      { key: "price", type: "number", description: "Limit price (0-1). Omit for market order at best bid." },
      { key: "orderType", type: "string", description: "Order type: GTC, FOK, GTD, FAK (default: GTC)." },
      { key: "deferExec", type: "boolean", description: "Defer execution (default: false)." },
      { key: "dryRun", type: "boolean", description: "Preview order without submitting." },
    ],
    exampleParams: { conditionId: "0xabc...", outcome: "yes", amount: 10 },
    requiresEnv: "POLYMARKET_API_KEY",
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.sell"],
  },
  {
    toolId: "polymarket.clob.cancel",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Cancel a single open order by order ID.",
    mutating: true,
    actionKind: "external_post",
    params: [
      { key: "orderId", type: "string", required: true, description: "Order ID to cancel." },
    ],
    exampleParams: { orderId: "abc-123..." },
    requiresEnv: "POLYMARKET_API_KEY",
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.cancel"],
  },
  {
    toolId: "polymarket.clob.cancelAll",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Cancel all open orders on Polymarket.",
    mutating: true,
    actionKind: "external_post",
    params: [],
    exampleParams: {},
    requiresEnv: "POLYMARKET_API_KEY",
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.cancelAll"],
  },
  {
    toolId: "polymarket.clob.cancelMarket",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Cancel all open orders in a specific market.",
    mutating: true,
    actionKind: "external_post",
    params: [
      { key: "market", type: "string", required: true, description: "Market condition ID." },
      { key: "assetId", type: "string", required: true, description: "Asset/token ID." },
    ],
    exampleParams: { market: "0xabc...", assetId: "71321..." },
    requiresEnv: "POLYMARKET_API_KEY",
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.cancelMarket"],
  },
  {
    toolId: "polymarket.clob.orders",
    namespace: "polymarket",
    lifecycle: "active",
    description: "List open orders with optional market/asset filter. Paginated.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "id", type: "string", description: "Filter by specific order ID (hash)." },
      { key: "market", type: "string", description: "Filter by market condition ID." },
      { key: "assetId", type: "string", description: "Filter by asset/token ID." },
      { key: "cursor", type: "string", description: "Pagination cursor." },
    ],
    exampleParams: {},
    requiresEnv: "POLYMARKET_API_KEY",
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.orders"],
  },
  {
    toolId: "polymarket.clob.order",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get details of a single order by order ID.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "orderId", type: "string", required: true, description: "Order ID." },
    ],
    exampleParams: { orderId: "abc-123..." },
    requiresEnv: "POLYMARKET_API_KEY",
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.order"],
  },
];

// ── Trading tail outlier (position 27 of CLOB_TOOLS) ──────────────
export const CLOB_ORDERS_CANCEL_ORDERS: readonly ProtocolToolManifest[] = [
  {
    toolId: "polymarket.clob.cancelOrders",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Cancel multiple orders by IDs in one call (max 3000).",
    mutating: true,
    actionKind: "external_post",
    params: [
      { key: "orderIds", type: "string", required: true, description: "Comma-separated order IDs to cancel." },
    ],
    exampleParams: { orderIds: "abc-123,def-456" },
    requiresEnv: "POLYMARKET_API_KEY",
    discovery: POLYMARKET_CLOB_DISCOVERY["polymarket.clob.cancelOrders"],
  },
];
