/**
 * Balances repo — portfolio snapshot history (chart range reads).
 */

import { query } from "../../client.js";
import { mapSnapshotRow } from "./mappers.js";
import type { PortfolioSnapshot, SnapshotWalletFilter } from "./types.js";

/** Snapshot history for chart, optionally scoped to one wallet. */
export async function getSnapshotHistory(
  range: "24h" | "7d" | "30d" | "all" = "24h",
  filter?: SnapshotWalletFilter,
): Promise<PortfolioSnapshot[]> {
  const intervals: Record<string, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", "all": "100 years" };
  const rows = filter !== undefined
    ? await query<Record<string, unknown>>(
        `SELECT * FROM proj_portfolio_snapshots
         WHERE created_at > NOW() - INTERVAL '${intervals[range]}' AND wallet_family = $1 AND wallet_address = $2
         ORDER BY created_at ASC`,
        [filter.walletFamily, filter.walletAddress],
      )
    : await query<Record<string, unknown>>(
        `SELECT * FROM proj_portfolio_snapshots WHERE created_at > NOW() - INTERVAL '${intervals[range]}' ORDER BY created_at ASC`,
      );
  return rows.map(mapSnapshotRow);
}
