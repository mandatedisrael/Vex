/**
 * Market-data / price-resource CLOB validators: price-history plus the scalar
 * market-data responses (price / midpoint / spread / last-trade-price /
 * tick-size / fee-rate). These DEFAULT on a bad root — they never throw.
 * Moved verbatim from the original `validation.ts` god-file
 * (codex-002 Phase 2 structural split).
 */

import { z } from "zod";
import type { PriceHistoryResponse } from "../types.js";
import { strDefault, numDefault } from "./_shared.js";

// ── PriceHistory (defaults on bad root — never throws) ─────────────────

const priceHistoryPointSchema = z.unknown().transform((p) => {
  if (typeof p !== "object" || p === null || Array.isArray(p)) return { t: 0, p: 0 };
  const r = p as Record<string, unknown>;
  return { t: typeof r.t === "number" ? r.t : 0, p: typeof r.p === "number" ? r.p : 0 };
});

const priceHistoryResponseSchema = z.object({
  history: z.unknown().transform((v) =>
    Array.isArray(v) ? v.map((p) => priceHistoryPointSchema.parse(p)) : [],
  ),
});

export function validatePriceHistoryResponse(raw: unknown): PriceHistoryResponse {
  const parsed = priceHistoryResponseSchema.safeParse(raw);
  if (!parsed.success) return { history: [] };
  return parsed.data;
}

// ── Scalar market-data responses (default on bad root — never throw) ───

const priceResponseSchema = z.object({ price: numDefault(0) });
export function validatePriceResponse(raw: unknown): { price: number } {
  const parsed = priceResponseSchema.safeParse(raw);
  if (!parsed.success) return { price: 0 };
  return parsed.data;
}

const midpointResponseSchema = z.object({ mid_price: strDefault("0") });
export function validateMidpointResponse(raw: unknown): { mid_price: string } {
  const parsed = midpointResponseSchema.safeParse(raw);
  if (!parsed.success) return { mid_price: "0" };
  return parsed.data;
}

const spreadResponseSchema = z.object({ spread: strDefault("0") });
export function validateSpreadResponse(raw: unknown): { spread: string } {
  const parsed = spreadResponseSchema.safeParse(raw);
  if (!parsed.success) return { spread: "0" };
  return parsed.data;
}

const lastTradePriceResponseSchema = z.object({
  price: strDefault("0.5"),
  side: strDefault(""),
});
export function validateLastTradePriceResponse(raw: unknown): { price: string; side: string } {
  const parsed = lastTradePriceResponseSchema.safeParse(raw);
  if (!parsed.success) return { price: "0.5", side: "" };
  return parsed.data;
}

const tickSizeResponseSchema = z.object({ minimum_tick_size: numDefault(0.01) });
export function validateTickSizeResponse(raw: unknown): { minimum_tick_size: number } {
  const parsed = tickSizeResponseSchema.safeParse(raw);
  if (!parsed.success) return { minimum_tick_size: 0.01 };
  return parsed.data;
}

const feeRateResponseSchema = z.object({ base_fee: numDefault(0) });
export function validateFeeRateResponse(raw: unknown): { base_fee: number } {
  const parsed = feeRateResponseSchema.safeParse(raw);
  if (!parsed.success) return { base_fee: 0 };
  return parsed.data;
}
