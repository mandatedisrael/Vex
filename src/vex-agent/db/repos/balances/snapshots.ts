/**
 * Balances repo — portfolio snapshot insert + latest read.
 *
 * proj_portfolio_snapshots: time-series of portfolio value with per-chain breakdown.
 */

import { query, queryOne } from "../../client.js";
import { jsonb } from "../../params.js";
import { mapSnapshotRow } from "./mappers.js";
import type {
  InsertSnapshotArgs,
  InsertSnapshotResult,
  PortfolioSnapshot,
  SnapshotWalletFilter,
} from "./types.js";

export async function insertSnapshot(args: InsertSnapshotArgs): Promise<InsertSnapshotResult> {
  const prev = await getLatestSnapshot({
    walletFamily: args.walletFamily,
    walletAddress: args.walletAddress,
  });
  let pnlVsPrev: number | null = null;
  let pnlPctVsPrev: number | null = null;
  if (prev && prev.totalUsd > 0) {
    pnlVsPrev = args.totalUsd - prev.totalUsd;
    pnlPctVsPrev = (pnlVsPrev / prev.totalUsd) * 100;
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO proj_portfolio_snapshots
       (wallet_family, wallet_address, snapshot_group_id, total_usd, positions, active_chains, pnl_vs_prev, pnl_pct_vs_prev, source)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) RETURNING id`,
    [args.walletFamily, args.walletAddress, args.snapshotGroupId, args.totalUsd,
     jsonb(args.positions), args.activeChains, pnlVsPrev, pnlPctVsPrev, args.source ?? "sync"],
  );
  return { snapshotId: row?.id ?? 0, pnlVsPrev };
}

/**
 * Latest snapshot. With `filter` (atomic family+address) returns the latest for
 * that wallet; without it, the latest row across all wallets (legacy/global).
 */
export async function getLatestSnapshot(
  filter?: SnapshotWalletFilter,
): Promise<PortfolioSnapshot | null> {
  const row = filter !== undefined
    ? await queryOne<Record<string, unknown>>(
        "SELECT * FROM proj_portfolio_snapshots WHERE wallet_family = $1 AND wallet_address = $2 ORDER BY created_at DESC LIMIT 1",
        [filter.walletFamily, filter.walletAddress],
      )
    : await queryOne<Record<string, unknown>>(
        "SELECT * FROM proj_portfolio_snapshots ORDER BY created_at DESC LIMIT 1",
      );
  return row ? mapSnapshotRow(row) : null;
}
