/**
 * VEX TOKEN CARD — COMPACT rail widget (T1, moved off the welcome stage).
 *
 * The full welcome-stage card was pulled to keep the welcome screen clean; the
 * live $VEX signal now rides the sessions rail between BROWSE ALL and the
 * footer registry (`SessionsList`). Same data hook (`useVexMarket`) and the
 * same shared formatters — only the layout is re-flowed for the ~272px rail:
 * a header row [mark · $VEX · price · 24h delta], a tight full-width sparkline,
 * and a 2×2 micro-grid [MCAP / LIQ / 24H VOL / HOLDERS].
 *
 * Speaks the Signal Tape grammar strictly: solid-luminance surface + hairline
 * (never glass/glow), `--vex-*` tokens ONLY (the shell design-guard enforces
 * no raw hexes), font-display numerals with `tabular-nums`, mono micro-labels.
 * The 24h delta is a SEMANTIC status tone (success up / danger down), which the
 * theme deliberately leaves untouched — so it stays a bordered tint on ink in
 * both themes and never needs the accent-contrast flip.
 *
 * Every state resolves to a visible surface so the rail is never blank —
 * loading skeleton, error line, stale marker, or the data card.
 */

import type { JSX } from "react";
import type { VexMarketSnapshot } from "@shared/schemas/market.js";
import { useVexMarket } from "../../../lib/api/market.js";
import { cn } from "../../../lib/utils.js";
import {
  formatCompactCount,
  formatPercentDelta,
  formatTokenPriceUsd,
  formatUsd,
} from "../../../lib/format.js";

const CARD_CLASS =
  "rounded-xl border border-[var(--vex-line)] bg-[var(--vex-surface-1)] px-3 py-2.5";

export function VexTokenCardCompact(): JSX.Element {
  const query = useVexMarket();
  const result = query.data;
  const snapshot = result?.ok ? result.data : null;

  // Bridge/handler error → a boxed line, never a blank rail.
  if ((result !== undefined && !result.ok) || query.isError) {
    return (
      <section
        data-vex-area="vex-token-compact"
        data-state="error"
        aria-label="VEX market data unavailable"
        className={CARD_CLASS}
      >
        <div className="flex items-center gap-2">
          <VexMark />
          <div className="flex min-w-0 flex-col">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
              $VEX
            </span>
            <span className="text-[11px] text-[var(--vex-warn-text)]">
              Market data unavailable.
            </span>
          </div>
        </div>
      </section>
    );
  }

  // First read (isLoading) OR polled-but-not-yet (`ok(null)`) → skeleton.
  if (snapshot === null) {
    return (
      <section
        data-vex-area="vex-token-compact"
        data-state="loading"
        aria-label="Loading VEX price"
        className={CARD_CLASS}
      >
        <div className="flex items-center gap-2">
          <VexMark />
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
              $VEX
            </span>
            <span
              aria-hidden
              className="h-4 w-20 animate-pulse rounded bg-[var(--vex-line-strong)]"
            />
          </div>
        </div>
      </section>
    );
  }

  return <CompactBody snapshot={snapshot} />;
}

function CompactBody({
  snapshot,
}: {
  readonly snapshot: VexMarketSnapshot;
}): JSX.Element {
  const priceLabel = formatTokenPriceUsd(snapshot.priceUsd);
  const deltaLabel = formatPercentDelta(snapshot.priceChange.h24);
  const closes = snapshot.sparkline.map((point) => point[1]);

  return (
    <section
      data-vex-area="vex-token-compact"
      data-state="data"
      data-stale={snapshot.stale ? "true" : "false"}
      aria-label={`VEX token price ${priceLabel}, 24 hour change ${deltaLabel}${
        snapshot.stale ? ", data delayed" : ""
      }`}
      className={CARD_CLASS}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <VexMark />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
              $VEX
              {snapshot.stale ? <StaleMarker /> : null}
            </span>
            <span className="truncate font-display text-[15px] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-[var(--vex-text)]">
              {priceLabel}
            </span>
          </div>
        </div>
        <DeltaBadge change={snapshot.priceChange.h24} label={deltaLabel} />
      </div>

      <Sparkline closes={closes} />

      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[var(--vex-line)] pt-2.5">
        <Stat label="MCAP" value={formatUsd(snapshot.marketCap)} />
        <Stat label="LIQ" value={formatUsd(snapshot.liquidityUsd)} />
        <Stat label="24H VOL" value={formatUsd(snapshot.volumeH24)} />
        <Stat
          label="HOLDERS"
          value={
            snapshot.holderCount === null
              ? "—"
              : formatCompactCount(snapshot.holderCount)
          }
        />
      </div>
    </section>
  );
}

