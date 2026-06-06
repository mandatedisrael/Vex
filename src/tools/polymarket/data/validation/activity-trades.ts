/**
 * Activity + trades validators for the Polymarket Data API.
 *
 * Moved VERBATIM from the original `../validation.ts` during the
 * barrel-preserving structural split. Schemas, refines, transforms, error
 * messages, and return types are unchanged. The wire interfaces in
 * `../types.ts` remain the type source of truth.
 */

import { z } from "zod";
import { isRecord } from "../../../../utils/validation-helpers.js";
import type { DataActivity, DataTrade } from "../types.js";
import { zOptStrNull, strDefault, numDefault, numLoose } from "./_shared.js";

// ── Resource-local side guards ──────────────────────────────────────────

/** `side === "BUY" || side === "SELL" ? side : null` (activity side). */
const activitySideSchema = z
  .unknown()
  .transform((v) => (v === "BUY" || v === "SELL" ? v : null));

/** `side === "SELL" ? "SELL" : "BUY"` (trade side). */
const tradeSideSchema = z.unknown().transform((v) => (v === "SELL" ? "SELL" : "BUY"));

// ── Activity ────────────────────────────────────────────────────────────

const activitySchema: z.ZodType<DataActivity> = z.object({
  proxyWallet: strDefault(),
  timestamp: numLoose(),
  conditionId: strDefault(),
  // Original: `str(r.type, "TRADE") as DataActivity["type"]` — any string passes
  // through (cast), missing/non-string -> "TRADE". Preserve the loose cast.
  type: z
    .unknown()
    .transform((v) => (typeof v === "string" ? v : "TRADE") as DataActivity["type"]),
  size: numDefault(),
  usdcSize: numDefault(),
  price: numDefault(),
  asset: strDefault(),
  side: activitySideSchema,
  outcomeIndex: numLoose(),
  title: zOptStrNull,
  slug: zOptStrNull,
  outcome: zOptStrNull,
  transactionHash: zOptStrNull,
});

export function validateActivityResponse(raw: unknown): DataActivity[] {
  if (!Array.isArray(raw)) throw new Error("Expected activity array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("activity must be an object");
    return activitySchema.parse(r);
  });
}

// ── Trades ──────────────────────────────────────────────────────────────

const tradeSchema: z.ZodType<DataTrade> = z.object({
  proxyWallet: strDefault(),
  side: tradeSideSchema,
  asset: strDefault(),
  conditionId: strDefault(),
  size: numDefault(),
  price: numDefault(),
  timestamp: numLoose(),
  title: zOptStrNull,
  slug: zOptStrNull,
  outcome: zOptStrNull,
  outcomeIndex: numLoose(),
  transactionHash: zOptStrNull,
  name: zOptStrNull,
  pseudonym: zOptStrNull,
  profileImage: zOptStrNull,
});

export function validateTradesResponse(raw: unknown): DataTrade[] {
  if (!Array.isArray(raw)) throw new Error("Expected trades array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("trade must be an object");
    return tradeSchema.parse(r);
  });
}
