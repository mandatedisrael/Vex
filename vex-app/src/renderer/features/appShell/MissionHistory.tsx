/**
 * Mission History — a read-only AppShell sub-view (mission-results-ledger,
 * WP-J). Per-wallet ledger of finalized mission runs: a summary register
 * (total missions, win rate, cumulative ETH PnL) then one row per mission,
 * newest first. Mirrors the MemoryPanel shell grammar (h-12 register header
 * + back key, hairline-separated ledger, `--vex-*` ink) so it reads as one
 * surface with the rest of the desk.
 *
 * The ledger is EVM/ETH-specific (bankroll = native ETH + WETH), so this
 * reads the PRIMARY EVM wallet from the inventory — never every wallet.
 *
 * All arithmetic + formatting lives in `missionHistoryModel.ts`; this file
 * is presentation over derived values. Naming: "mission result (ETH)" —
 * never "performance".
 */

import type { JSX } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import type { Result } from "@shared/ipc/result.js";
import type { MissionListResultsResult, MissionResultDto } from "@shared/schemas/mission.js";
import { useUiStore } from "../../stores/uiStore.js";
import { useMissionResults } from "../../lib/api/mission.js";
import { useAvailableWallets } from "../../lib/api/wallet-inventory.js";
import { formatPercentDelta, formatUsd } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { Empty, ErrorState, Loading } from "./MemoryPanelShared.js";
import { OutcomeBadge } from "./OutcomeBadge.js";
import {
  EM_DASH,
  computeWinRate,
  formatDurationS,
  formatEth,
  missionDisplayOutcome,
  pnlUsd,
  sumPnlEth,
} from "./missionHistoryModel.js";

export function MissionHistory(): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const walletsQuery = useAvailableWallets();
  const primaryWallet =
    walletsQuery.data && walletsQuery.data.ok ? (walletsQuery.data.data.evm[0] ?? null) : null;
  const resultsQuery = useMissionResults(primaryWallet?.address ?? null);

  return (
    <div
      data-vex-screen="missionHistory"
      className="flex h-full min-h-0 flex-col text-foreground"
    >
      {/* Register header — same h-12 datum + quiet back key as the Memory
       * panel; the affordance is an icon, never a chrome pill. */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--vex-line)] px-6">
        <button
          type="button"
          onClick={() => setAppShellView("session")}
          aria-label="Back to chat"
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--vex-text-2)] transition-colors hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={17} aria-hidden />
        </button>
        <h1 className="font-mono text-[13px] font-medium uppercase tracking-[0.3em] text-foreground">
          Missions
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
          {primaryWallet === null ? (
            <Empty label="No wallet available — add a wallet to see mission history." />
          ) : (
            <Body query={resultsQuery} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Query-state fork: pending -> loading, thrown/transport error OR an
 * `ok:false` Result envelope -> error, empty array -> friendly empty state,
 * else the ledger.
 */
function Body({
  query,
}: {
  readonly query: UseQueryResult<Result<MissionListResultsResult>>;
}): JSX.Element {
  if (query.isPending) return <Loading label="Loading missions…" />;
  if (query.isError) return <ErrorState message={query.error.message} />;
  const res = query.data;
  if (!res.ok) return <ErrorState message={res.error.message} />;
  if (res.data.length === 0) {
    return <Empty label="No missions yet — finish a mission to see it here." />;
  }
  return <Ledger results={res.data} />;
}

function Ledger({ results }: { readonly results: readonly MissionResultDto[] }): JSX.Element {
  const winRate = computeWinRate(results);
  const cumulative = sumPnlEth(results);

  return (
    <>
      <SummaryHeader total={results.length} winRate={winRate} cumulativeEth={cumulative} />
      <ResultsTable results={results} />
    </>
  );
}

function SummaryHeader({
  total,
  winRate,
  cumulativeEth,
}: {
  readonly total: number;
  readonly winRate: number | null;
  readonly cumulativeEth: number;
}): JSX.Element {
  return (
    <section className="flex flex-wrap items-end gap-x-10 gap-y-4 border-b border-[var(--vex-line)] pb-6">
      <Stat label="Missions" value={String(total)} />
      <Stat label="Win rate" value={winRate === null ? EM_DASH : `${winRate.toFixed(0)}%`} />
      <Stat
        label="Cumulative PnL"
        value={`${formatEth(cumulativeEth, { signed: true })} ETH`}
        tone={pnlTone(cumulativeEth)}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
        {label}
      </span>
      <span className={cn("font-mono text-lg tabular-nums", tone ?? "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

function ResultsTable({
  results,
}: {
  readonly results: readonly MissionResultDto[];
}): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--vex-line)] font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
            <Th>#</Th>
            <Th>Goal</Th>
            <Th>Outcome</Th>
            <Th align="right">Duration</Th>
            <Th align="right">Trades</Th>
            <Th align="right">PnL (ETH)</Th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <ResultRow key={r.missionRunId} result={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultRow({ result }: { readonly result: MissionResultDto }): JSX.Element {
  const usd = pnlUsd(result.pnlEth, result.ethPriceUsdEnd);
  const pnlTitle = usd === null ? undefined : `${formatUsd(usd)} at close`;

  return (
    <tr className="border-b border-[var(--vex-line)] last:border-b-0 hover:bg-white/[0.02]">
      <td className="py-2.5 pr-3 font-mono tabular-nums text-[var(--vex-text-2)]">
        #{result.seqNo}
      </td>
      <td className="max-w-[220px] truncate py-2.5 pr-3 text-foreground">
        <span title={result.goalSnippet ?? undefined}>{result.goalSnippet ?? EM_DASH}</span>
      </td>
      <td className="py-2.5 pr-3">
        <OutcomeBadge outcome={missionDisplayOutcome(result)} />
      </td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
        {formatDurationS(result.durationS)}
      </td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
        {result.trades}
      </td>
      <td className="py-2.5 text-right">
        <span title={pnlTitle} className={cn("font-mono tabular-nums", pnlTone(result.pnlEth))}>
          {formatEth(result.pnlEth, { signed: true })}
        </span>
        {result.pnlPct !== null ? (
          <span className="ml-2 font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
            {formatPercentDelta(result.pnlPct)}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function Th({
  children,
  align,
}: {
  readonly children: string;
  readonly align?: "right";
}): JSX.Element {
  return (
    <th className={cn("py-2 pr-3 font-normal", align === "right" ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

/** Sign -> PnL colour class: positive success, negative destructive, flat/unknown muted. */
function pnlTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "text-[var(--vex-text-3)]";
  if (value > 0) return "text-[var(--color-success)]";
  if (value < 0) return "text-destructive";
  return "text-[var(--vex-text-2)]";
}
