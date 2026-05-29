/**
 * Zod response schema for the Jupiter Price API V3 (`/price/v3`).
 *
 * codex-002: this gates the SHAPE of the price response at the HTTP boundary.
 * Price data is not directly signed, but downstream valuation/portfolio math
 * consumes `usdPrice` and `decimals` as real numbers, so those invariants are
 * firmed (finite numbers) rather than left permissive. Display-only fields
 * (`createdAt`) and nullable upstream fields (`blockId`, `priceChange24h`) stay
 * permissive. Each entry `.passthrough()`s unknown keys — the wire interface
 * carries an index signature and Jupiter services forward the raw upstream
 * response, so forward-compatible fields must pass.
 *
 * The schema is intentionally NOT the type source of truth — the wire
 * interfaces in `types.ts` remain canonical, and each client function's
 * declared return type makes `tsc` verify the inferred schema output is
 * assignable to that interface.
 */

import { z } from "zod";

/**
 * A single mint's price entry. Mirrors `JupiterPriceEntry` (types.ts):
 * `usdPrice`/`decimals` feed downstream valuation and atomic-amount math, so
 * they are firmed to finite numbers; `blockId`/`priceChange24h` are
 * upstream-nullable; `createdAt` is a display timestamp. `.passthrough()`
 * mirrors the interface's `[key: string]: unknown` index signature.
 */
const jupiterPriceEntrySchema = z
  .object({
    createdAt: z.string(),
    liquidity: z.number(),
    usdPrice: z.number().finite(),
    blockId: z.number().nullable(),
    decimals: z.number().finite(),
    priceChange24h: z.number().nullable(),
  })
  .passthrough();

/**
 * `/price/v3` returns a record keyed by mint address. An empty object is a
 * valid response — the service maps a missing mint to `found: false`, so the
 * schema must accept `{}` and must not require any particular key.
 */
export const jupiterPriceResponseSchema = z.record(z.string(), jupiterPriceEntrySchema);
