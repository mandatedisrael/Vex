/**
 * Leaderboard validators for the Polymarket Data API:
 * leaderboard, builder leaderboard, and builder volume.
 *
 * Moved VERBATIM from the original `../validation.ts` during the
 * barrel-preserving structural split. Schemas, refines, transforms, error
 * messages, and return types are unchanged. The wire interfaces in
 * `../types.ts` remain the type source of truth.
 */

import { z } from "zod";
import { isRecord } from "../../../../utils/validation-helpers.js";
import type {
  DataLeaderboardEntry, DataBuilderEntry, DataBuilderVolumeEntry,
} from "../types.js";
import { zOptStrNull, strDefault, numDefault, numLoose, isTrue } from "./_shared.js";

// ── Leaderboard (throws on non-array root) ──────────────────────────────

const leaderboardEntrySchema: z.ZodType<DataLeaderboardEntry> = z.object({
  rank: strDefault(),
  proxyWallet: strDefault(),
  userName: zOptStrNull,
  vol: numDefault(),
  pnl: numDefault(),
  profileImage: zOptStrNull,
  xUsername: zOptStrNull,
  verifiedBadge: isTrue,
});

export function validateLeaderboardResponse(raw: unknown): DataLeaderboardEntry[] {
  if (!Array.isArray(raw)) throw new Error("Expected leaderboard array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("leaderboard entry must be an object");
    return leaderboardEntrySchema.parse(r);
  });
}

// ── Builder leaderboard (never throws; [] on bad root) ──────────────────

const builderEntryDefault: DataBuilderEntry = {
  rank: "", builder: "", volume: 0, activeUsers: 0, verified: false, builderLogo: null,
};
const builderEntrySchema: z.ZodType<DataBuilderEntry> = z.object({
  rank: strDefault(),
  builder: strDefault(),
  volume: numDefault(),
  activeUsers: numLoose(),
  verified: isTrue,
  builderLogo: zOptStrNull,
});

export function validateBuilderLeaderboardResponse(raw: unknown): DataBuilderEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => (isRecord(r) ? builderEntrySchema.parse(r) : builderEntryDefault));
}

// ── Builder volume (never throws; [] on bad root) ──────────────────────

const builderVolumeDefault: DataBuilderVolumeEntry = {
  dt: "", builder: "", builderLogo: null, verified: false, volume: 0, activeUsers: 0, rank: "",
};
const builderVolumeSchema: z.ZodType<DataBuilderVolumeEntry> = z.object({
  dt: strDefault(),
  builder: strDefault(),
  builderLogo: zOptStrNull,
  verified: isTrue,
  volume: numDefault(),
  activeUsers: numLoose(),
  rank: strDefault(),
});

export function validateBuilderVolumeResponse(raw: unknown): DataBuilderVolumeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => (isRecord(r) ? builderVolumeSchema.parse(r) : builderVolumeDefault));
}
