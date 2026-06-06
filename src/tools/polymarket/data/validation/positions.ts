/**
 * Positions validators for the Polymarket Data API (open / closed / market).
 *
 * Moved VERBATIM from the original `../validation.ts` during the
 * barrel-preserving structural split. Schemas, refines, transforms, error
 * messages, and return types are unchanged. The wire interfaces in
 * `../types.ts` remain the type source of truth.
 */

import { z } from "zod";
import { isRecord } from "../../../../utils/validation-helpers.js";
import type {
  DataPosition, DataClosedPosition,
  DataMarketPositionV1, DataMetaMarketPosition,
} from "../types.js";
import { zOptStrNull, strDefault, numDefault, numLoose, isTrue } from "./_shared.js";

// ── Positions ──────────────────────────────────────────────────────────

const positionSchema: z.ZodType<DataPosition> = z.object({
  proxyWallet: strDefault(),
  asset: strDefault(),
  conditionId: strDefault(),
  size: numDefault(),
  avgPrice: numDefault(),
  initialValue: numDefault(),
  currentValue: numDefault(),
  cashPnl: numDefault(),
  percentPnl: numDefault(),
  totalBought: numDefault(),
  realizedPnl: numDefault(),
  curPrice: numDefault(),
  redeemable: isTrue,
  mergeable: isTrue,
  title: zOptStrNull,
  slug: zOptStrNull,
  eventSlug: zOptStrNull,
  outcome: zOptStrNull,
  outcomeIndex: numLoose(),
  endDate: zOptStrNull,
  negativeRisk: isTrue,
});

export function validatePositionsResponse(raw: unknown): DataPosition[] {
  if (!Array.isArray(raw)) throw new Error("Expected positions array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("position must be an object");
    return positionSchema.parse(r);
  });
}

// ── Closed positions ────────────────────────────────────────────────────

const closedPositionSchema: z.ZodType<DataClosedPosition> = z.object({
  proxyWallet: strDefault(),
  asset: strDefault(),
  conditionId: strDefault(),
  avgPrice: numDefault(),
  totalBought: numDefault(),
  realizedPnl: numDefault(),
  curPrice: numDefault(),
  timestamp: numLoose(),
  title: zOptStrNull,
  slug: zOptStrNull,
  eventSlug: zOptStrNull,
  outcome: zOptStrNull,
  outcomeIndex: numLoose(),
  endDate: zOptStrNull,
});

export function validateClosedPositionsResponse(raw: unknown): DataClosedPosition[] {
  if (!Array.isArray(raw)) throw new Error("Expected closed positions array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("closed position must be an object");
    return closedPositionSchema.parse(r);
  });
}

// ── Market positions (throws on non-array root; per-element default) ────

const marketPositionDefault: DataMarketPositionV1 = {
  proxyWallet: "", name: null, profileImage: null, verified: false, asset: "", conditionId: "",
  avgPrice: 0, size: 0, currPrice: 0, currentValue: 0, cashPnl: 0, totalBought: 0,
  realizedPnl: 0, totalPnl: 0, outcome: null, outcomeIndex: 0,
};
const marketPositionSchema: z.ZodType<DataMarketPositionV1> = z.object({
  proxyWallet: strDefault(),
  name: zOptStrNull,
  profileImage: zOptStrNull,
  verified: isTrue,
  asset: strDefault(),
  conditionId: strDefault(),
  avgPrice: numDefault(),
  size: numDefault(),
  currPrice: numDefault(),
  currentValue: numDefault(),
  cashPnl: numDefault(),
  totalBought: numDefault(),
  realizedPnl: numDefault(),
  totalPnl: numDefault(),
  outcome: zOptStrNull,
  outcomeIndex: numLoose(),
});

const metaMarketPositionDefault: DataMetaMarketPosition = { token: "", positions: [] };
const metaMarketPositionSchema: z.ZodType<DataMetaMarketPosition> = z.object({
  token: strDefault(),
  positions: z.unknown().transform((v) =>
    Array.isArray(v) ? v.map((p) => (isRecord(p) ? marketPositionSchema.parse(p) : marketPositionDefault)) : [],
  ),
});

export function validateMarketPositionsResponse(raw: unknown): DataMetaMarketPosition[] {
  if (!Array.isArray(raw)) throw new Error("Expected market positions array");
  return raw.map((r) => (isRecord(r) ? metaMarketPositionSchema.parse(r) : metaMarketPositionDefault));
}
