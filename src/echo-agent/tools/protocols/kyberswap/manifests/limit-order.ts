import type { ProtocolToolManifest } from "../../types.js";
import { KYBERSWAP_LIMIT_ORDER_DISCOVERY } from "../../embeddings/kyberswap/limit-order.js";

export const LIMIT_ORDER_TOOLS: readonly ProtocolToolManifest[] = [
  // ── Maker ────────────────────────────────────────────────────────

  {
    toolId: "kyberswap.limitOrder.list",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "List maker's limit orders on a chain — active, filled, cancelled, expired.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "status", type: "string", description: "Filter by status: active, filled, cancelled, expired." },
    ],
    exampleParams: { chain: "ethereum", status: "active" },
    discovery: KYBERSWAP_LIMIT_ORDER_DISCOVERY["kyberswap.limitOrder.list"],
  },
  {
    toolId: "kyberswap.limitOrder.activeMakingAmount",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Get total active making amount locked in open orders for a token (for allowance planning). Resolve makerAsset address via khalani.tokens.search first.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "makerAsset", type: "string", required: true, description: "Maker token address." },
    ],
    exampleParams: { chain: "ethereum", makerAsset: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
    discovery: KYBERSWAP_LIMIT_ORDER_DISCOVERY["kyberswap.limitOrder.activeMakingAmount"],
  },
  {
    toolId: "kyberswap.limitOrder.create",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Create a gasless EIP-712 signed limit order. Off-chain relay, on-chain settlement. Resolve token addresses via khalani.tokens.search first.",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "makerAsset", type: "string", required: true, description: "Token to sell (address or symbol)." },
      { key: "takerAsset", type: "string", required: true, description: "Token to buy (address or symbol)." },
      { key: "makingAmount", type: "string", required: true, description: "Amount to sell in human units." },
      { key: "takingAmount", type: "string", required: true, description: "Amount to receive in human units." },
      { key: "expires", type: "string", required: true, description: "Duration until expiry (e.g. 1h, 24h, 7d, 30d)." },
      { key: "dryRun", type: "boolean", description: "Preview order without creating." },
    ],
    exampleParams: { chain: "ethereum", makerAsset: "USDC", takerAsset: "ETH", makingAmount: "100", takingAmount: "0.04", expires: "24h" },
    discovery: KYBERSWAP_LIMIT_ORDER_DISCOVERY["kyberswap.limitOrder.create"],
  },
  {
    toolId: "kyberswap.limitOrder.cancel",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Cancel a limit order (gasless — operator signature lapses within ~5 minutes).",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "orderId", type: "number", required: true, description: "Order ID to cancel." },
    ],
    exampleParams: { chain: "ethereum", orderId: 12345 },
    discovery: KYBERSWAP_LIMIT_ORDER_DISCOVERY["kyberswap.limitOrder.cancel"],
  },
  {
    toolId: "kyberswap.limitOrder.hardCancel",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Hard-cancel a limit order on-chain (immediate, costs gas).",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "orderId", type: "number", required: true, description: "Order ID to hard-cancel." },
    ],
    exampleParams: { chain: "ethereum", orderId: 12345 },
    discovery: KYBERSWAP_LIMIT_ORDER_DISCOVERY["kyberswap.limitOrder.hardCancel"],
  },

  // ── Taker ────────────────────────────────────────────────────────

  {
    toolId: "kyberswap.limitOrder.pairs",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "List supported trading pairs for limit order filling on a chain.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
    ],
    exampleParams: { chain: "ethereum" },
    discovery: KYBERSWAP_LIMIT_ORDER_DISCOVERY["kyberswap.limitOrder.pairs"],
  },
  {
    toolId: "kyberswap.limitOrder.takerOrders",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Query available limit orders to fill as a taker.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "makerAsset", type: "string", description: "Filter by maker token address." },
      { key: "takerAsset", type: "string", description: "Filter by taker token address." },
    ],
    exampleParams: { chain: "ethereum" },
    discovery: KYBERSWAP_LIMIT_ORDER_DISCOVERY["kyberswap.limitOrder.takerOrders"],
  },
  {
    toolId: "kyberswap.limitOrder.fill",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Fill a limit order as a taker (on-chain execution).",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "orderId", type: "number", required: true, description: "Order ID to fill." },
      { key: "takingAmount", type: "string", required: true, description: "Amount to take in atomic units." },
      { key: "thresholdAmount", type: "string", required: true, description: "Min acceptable making amount in atomic units." },
      { key: "dryRun", type: "boolean", description: "Preview without executing." },
    ],
    exampleParams: { chain: "ethereum", orderId: 12345, takingAmount: "1000000", thresholdAmount: "990000" },
    discovery: KYBERSWAP_LIMIT_ORDER_DISCOVERY["kyberswap.limitOrder.fill"],
  },
  {
    toolId: "kyberswap.limitOrder.batchFill",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Fill multiple limit orders as a taker in one on-chain transaction.",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "orderIds", type: "string", required: true, description: "Comma-separated order IDs." },
      { key: "takingAmounts", type: "string", required: true, description: "Comma-separated taking amounts in atomic units (one per order)." },
      { key: "thresholdAmount", type: "string", required: true, description: "Min total acceptable making amount in atomic units." },
      { key: "dryRun", type: "boolean", description: "Preview without executing." },
    ],
    exampleParams: { chain: "ethereum", orderIds: "123,456", takingAmounts: "1000000,2000000", thresholdAmount: "2900000" },
    discovery: KYBERSWAP_LIMIT_ORDER_DISCOVERY["kyberswap.limitOrder.batchFill"],
  },
  {
    toolId: "kyberswap.limitOrder.cancelAll",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Cancel ALL open limit orders on a chain by increasing the nonce (on-chain, costs gas).",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
    ],
    exampleParams: { chain: "ethereum" },
    discovery: KYBERSWAP_LIMIT_ORDER_DISCOVERY["kyberswap.limitOrder.cancelAll"],
  },
];