/** The bundled VEX token logo — provenance: Virtuals CDN (committed once). */
function VexMark(): JSX.Element {
  return (
    <img
      src="/logo/vex-token.png"
      alt="VEX token"
      className="h-6 w-6 shrink-0 rounded-full"
    />
  );
}

function StaleMarker(): JSX.Element {
  return (
    <span
      data-vex-area="vex-token-stale"
      className="flex items-center gap-1 text-[var(--vex-text-3)]"
      title="Live feed delayed — showing the last known price."
    >
      <span
        aria-hidden
        className="h-[5px] w-[5px] rounded-full bg-[var(--vex-pin)]"
      />
      delayed
    </span>
  );
}

/**
 * 24h delta pill — a bordered tint in the SEMANTIC status tone (up = success,
 * down = danger, flat/null = muted). Status colours are a product contract the
 * theme never re-tints, so this reads on ink in both cobalt and Robinhood modes
 * and stays independent of the brand accent.
 */
function DeltaBadge({
  change,
  label,
}: {
  readonly change: number | null;
  readonly label: string;
}): JSX.Element {
  const up = change !== null && Number.isFinite(change) && change > 0;
  const down = change !== null && Number.isFinite(change) && change < 0;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-[5px] border px-1.5 py-px font-mono text-[10px] tabular-nums",
        up &&
          "border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] text-[var(--color-success)]",
        down &&
          "border-[color-mix(in_oklab,var(--vex-warn-text)_40%,transparent)] text-[var(--vex-warn-text)]",
        !up &&
          !down &&
          "border-[var(--vex-line-strong)] text-[var(--vex-text-3)]",
      )}
    >
      {label}
    </span>
  );
}

function Stat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        {label}
      </span>
      <span className="truncate font-mono text-[11px] tabular-nums text-[var(--vex-text-2)]">
        {value}
      </span>
    </div>
  );
}

/**
 * Full-width rail sparkline — a single 2px accent path over the trailing hourly
 * closes, stretched edge-to-edge (preserveAspectRatio="none" + non-scaling
 * stroke keep the line crisp while the x-axis fills the rail). Fewer than two
 * finite points → a blank reserved track (graceful empty state, never blank).
 */
function Sparkline({
  closes,
}: {
  readonly closes: readonly number[];
}): JSX.Element {
  const W = 240;
  const H = 32;
  const PAD = 2;
  const points = closes.filter((v) => Number.isFinite(v));

  if (points.length < 2) {
    return (
      <div
        data-vex-area="vex-token-sparkline"
        data-empty="true"
        aria-hidden
        className="mt-2 h-8 w-full"
      />
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = (W - PAD * 2) / (points.length - 1);
  const y = (v: number): number => PAD + (H - PAD * 2) * (1 - (v - min) / span);

  const d = points
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${(PAD + i * stepX).toFixed(2)} ${y(v).toFixed(2)}`,
    )
    .join(" ");

  return (
    <svg
      data-vex-area="vex-token-sparkline"
      data-empty="false"
      aria-hidden
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-2 h-8 w-full"
    >
      <path
        d={d}
        fill="none"
        stroke="var(--vex-accent)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
