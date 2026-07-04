/**
 * Shared display formatters for the BOOK panel (and beyond).
 *
 * `truncateAddress` is the single canonical address shortener — the redesign
 * plan referenced a `maskHex` that never existed, and four near-identical
 * private copies live across the renderer (AddressDisplay, ExportWalletPicker,
 * SessionWalletSelect, polymarket). Those can be migrated to this helper in a
 * follow-up cleanup; new BOOK code uses this one.
 */

const ADDR_PREFIX = 6;
const ADDR_SUFFIX = 4;

/** `0x1234…abcd` — 6 from the start, 4 from the end; short strings pass through. */
export function truncateAddress(address: string): string {
  if (address.length <= ADDR_PREFIX + ADDR_SUFFIX + 1) return address;
  return `${address.slice(0, ADDR_PREFIX)}…${address.slice(-ADDR_SUFFIX)}`;
}

/**
 * Compact USD for instrument readouts: `$0.00`, `$9.84`, `$1.2K`, `$3.4M`.
 * `null`/non-finite → an em dash so a missing snapshot never prints `$NaN`.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/** Local HH:MM for a tape/feed timestamp; `null` for an unparseable value. */
export function formatClock(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Signed compact USD for PnL: `+$12.30` / `-$4.00` / `—`. */
export function formatUsdDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

/**
 * Adaptive USD for a token SPOT price, where `formatUsd`'s 2-decimal rounding
 * would collapse a sub-cent token (e.g. VEX at ~$0.00054) to `$0.00`.
 * `>=1` → 2 decimals; `>=0.01` → 4 decimals; below that → enough decimals to
 * keep ~4 significant figures (`$0.0005430`). `null`/non-finite → em dash.
 */
export function formatTokenPriceUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  if (value === 0) return "$0.00";
  const abs = Math.abs(value);
  if (abs >= 1) return `$${value.toFixed(2)}`;
  if (abs >= 0.01) return `$${value.toFixed(4)}`;
  const decimals = Math.min(12, Math.ceil(-Math.log10(abs)) + 3);
  return `$${value.toFixed(decimals)}`;
}

/** Signed percent for a price-change readout: `+113.00%` / `-1.73%` / `—`. */
export function formatPercentDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

/** Compact integer for counts: `354`, `1.2K`, `3.4M`. `null`/non-finite → em dash. */
export function formatCompactCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.trunc(value)}`;
}
