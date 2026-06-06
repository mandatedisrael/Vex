/**
 * Array-root and batch CLOB validators: send-orders array, batch orderbooks,
 * batch prices / midpoints / spreads / last-trades-prices. Moved verbatim from
 * the original `validation.ts` god-file (codex-002 Phase 2 structural split).
 */

import { z } from "zod";
import type { OrderBookSummary, SendOrderResponse, LastTradePrice } from "../types.js";
import { batchStringMapSchema } from "./_shared.js";
import { validateOrderBookResponse, validateSendOrderResponse } from "./orders.js";

// ── Array-root validators ──────────────────────────────────────────────

export function validateSendOrdersResponse(raw: unknown): SendOrderResponse[] {
  if (!Array.isArray(raw)) throw new Error("Expected orders response array");
  return raw.map(validateSendOrderResponse);
}

// ── Batch validators ──────────────────────────────────────────────

export function validateBatchOrderBooksResponse(raw: unknown): OrderBookSummary[] {
  if (!Array.isArray(raw)) throw new Error("Expected batch orderbooks array");
  return raw.map(validateOrderBookResponse);
}

/**
 * token → side → numeric price. Non-record root → {}; per token, non-record
 * value is skipped; per side, non-number price is skipped. Built element-wise,
 * so a token with no numeric sides yields `{}` (matching the original).
 */
const batchPricesSchema = z.record(z.string(), z.unknown()).transform((raw) => {
  const result: Record<string, Record<string, number>> = {};
  for (const [tokenId, sides] of Object.entries(raw)) {
    if (typeof sides === "object" && sides !== null && !Array.isArray(sides)) {
      result[tokenId] = {};
      for (const [side, price] of Object.entries(sides as Record<string, unknown>)) {
        if (typeof price === "number") result[tokenId][side] = price;
      }
    }
  }
  return result;
});

export function validateBatchPricesResponse(raw: unknown): Record<string, Record<string, number>> {
  const parsed = batchPricesSchema.safeParse(raw);
  if (!parsed.success) return {};
  return parsed.data;
}

export function validateBatchMidpointsResponse(raw: unknown): Record<string, string> {
  const parsed = batchStringMapSchema.safeParse(raw);
  if (!parsed.success) return {};
  return parsed.data;
}

export function validateBatchSpreadsResponse(raw: unknown): Record<string, string> {
  const parsed = batchStringMapSchema.safeParse(raw);
  if (!parsed.success) return {};
  return parsed.data;
}

const lastTradePriceEntrySchema: z.ZodType<LastTradePrice> = z.unknown().transform((item) => {
  const r = item as Record<string, unknown>;
  return {
    token_id: typeof r.token_id === "string" ? r.token_id : "",
    price: typeof r.price === "string" ? r.price : "0.5",
    side: r.side === "BUY" || r.side === "SELL" ? r.side : "BUY",
  };
});

export function validateBatchLastTradesPricesResponse(raw: unknown): LastTradePrice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
    )
    .map((item) => lastTradePriceEntrySchema.parse(item));
}
