/**
 * Portfolio inspect — portfolio views: summary, balances, snapshots, executions.
 * Aggregate portfolio state and audit.
 */

import type { ToolResult } from "../../types.js";
import { ok } from "../types.js";

// All portfolio reads are scoped to the session's selected wallet set
// (puzzle 5 phase 5E-2). An empty set yields zeroes/[] (never global) because
// every filter is `wallet_address = ANY($::text[])` and `ANY('{}')` matches
// nothing. CLI/MCP pass the primary set, preserving prior behaviour.
export async function inspectSummary(addresses: string[]): Promise<ToolResult> {
  const { getTotalUsd, getLatestAggregateSnapshot } = await import("@vex-agent/db/repos/balances.js");
  const { getOpen } = await import("@vex-agent/db/repos/open-positions.js");
  const { getTotalRealizedPnl } = await import("@vex-agent/db/repos/pnl-matches.js");
  const { query: dbQuery } = await import("@vex-agent/db/client.js");
  const { resolvePortfolioChainIds } = await import("@vex-agent/sync/portfolio-chain-map.js");

  const totalUsd = await getTotalUsd(addresses);
  const openPositions = await getOpen(addresses);
  const latestSnapshot = await getLatestAggregateSnapshot(addresses);
  const realizedPnlRaw = await getTotalRealizedPnl(addresses);

  let unrealizedPnlUsd: number | null = null;

  const mtmRow = await dbQuery<{ total: string | null }>(
    "SELECT SUM(unrealized_pnl_usd) AS total FROM proj_open_positions WHERE status = 'open' AND unrealized_pnl_usd IS NOT NULL AND wallet_address = ANY($1::text[])",
    [addresses],
  );
  const predictionUnrealized = mtmRow[0]?.total != null ? Number(mtmRow[0].total) : null;

  const spotLotRow = await dbQuery<{ count: string }>(
    "SELECT COUNT(*) AS count FROM proj_pnl_lots WHERE status IN ('open', 'partial') AND wallet_address = ANY($1::text[])",
    [addresses],
  );
  const openSpotLotCount = Number(spotLotRow[0]?.count ?? 0);
  const spotChainRows = await dbQuery<{ chain: string }>(
    `SELECT DISTINCT split_part(instrument_key, ':', 1) AS chain
     FROM proj_pnl_lots
     WHERE status IN ('open', 'partial') AND wallet_address = ANY($1::text[])`,
    [addresses],
  );
  const chainIds = await resolvePortfolioChainIds(spotChainRows.map((row) => row.chain));
  const spotUnrealized = chainIds.size > 0
    ? await calculateSpotUnrealized(chainIds, addresses)
    : null;

  if (predictionUnrealized != null || spotUnrealized != null) {
    unrealizedPnlUsd = (predictionUnrealized ?? 0) + (spotUnrealized ?? 0);
  }

  return ok({
    view: "summary",
    totalBalanceUsd: totalUsd,
    openPositionCount: openPositions.length,
    openSpotLotCount,
    latestSnapshot: latestSnapshot ? {
      totalUsd: latestSnapshot.totalUsd,
      pnlVsPrev: latestSnapshot.pnlVsPrev,
      activeChains: latestSnapshot.activeChains,
      at: latestSnapshot.at,
    } : null,
    realizedPnlUsd: realizedPnlRaw != null ? Number(realizedPnlRaw) : null,
    unrealizedPnlUsd,
    note: "Scoped to this session's selected wallet(s). Spot inventory is FIFO lots, not open_positions. Realized PnL comes from matched lots; unrealized = prediction MTM + spot lots × projected balance prices.",
  });
}

async function calculateSpotUnrealized(
  chainIds: ReadonlyMap<string, number>,
  addresses: string[],
): Promise<number | null> {
  const { query: dbQuery } = await import("@vex-agent/db/client.js");
  const params: unknown[] = [];
  const valuesSql = [...chainIds.entries()].map(([chain, chainId]) => {
    params.push(chain, chainId);
    const start = params.length - 1;
    return `($${start}::text, $${start + 1}::bigint)`;
  }).join(", ");
  params.push(addresses);
  const addrIdx = params.length;

  const spotRow = await dbQuery<{ total: string | null }>(
    `WITH chain_map(chain_slug, chain_id) AS (VALUES ${valuesSql}),
     lot_vals AS (
       SELECT l.cost_basis_usd * l.remaining_quantity_raw::numeric / l.quantity_raw::numeric AS remaining_cost,
              l.remaining_quantity_raw::numeric / power(10, COALESCE(b.decimals, 18)) * b.price_usd AS current_val
       FROM proj_pnl_lots l
       JOIN chain_map cm ON cm.chain_slug = lower(split_part(l.instrument_key, ':', 1))
       LEFT JOIN proj_balances b ON b.wallet_address = l.wallet_address
         AND b.token_address = split_part(l.instrument_key, ':', 2)
         AND b.chain_id = cm.chain_id
       WHERE l.status IN ('open', 'partial') AND b.price_usd IS NOT NULL AND l.cost_basis_usd IS NOT NULL
         AND l.wallet_address = ANY($${addrIdx}::text[])
     )
     SELECT SUM(current_val - remaining_cost) AS total FROM lot_vals`,
    params,
  );

  return spotRow[0]?.total != null ? Number(spotRow[0].total) : null;
}

export async function inspectBalances(addresses: string[]): Promise<ToolResult> {
  const { getTotalUsd } = await import("@vex-agent/db/repos/balances.js");
  const totalUsd = await getTotalUsd(addresses);

  return ok({
    view: "balances",
    totalUsd,
    note: "Use wallet_read for fresh per-token live balances. This shows the selected wallet(s)' aggregate USD total from DB projections.",
  });
}

export async function inspectSnapshots(addresses: string[]): Promise<ToolResult> {
  const { getAggregateSnapshots } = await import("@vex-agent/db/repos/balances.js");
  // Aggregated per full-sync cycle across the selected wallet set (complete
  // cycles only — partial syncs excluded).
  const snapshots = await getAggregateSnapshots(addresses, "7d");

  return ok({
    view: "snapshots",
    count: snapshots.length,
    snapshots: snapshots.map(s => ({
      totalUsd: s.totalUsd,
      pnlVsPrev: s.pnlVsPrev,
      pnlPctVsPrev: s.pnlPctVsPrev,
      activeChains: s.activeChains,
      createdAt: s.at,
    })),
  });
}

export async function inspectExecutions(namespace?: string, limit = 20): Promise<ToolResult> {
  const { getByNamespace } = await import("@vex-agent/db/repos/executions.js");
  if (!namespace) {
    const { query } = await import("@vex-agent/db/client.js");
    const rows = await query<Record<string, unknown>>(
      "SELECT id, tool_id, namespace, success, external_refs, duration_ms, created_at FROM protocol_executions ORDER BY created_at DESC LIMIT $1",
      [limit],
    );
    return ok({
      view: "executions",
      count: rows.length,
      executions: rows.map(e => ({
        id: e.id,
        toolId: e.tool_id,
        namespace: e.namespace,
        success: e.success,
        externalRefs: e.external_refs,
        durationMs: e.duration_ms,
        createdAt: e.created_at,
      })),
    });
  }
  const executions = await getByNamespace(namespace, limit);

  return ok({
    view: "executions",
    count: executions.length,
    executions: executions.map(e => ({
      toolId: e.toolId,
      success: e.success,
      externalRefs: e.externalRefs,
      durationMs: e.durationMs,
      createdAt: e.createdAt,
    })),
  });
}
