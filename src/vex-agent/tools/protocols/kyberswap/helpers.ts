/**
 * KyberSwap protocol-handler presentation helpers.
 *
 * Single source of truth for projecting the verbose aggregator route summary
 * into the compact, agent-facing shape surfaced by swap.quote / swap dryRun.
 * Those are read-only surfaces (no `_tradeCapture` to preserve), so both the
 * `output` and `data` carry only the PROJECTED `routeSummary` — the verbose
 * provider route/pool internals (poolExtra/extra/routeID/checksum/...) are
 * dropped, not retained in `data`. The model never sees internals it cannot act
 * on. Keep this pure and deterministic — no IO, no throws on bad numbers.
 */

import type { SwapRouteSummary } from "@tools/kyberswap/aggregator/types.js";

/** Compact, agent-facing projection of a KyberSwap aggregator route summary. */
export interface FormattedRouteSummary {
  readonly amountOut: string;
  readonly amountOutUsd: string;
  readonly amountIn: string;
  readonly amountInUsd: string;
  readonly gasUsd: string;
  /**
   * Fractional price impact derived from USD legs:
   *   (amountInUsd - amountOutUsd) / amountInUsd
   * Same fraction convention as zapDetails.priceImpact (0.0015 = 0.15%).
   * `null` when the input-USD denominator is 0 or non-finite (guarded).
   */
  readonly priceImpact: number | null;
  /** Number of non-null route hops across all paths in the route matrix. */
  readonly routeHops: number;
}

/**
 * Parse a USD string into a finite number, or `null` when it is missing,
 * empty, or not a finite number. Defensive: the provider value is untrusted
 * text and must never throw here.
 */
function parseUsd(value: string | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Safely derive fractional price impact from the USD legs.
 *
 * Returns `null` when either leg is unparseable OR the input-USD denominator
 * is 0 (division-by-zero guard) — callers surface `null` rather than NaN/Inf.
 */
function derivePriceImpact(amountInUsd: string, amountOutUsd: string): number | null {
  const inUsd = parseUsd(amountInUsd);
  const outUsd = parseUsd(amountOutUsd);
  if (inUsd === null || outUsd === null) return null;
  if (inUsd === 0) return null; // guard division-by-zero
  return (inUsd - outUsd) / inUsd;
}

/**
 * Count non-null route hops across the route matrix.
 *
 * `route` is `SwapRouteStep[][]` (paths × steps). The depth we surface is the
 * total number of non-null steps across every path. Defensive against a
 * malformed/absent `route` (treated as 0 hops) since the value is untrusted.
 */
function countRouteHops(route: SwapRouteSummary["route"] | undefined): number {
  if (!Array.isArray(route)) return 0;
  let hops = 0;
  for (const path of route) {
    if (!Array.isArray(path)) continue;
    for (const step of path) {
      if (step != null) hops += 1;
    }
  }
  return hops;
}

/**
 * Project a verbose aggregator route summary to the compact agent-facing shape.
 *
 * Drops route/poolExtra/extra/routeID/checksum/tokenIn/tokenOut/l1FeeUsd/
 * extraFee/gas/gasPrice — none are actionable for the model and they bloat the
 * tool-output budget. Derives a guarded fractional price impact and a route-hop
 * count. Pure: never throws, never performs IO.
 */
export function formatRouteSummary(s: SwapRouteSummary): FormattedRouteSummary {
  return {
    amountOut: s.amountOut,
    amountOutUsd: s.amountOutUsd,
    amountIn: s.amountIn,
    amountInUsd: s.amountInUsd,
    gasUsd: s.gasUsd,
    priceImpact: derivePriceImpact(s.amountInUsd, s.amountOutUsd),
    routeHops: countRouteHops(s.route),
  };
}
