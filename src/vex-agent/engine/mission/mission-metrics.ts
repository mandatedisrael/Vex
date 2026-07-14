/**
 * Per-mission trade metrics for the results ledger.
 *
 * `proj_activity` holds one row per successful fill; it links to a session
 * via `protocol_executions.id`. A mission run maps 1:1 to a session, so
 * bounding by (session_id, created_at within the run window) attributes
 * fills to the run. Fail-soft: a read error yields 0 so mission
 * finalization is never blocked by metrics.
 *
 * v1 computes the trade COUNT only. Per-trade win/loss/rotation
 * attribution is a documented follow-up (see mission-results-capture.ts);
 * mission-level win-rate is derived in the UI from PnL sign, which needs no
 * per-trade pairing.
 */

import { queryOne } from "../../db/client.js";
import logger from "@utils/logger.js";

export async function countMissionTrades(
  sessionId: string,
  startedAt: string,
  endedAt: string,
): Promise<number> {
  try {
    const row = await queryOne<{ trades: number }>(
      `SELECT COUNT(*)::int AS trades
         FROM proj_activity a
         JOIN protocol_executions e ON a.execution_id = e.id
        WHERE e.session_id = $1
          AND a.created_at BETWEEN $2 AND $3`,
      [sessionId, startedAt, endedAt],
    );
    return row?.trades ?? 0;
  } catch (err) {
    logger.warn("mission.results.count_trades_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
