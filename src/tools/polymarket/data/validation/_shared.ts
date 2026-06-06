/**
 * Shared lenient field primitives for the Polymarket Data API validators.
 *
 * Extracted VERBATIM from the original `../validation.ts` (codex-002 Phase 2)
 * during the barrel-preserving structural split. These mirror the hand-written
 * guards exactly and are the SINGLE source for every resource module under
 * `./` — they must never be duplicated.
 *
 * Numeric note (Zod 4 gotcha): `numDefault` (NaN-rejecting, Infinity-accepting)
 * and `numLoose` (accepts NaN too) reproduce the two exact original guards and
 * stay DISTINCT — their semantics differ, do not merge them.
 */

import { z } from "zod";
import { zOptionalString } from "../../../../utils/zod-validation-helpers.js";

// ── Lenient field primitives (mirror the hand-written guards exactly) ──
//
// `zOptStrNull` reproduces `asOptionalString(x) ?? null`: a non-empty string
// passes through, everything else becomes `null`.
export const zOptStrNull = zOptionalString.transform((v) => v ?? null);

/** `str(v, def)`: `typeof v === "string" ? v : def` (accepts empty string). */
export const strDefault = (def = "") =>
  z.unknown().transform((v) => (typeof v === "string" ? v : def));

/**
 * `num(v, def)`: `typeof v === "number" && !Number.isNaN(v) ? v : def`.
 * Accepts ±Infinity, rejects NaN — NOT `z.number()`.
 */
export const numDefault = (def = 0) =>
  z.unknown().transform((v) => (typeof v === "number" && !Number.isNaN(v) ? v : def));

/**
 * Loose numeric guard `typeof x === "number" ? x : def` — used by the original
 * for `outcomeIndex`, `timestamp`, `activeUsers`, and `traded`. This ACCEPTS
 * NaN (no `Number.isNaN` check), so it must stay distinct from `numDefault`.
 */
export const numLoose = (def = 0) =>
  z.unknown().transform((v) => (typeof v === "number" ? v : def));

/** `v === true` — only the literal boolean `true` is truthy. */
export const isTrue = z.unknown().transform((v) => v === true);
