/**
 * Token profile validator.
 *
 * Strict `parseProfile` plus the `validateProfilesResponse` array validator.
 * `parseProfile` is re-used by the WS handshake (`validateWsProfile`). Moved
 * VERBATIM from the original `validation.ts`.
 */

import { z } from "zod";
import { VexError, ErrorCodes } from "../../../errors.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import type { DexProfileUpdate, DexTokenProfile } from "../types.js";
import { asOptionalString, asString, linksSchema, parseOrThrow, strDefault } from "./_shared.js";

const profileObjectSchema: z.ZodType<DexTokenProfile> = z
  .object({
    url: asString("profile.url"),
    chainId: asString("profile.chainId"),
    tokenAddress: asString("profile.tokenAddress"),
    icon: strDefault(""),
    header: asOptionalString,
    description: asOptionalString,
    links: linksSchema,
  })
  .transform((p) => ({
    url: p.url,
    chainId: p.chainId,
    tokenAddress: p.tokenAddress,
    icon: p.icon,
    header: p.header,
    description: p.description,
    links: p.links,
  }));

export function parseProfile(raw: unknown): DexTokenProfile {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: profile must be an object");
  }
  return parseOrThrow(profileObjectSchema, raw);
}

export function validateProfilesResponse(raw: unknown): DexTokenProfile[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected profiles array");
  }
  return raw.map(parseProfile);
}

// ── Recent-updates feed (TOLERANT — live but undocumented) ──────────
//
// `/token-profiles/recent-updates/v1` is a profile-shaped feed enriched with
// `updatedAt` (ISO 8601) and a `cto` flag. It is absent from the official
// reference, so this parser is tolerant: unknown fields pass through, missing /
// wrong-typed fields normalise to `null`, a non-record row is dropped, and a
// non-array root yields `[]` — schema drift degrades to "no data" rather than a
// throw (namespace-level "feed unavailable" is surfaced by the handler).

/** One recent-updates row. Non-record → `null` so callers can filter it out. */
function parseProfileUpdate(raw: unknown): DexProfileUpdate | null {
  if (!isRecord(raw)) return null;
  return {
    url: strDefault("").parse(raw.url),
    chainId: strDefault("").parse(raw.chainId),
    tokenAddress: strDefault("").parse(raw.tokenAddress),
    icon: strDefault("").parse(raw.icon),
    header: asOptionalString.parse(raw.header),
    description: asOptionalString.parse(raw.description),
    links: linksSchema.parse(raw.links),
    updatedAt: asOptionalString.parse(raw.updatedAt),
    cto: typeof raw.cto === "boolean" ? raw.cto : null,
  };
}

export function validateProfilesRecentResponse(raw: unknown): DexProfileUpdate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseProfileUpdate).filter((p): p is DexProfileUpdate => p !== null);
}
