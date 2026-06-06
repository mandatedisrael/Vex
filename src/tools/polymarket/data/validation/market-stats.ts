/**
 * Market-stats validators for the Polymarket Data API:
 * holders, open interest, live volume, value, and traded.
 *
 * Moved VERBATIM from the original `../validation.ts` during the
 * barrel-preserving structural split. Schemas, refines, transforms, error
 * messages, and return types are unchanged. The wire interfaces in
 * `../types.ts` remain the type source of truth.
 */

import { z } from "zod";
import { isRecord } from "../../../../utils/validation-helpers.js";
import type {
  DataHolder, DataMetaHolder, DataOpenInterest, DataLiveVolume,
} from "../types.js";
import { zOptStrNull, strDefault, numDefault, numLoose, isTrue } from "./_shared.js";

// ── Holders ─────────────────────────────────────────────────────────────

// Default for a non-record holder element (matches the original's inline default).
const holderDefault: DataHolder = {
  proxyWallet: "", bio: null, asset: "", pseudonym: null, amount: 0,
  displayUsernamePublic: false, outcomeIndex: 0, name: null, profileImage: null,
};

const holderSchema: z.ZodType<DataHolder> = z.object({
  proxyWallet: strDefault(),
  bio: zOptStrNull,
  asset: strDefault(),
  pseudonym: zOptStrNull,
  amount: numDefault(),
  displayUsernamePublic: isTrue,
  outcomeIndex: numLoose(),
  name: zOptStrNull,
  profileImage: zOptStrNull,
});

const metaHolderSchema: z.ZodType<DataMetaHolder> = z.object({
  token: strDefault(),
  // Non-array -> []; array -> element-mapped: non-record element -> holderDefault.
  holders: z.unknown().transform((v) =>
    Array.isArray(v) ? v.map((h) => (isRecord(h) ? holderSchema.parse(h) : holderDefault)) : [],
  ),
});

export function validateHoldersResponse(raw: unknown): DataMetaHolder[] {
  if (!Array.isArray(raw)) throw new Error("Expected holders array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("meta holder must be an object");
    return metaHolderSchema.parse(r);
  });
}

// ── Open interest (throws on non-array root; per-element default) ───────

const openInterestDefault: DataOpenInterest = { market: "", value: 0 };
const openInterestSchema: z.ZodType<DataOpenInterest> = z.object({
  market: strDefault(),
  value: numDefault(),
});

export function validateOpenInterestResponse(raw: unknown): DataOpenInterest[] {
  if (!Array.isArray(raw)) throw new Error("Expected OI array");
  return raw.map((r) => (isRecord(r) ? openInterestSchema.parse(r) : openInterestDefault));
}

// ── Live volume (never throws; default on bad root/first element) ───────

const liveVolumeMarketSchema = z.object({
  market: strDefault(),
  value: numDefault(),
});

export function validateLiveVolumeResponse(raw: unknown): DataLiveVolume {
  if (!Array.isArray(raw) || !isRecord(raw[0])) return { total: 0, markets: [] };
  const r = raw[0];
  return {
    total: numDefault().parse(r.total),
    markets: Array.isArray(r.markets)
      ? r.markets.map((m) => (isRecord(m) ? liveVolumeMarketSchema.parse(m) : { market: "", value: 0 }))
      : [],
  };
}

// ── Value / traded scalars (never throw) ────────────────────────────────

export function validateValueResponse(raw: unknown): { user: string; value: number } {
  if (Array.isArray(raw) && isRecord(raw[0])) {
    return { user: strDefault().parse(raw[0].user), value: numDefault().parse(raw[0].value) };
  }
  if (isRecord(raw)) return { user: strDefault().parse(raw.user), value: numDefault().parse(raw.value) };
  return { user: "", value: 0 };
}

export function validateTradedResponse(raw: unknown): { user: string; traded: number } {
  if (isRecord(raw)) return { user: strDefault().parse(raw.user), traded: numLoose().parse(raw.traded) };
  return { user: "", traded: 0 };
}
