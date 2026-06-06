/**
 * Trade-resource CLOB validators: ClobTrade / paginated-trades responses.
 * Moved verbatim from the original `validation.ts` god-file
 * (codex-002 Phase 2 structural split).
 */

import { z } from "zod";
import type { ClobTrade, PaginatedTrades } from "../types.js";
import { strDefault, numDefault, asOptionalString, openOrderSideSchema } from "./_shared.js";

// ── ClobTrade ──────────────────────────────────────────────────────────

const traderSideSchema = z.unknown().transform((v) => (v === "MAKER" ? "MAKER" : "TAKER"));

const clobTradeSchema = z.object({
  id: strDefault(""),
  taker_order_id: strDefault(""),
  market: strDefault(""),
  asset_id: strDefault(""),
  side: openOrderSideSchema,
  size: strDefault("0"),
  fee_rate_bps: strDefault("0"),
  price: strDefault("0"),
  status: strDefault(""),
  match_time: strDefault(""),
  last_update: strDefault(""),
  outcome: strDefault(""),
  owner: strDefault(""),
  maker_address: strDefault(""),
  // `asOptionalString(raw.transaction_hash) ?? null` → non-empty string | null.
  transaction_hash: asOptionalString.transform((v) => v ?? null),
  trader_side: traderSideSchema,
});

function parseClobTrade(raw: unknown): ClobTrade {
  const parsed = clobTradeSchema.safeParse(raw);
  if (!parsed.success) throw new Error("trade must be an object");
  return parsed.data;
}

const paginatedTradesSchema = z.object({
  limit: numDefault(100),
  next_cursor: strDefault(""),
  count: numDefault(0),
  data: z.unknown().transform((v) => (Array.isArray(v) ? v.map(parseClobTrade) : [])),
});

export function validatePaginatedTrades(raw: unknown): PaginatedTrades {
  const parsed = paginatedTradesSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected paginated trades");
  return parsed.data;
}
