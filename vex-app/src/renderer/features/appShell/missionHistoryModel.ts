/**
 * Mission History — pure display model.
 *
 * Every function here is pure (data in, derived value out) so the math is
 * unit-tested independently of React.
 *
 * `missionDisplayOutcome` is the ONE place the raw ledger
 * `(outcome, stopReason)` pair maps to a presentation-level outcome —
 * deadline semantics stay out of SQL (mission-results.ts / the migration)
 * and out of every component that renders this data. A run whose ledger
 * `outcome` is terminal-but-not-goal and whose `stopReason` is
 * "deadline_reached" displays as "timeBoxed": a neutral, medium-level
 * outcome ("the time-box was reached"), never a failure.
 *
 * Naming: this is a "mission result (ETH)" — an honest PnL record, never
 * "performance" anywhere in this module or its consumers.
 */

import type { MissionResultDto } from "@shared/schemas/mission.js";

export const EM_DASH = "—";

export type MissionDisplayOutcome =
  | "completed"
  | "timeBoxed"
  | "cancelled"
  | "failed"
  | "stopped"
  | "running";

/** Raw ledger (outcome, stopReason) -> the presentation-level outcome. */
export function missionDisplayOutcome(
  result: Pick<MissionResultDto, "outcome" | "stopReason">,
): MissionDisplayOutcome {
  if (result.stopReason === "deadline_reached" && result.outcome !== "completed") {
    return "timeBoxed";
  }
  return result.outcome;
}

/** Completed AND time-boxed runs count as a "completion" for stats (the win-rate population). */
export function isCompletionLike(displayOutcome: MissionDisplayOutcome): boolean {
  return displayOutcome === "completed" || displayOutcome === "timeBoxed";
}

/**
 * Win-rate (%) over completion-like runs with a known PnL sign. `null` when
 * no run is eligible (e.g. history has only cancelled/still-running rows).
 */
export function computeWinRate(results: readonly MissionResultDto[]): number | null {
  const eligible = results.filter(
    (r) => isCompletionLike(missionDisplayOutcome(r)) && r.pnlEth !== null,
  );
  if (eligible.length === 0) return null;
  const wins = eligible.filter((r) => (r.pnlEth as number) > 0).length;
  return (wins / eligible.length) * 100;
}

/** Sum of known ETH PnL across all results (a null/unknown PnL contributes 0). */
export function sumPnlEth(results: readonly MissionResultDto[]): number {
  return results.reduce((total, r) => total + (r.pnlEth ?? 0), 0);
}

const ETH_DECIMALS = 4;

/** Fixed-precision ETH amount; `signed` prefixes +/-. `null`/non-finite -> em dash. */
export function formatEth(value: number | null, opts: { signed?: boolean } = {}): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  const sign = opts.signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : "";
  return `${sign}${Math.abs(value).toFixed(ETH_DECIMALS)}`;
}

/** USD value implied by an ETH PnL at the run's close price; null if either input is unknown. */
export function pnlUsd(pnlEth: number | null, ethPriceUsdEnd: number | null): number | null {
  if (pnlEth === null || ethPriceUsdEnd === null) return null;
  return pnlEth * ethPriceUsdEnd;
}

/** `Xs` / `Xm` / `Xh Ym` for a run's persisted duration in seconds; em dash when unknown. */
export function formatDurationS(durationS: number | null): string {
  if (durationS === null || !Number.isFinite(durationS) || durationS < 0) return EM_DASH;
  const totalMinutes = Math.floor(durationS / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (totalMinutes > 0) return `${totalMinutes}m`;
  return `${durationS}s`;
}
