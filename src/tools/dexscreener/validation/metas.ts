/**
 * Metas / narrative validators (TOLERANT — live but undocumented endpoints).
 *
 * `/metas/trending/v1` and `/metas/meta/v1/{slug}` are live-verified but absent
 * from the official DexScreener reference, so their shape can drift without
 * notice. These validators are deliberately tolerant: unknown fields pass
 * through (are ignored), missing / wrong-typed fields normalise to `null`, and
 * a non-array / non-object root yields an empty feed / `null` rather than a
 * throw. That way schema drift degrades to "no data" and the namespace-level
 * handler can surface a clean "feed unavailable" result instead of crashing.
 *
 * The detail endpoint's `pairs` reuse the canonical strict `parsePair` element
 * wise (each wrapped in try/catch) so a single malformed pair is skipped rather
 * than duplicating the lenient pair sub-parsers here.
 */

import type { DexMeta, DexMetaDetail, DexMetaIcon, DexMetaWindows, DexPair } from "../types.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import { asOptionalNumber, asOptionalString } from "./_shared.js";
import { parsePair } from "./pairs.js";

/** Timeframe windows (m5/h1/h6/h24) → all-nullable numbers. Non-record → null. */
function parseWindows(raw: unknown): DexMetaWindows | null {
  if (!isRecord(raw)) return null;
  return {
    m5: asOptionalNumber.parse(raw.m5),
    h1: asOptionalNumber.parse(raw.h1),
    h6: asOptionalNumber.parse(raw.h6),
    h24: asOptionalNumber.parse(raw.h24),
  };
}

/** `{ type, value }` icon (e.g. `{type:"emoji", value:"🎨"}`). Non-record → null. */
function parseIcon(raw: unknown): DexMetaIcon | null {
  if (!isRecord(raw)) return null;
  return {
    type: asOptionalString.parse(raw.type),
    value: asOptionalString.parse(raw.value),
  };
}

/** One narrative row (no pairs). Non-record → null so callers can filter it out. */
function parseMeta(raw: unknown): DexMeta | null {
  if (!isRecord(raw)) return null;
  return {
    slug: asOptionalString.parse(raw.slug),
    name: asOptionalString.parse(raw.name),
    description: asOptionalString.parse(raw.description),
    icon: parseIcon(raw.icon),
    marketCap: asOptionalNumber.parse(raw.marketCap),
    liquidity: asOptionalNumber.parse(raw.liquidity),
    volume: asOptionalNumber.parse(raw.volume),
    tokenCount: asOptionalNumber.parse(raw.tokenCount),
    marketCapChange: parseWindows(raw.marketCapChange),
    marketCapDelta: parseWindows(raw.marketCapDelta),
  };
}

/** `/metas/trending/v1` — array of trending narratives. Non-array → `[]`. */
export function validateMetasTrendingResponse(raw: unknown): DexMeta[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseMeta).filter((m): m is DexMeta => m !== null);
}

/**
 * `/metas/meta/v1/{slug}` — one narrative plus its DEX pairs. Non-object root →
 * `null`. Pairs are parsed with the strict `parsePair`; a malformed pair is
 * skipped (not fatal) so a partial feed still returns.
 */
export function validateMetaDetailResponse(raw: unknown): DexMetaDetail | null {
  const base = parseMeta(raw);
  if (!base || !isRecord(raw)) return null;
  const pairs: DexPair[] = Array.isArray(raw.pairs)
    ? raw.pairs
        .map((p) => {
          try {
            return parsePair(p);
          } catch {
            return null;
          }
        })
        .filter((p): p is DexPair => p !== null)
    : [];
  return { ...base, pairs };
}
