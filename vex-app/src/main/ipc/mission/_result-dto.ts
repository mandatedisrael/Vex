/**
 * Shared row -> DTO mapper for `mission.listResults` /
 * `mission.getResultForRun` — both read the same `mission_results` ledger
 * row shape and must project it identically for the renderer.
 */

import type { MissionResultRow } from "@vex-agent/db/repos/mission-results.js";
import type { MissionResultDto } from "@shared/schemas/mission.js";

export function toMissionResultDto(row: MissionResultRow): MissionResultDto {
  return {
    missionRunId: row.missionRunId,
    seqNo: row.seqNo,
    goalSnippet: row.goalSnippet,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationS: row.durationS,
    bankrollStartEth: row.bankrollStartEth,
    bankrollEndEth: row.bankrollEndEth,
    pnlEth: row.pnlEth,
    pnlPct: row.pnlPct,
    ethPriceUsdEnd: row.ethPriceUsdEnd,
    trades: row.trades,
    outcome: row.outcome,
    stopReason: row.stopReason,
    openPositionsCount: Array.isArray(row.openPositions) ? row.openPositions.length : 0,
  };
}
