/**
 * Order-resource CLOB validators: orderbook, send-order, open-order /
 * paginated-orders, and cancel responses. Moved verbatim from the original
 * `validation.ts` god-file (codex-002 Phase 2 structural split).
 */

import { z } from "zod";
import type {
  OrderBookSummary, OrderSummary, SendOrderResponse,
  OpenOrder, PaginatedOrders, CancelResponse,
} from "../types.js";
import {
  strDefault, numDefault, isTrue, asOptionalString, stringArrayFilter,
  openOrderSideSchema,
} from "./_shared.js";

// ── OrderSummary / OrderBook ───────────────────────────────────────────

const orderSummarySchema: z.ZodType<OrderSummary> = z.unknown().transform((raw) => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { price: "0", size: "0" };
  }
  const r = raw as Record<string, unknown>;
  return {
    price: typeof r.price === "string" ? r.price : String(r.price ?? "0"),
    size: typeof r.size === "string" ? r.size : String(r.size ?? "0"),
  };
});

const orderBookSchema = z.object({
  market: strDefault(""),
  asset_id: strDefault(""),
  timestamp: strDefault(""),
  hash: strDefault(""),
  // Non-array → []; array → element-mapped via orderSummarySchema (which itself
  // defaults non-record elements rather than throwing — matching `parseOrderSummary`).
  bids: z.unknown().transform((v) => (Array.isArray(v) ? v.map((e) => orderSummarySchema.parse(e)) : [])),
  asks: z.unknown().transform((v) => (Array.isArray(v) ? v.map((e) => orderSummarySchema.parse(e)) : [])),
  min_order_size: strDefault("1"),
  tick_size: strDefault("0.01"),
  neg_risk: isTrue,
  last_trade_price: strDefault("0.5"),
});

export function validateOrderBookResponse(raw: unknown): OrderBookSummary {
  const parsed = orderBookSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected orderbook object");
  return parsed.data;
}

// ── SendOrderResponse ──────────────────────────────────────────────────

const sendOrderStatusSchema = z
  .unknown()
  .transform((v) => (v === "live" || v === "matched" || v === "delayed" ? v : "delayed"));

const sendOrderResponseSchema = z.object({
  success: isTrue,
  orderID: strDefault(""),
  status: sendOrderStatusSchema,
  makingAmount: asOptionalString,
  takingAmount: asOptionalString,
  transactionsHashes: stringArrayFilter(undefined),
  tradeIDs: stringArrayFilter(undefined),
  errorMsg: strDefault(""),
});

export function validateSendOrderResponse(raw: unknown): SendOrderResponse {
  const parsed = sendOrderResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected order response object");
  return parsed.data;
}

// ── OpenOrder ──────────────────────────────────────────────────────────

const openOrderTypeSchema = z
  .unknown()
  .transform((v) => (v === "GTC" || v === "FOK" || v === "GTD" || v === "FAK" ? v : "GTC"));

const openOrderSchema = z.object({
  id: strDefault(""),
  status: strDefault(""),
  owner: strDefault(""),
  maker_address: strDefault(""),
  market: strDefault(""),
  asset_id: strDefault(""),
  side: openOrderSideSchema,
  original_size: strDefault("0"),
  size_matched: strDefault("0"),
  price: strDefault("0"),
  outcome: strDefault(""),
  expiration: strDefault(""),
  order_type: openOrderTypeSchema,
  associate_trades: stringArrayFilter<string[]>([]),
  created_at: numDefault(0),
});

function parseOpenOrder(raw: unknown): OpenOrder {
  const parsed = openOrderSchema.safeParse(raw);
  if (!parsed.success) throw new Error("order must be an object");
  return parsed.data;
}

export function validatePaginatedOrders(raw: unknown): PaginatedOrders {
  const parsed = paginatedOrdersSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected paginated orders");
  return parsed.data;
}

const paginatedOrdersSchema = z.object({
  limit: numDefault(100),
  next_cursor: strDefault(""),
  count: numDefault(0),
  // Non-array → []; array → map each through parseOpenOrder, which THROWS
  // "order must be an object" for a non-record element (matching the original
  // `raw.data.map(parseOpenOrder)`). The throw escapes safeParse, so it
  // surfaces directly to the caller — identical to the hand-written behavior.
  data: z.unknown().transform((v) => (Array.isArray(v) ? v.map(parseOpenOrder) : [])),
});

export function validateOpenOrder(raw: unknown): OpenOrder {
  return parseOpenOrder(raw);
}

// ── CancelResponse ─────────────────────────────────────────────────────

const cancelResponseSchema = z.object({
  canceled: stringArrayFilter<string[]>([]),
  // Preserve the raw record subtree exactly as `raw.not_canceled as Record<string,string>`:
  // non-record → {}; record → kept as-is (no element filtering in the original).
  not_canceled: z
    .unknown()
    .transform((v) =>
      typeof v === "object" && v !== null && !Array.isArray(v)
        ? (v as Record<string, string>)
        : ({} as Record<string, string>),
    ),
});

export function validateCancelResponse(raw: unknown): CancelResponse {
  const parsed = cancelResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected cancel response");
  return parsed.data;
}
