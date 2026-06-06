/**
 * Runtime validators for Polymarket Data API responses (Zod rewrite).
 *
 * codex-002 Phase 2 (full uniformity): these gate the SHAPE of positions,
 * activity, trades, holders, leaderboard, and accounting responses at the HTTP
 * boundary before the values feed wallet/position views and bot decisions. The
 * Data API is LENIENT-DEFAULTING at the FIELD level — every field falls back to
 * a safe default (`""`, `0`, `null`, `false`, `[]`) rather than rejecting, so a
 * single malformed field never fails the whole response. The ROOT behaviour is
 * MIXED per validator and preserved exactly:
 *   - array-root list validators (positions, closed positions, activity, trades,
 *     holders, leaderboard, market positions) throw a plain `Error` with the
 *     ORIGINAL message when the root is not an array;
 *   - builder leaderboard / builder volume / open-interest map their element
 *     defaults and NEVER throw (a non-array root collapses to `[]`; per the
 *     original, open-interest still throws on a non-array root);
 *   - live-volume / value / traded NEVER throw and return their scalar default
 *     on a bad root.
 *
 * Numeric note (Zod 4 gotcha): the original `num()` accepts any
 * `typeof v === "number" && !Number.isNaN(v)` (INCLUDING ±Infinity) and the
 * loose `typeof x === "number" ? x : 0` fields ALSO accept NaN. `z.number()`
 * rejects ±Infinity, so it is NOT used here — `numDefault` (NaN-rejecting,
 * Infinity-accepting) and `numLoose` (accepts NaN too) reproduce the two exact
 * original guards.
 *
 * The schemas are intentionally NOT the type source of truth — the wire
 * interfaces in `types.ts` remain canonical, and each exported validator keeps
 * its declared return type so `tsc` verifies the inferred schema output is
 * assignable to that interface. Exported function names, signatures, and return
 * types are preserved so `client.ts` call sites stay unchanged.
 *
 * ── Structural split ──────────────────────────────────────────────────
 * This file is now a BARREL. The validators live in resource modules under
 * `./validation/` (positions / activity-trades / market-stats / leaderboard),
 * with shared lenient primitives single-sourced in `./validation/_shared.ts`.
 * The exported runtime surface is byte-for-byte identical to before the split.
 */

export {
  validatePositionsResponse,
  validateClosedPositionsResponse,
  validateMarketPositionsResponse,
} from "./validation/positions.js";

export {
  validateActivityResponse,
  validateTradesResponse,
} from "./validation/activity-trades.js";

export {
  validateHoldersResponse,
  validateOpenInterestResponse,
  validateLiveVolumeResponse,
  validateValueResponse,
  validateTradedResponse,
} from "./validation/market-stats.js";

export {
  validateLeaderboardResponse,
  validateBuilderLeaderboardResponse,
  validateBuilderVolumeResponse,
} from "./validation/leaderboard.js";
