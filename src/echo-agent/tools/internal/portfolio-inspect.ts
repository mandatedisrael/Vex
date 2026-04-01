/**
 * Portfolio inspect — DB-backed read-only self-inspection tool.
 *
 * Lets the agent inspect its own protocol history, open positions,
 * activity, executions, balances, portfolio snapshots, lots, profits,
 * closed positions, and non-trading audit history.
 *
 * Realized PnL comes from proj_pnl_matches (FIFO lot match ledger).
 * Unrealized PnL returns "not_available_yet" where mark-to-market is unavailable.
 */

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, num, ok, fail } from "./types.js";

const VALID_VIEWS = new Set<string>([
  "open_positions", "activity", "executions", "balances", "snapshots", "summary",
  "lots", "profits", "closed_positions", "non_trading_history",
]);

export async function handlePortfolioInspect(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const view = str(params, "view");
  if (!view || !VALID_VIEWS.has(view)) {
    return fail(`Invalid view "${view}". Must be one of: ${[...VALID_VIEWS].join(", ")}`);
  }

  const namespace = str(params, "namespace") || undefined;
  const productType = str(params, "productType") || undefined;
  const limit = num(params, "limit") ?? 20;

  switch (view) {
    case "open_positions": return inspectOpenPositions(namespace);
    case "activity": return inspectActivity(namespace, productType, limit);
    case "executions": return inspectExecutions(namespace, limit);
    case "balances": return inspectBalances();
    case "snapshots": return inspectSnapshots();
    case "summary": return inspectSummary();
    case "lots": return inspectLots(str(params, "instrumentKey") || undefined, namespace, str(params, "status") || undefined);
    case "profits": return inspectProfits(str(params, "walletAddress") || undefined, namespace);
    case "closed_positions": return inspectClosedPositions(namespace);
    case "non_trading_history": return inspectNonTradingHistory(namespace, limit);
    default: return fail(`Unknown view: ${view}`);
  }
}

// ── View handlers ───────────────────────────────────────────────

async function inspectOpenPositions(namespace?: string): Promise<ToolResult> {
  const { getOpen } = await import("@echo-agent/db/repos/open-positions.js");
  const positions = await getOpen(undefined, namespace);

  if (positions.length === 0) {
    return ok({ view: "open_positions", count: 0, positions: [], note: "No open positions found" });
  }

  return ok({
    view: "open_positions",
    count: positions.length,
    positions: positions.map(p => ({
      namespace: p.namespace,
      type: p.positionType,
      chain: p.chain,
      wallet: p.walletAddress,
      instrument: p.instrumentKey,
      positionKey: p.positionKey,
      entryPrice: p.entryPriceUsd != null ? Number(p.entryPriceUsd) : null,
      notionalUsd: p.notionalUsd != null ? Number(p.notionalUsd) : null,
      feeUsd: p.feeUsd != null ? Number(p.feeUsd) : null,
      currentValue: p.currentValueUsd != null ? Number(p.currentValueUsd) : null,
      unrealizedPnl: p.unrealizedPnlUsd != null ? Number(p.unrealizedPnlUsd) : "not_available_yet",
      status: p.status,
      openedAt: p.openedAt,
    })),
  });
}

async function inspectActivity(namespace?: string, productType?: string, limit = 20): Promise<ToolResult> {
  const { getActivities } = await import("@echo-agent/db/repos/activity.js");
  const activities = await getActivities({ namespace, productType, limit });

  return ok({
    view: "activity",
    count: activities.length,
    activities: activities.map(a => ({
      namespace: a.namespace,
      type: a.activityType,
      product: a.productType,
      side: a.tradeSide,
      chain: a.chain,
      input: a.inputToken ? `${a.inputAmount} ${a.inputToken}` : null,
      output: a.outputToken ? `${a.outputAmount} ${a.outputToken}` : null,
      inputValueUsd: a.inputValueUsd != null ? Number(a.inputValueUsd) : null,
      outputValueUsd: a.outputValueUsd != null ? Number(a.outputValueUsd) : null,
      valuationSource: a.valuationSource,
      captureStatus: a.captureStatus,
      createdAt: a.createdAt,
    })),
  });
}

async function inspectExecutions(namespace?: string, limit = 20): Promise<ToolResult> {
  const { getByNamespace } = await import("@echo-agent/db/repos/executions.js");
  if (!namespace) {
    // Allow full history without namespace filter
    const { query } = await import("@echo-agent/db/client.js");
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

async function inspectBalances(): Promise<ToolResult> {
  const { getTotalUsd } = await import("@echo-agent/db/repos/balances.js");
  const totalUsd = await getTotalUsd();

  return ok({
    view: "balances",
    totalUsd,
    note: "Use wallet_read for detailed per-token balances. This shows aggregate USD total from projections.",
  });
}

async function inspectSnapshots(): Promise<ToolResult> {
  const { getSnapshotHistory } = await import("@echo-agent/db/repos/balances.js");
  const snapshots = await getSnapshotHistory("7d");

  return ok({
    view: "snapshots",
    count: snapshots.length,
    snapshots: snapshots.map(s => ({
      totalUsd: s.totalUsd,
      pnlVsPrev: s.pnlVsPrev,
      pnlPctVsPrev: s.pnlPctVsPrev,
      activeChains: s.activeChains,
      createdAt: s.createdAt,
    })),
  });
}

async function inspectSummary(): Promise<ToolResult> {
  const { getTotalUsd } = await import("@echo-agent/db/repos/balances.js");
  const { getOpen } = await import("@echo-agent/db/repos/open-positions.js");
  const { getLatestSnapshot } = await import("@echo-agent/db/repos/balances.js");
  const { getTotalRealizedPnl } = await import("@echo-agent/db/repos/pnl-matches.js");

  const totalUsd = await getTotalUsd();
  const openPositions = await getOpen();
  const latestSnapshot = await getLatestSnapshot();
  const realizedPnlRaw = await getTotalRealizedPnl();

  return ok({
    view: "summary",
    totalBalanceUsd: totalUsd,
    openPositionCount: openPositions.length,
    latestSnapshot: latestSnapshot ? {
      totalUsd: latestSnapshot.totalUsd,
      pnlVsPrev: latestSnapshot.pnlVsPrev,
      activeChains: latestSnapshot.activeChains,
      at: latestSnapshot.createdAt,
    } : null,
    realizedPnlUsd: realizedPnlRaw != null ? Number(realizedPnlRaw) : null,
    unrealizedPnl: "not_available_yet",
    note: "Realized PnL is from FIFO lot matching. Unrealized PnL requires live mark-to-market (not yet available).",
  });
}

async function inspectLots(instrumentKey?: string, namespace?: string, status?: string): Promise<ToolResult> {
  const { query } = await import("@echo-agent/db/client.js");
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (instrumentKey) { conditions.push(`instrument_key = $${idx++}`); params.push(instrumentKey); }
  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }
  if (status) { conditions.push(`status = $${idx++}`); params.push(status); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(50);
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM proj_pnl_lots ${where} ORDER BY opened_at DESC LIMIT $${idx}`,
    params,
  );

  return ok({
    view: "lots",
    count: rows.length,
    lots: rows.map(r => ({
      id: r.id,
      instrumentKey: r.instrument_key,
      namespace: r.namespace,
      chain: r.chain,
      side: r.side,
      quantityRaw: r.quantity_raw,
      remainingQuantityRaw: r.remaining_quantity_raw,
      costBasisUsd: r.cost_basis_usd != null ? Number(r.cost_basis_usd) : null,
      priceUsd: r.price_usd != null ? Number(r.price_usd) : null,
      status: r.status,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
    })),
  });
}

async function inspectProfits(walletAddress?: string, namespace?: string): Promise<ToolResult> {
  const { query } = await import("@echo-agent/db/client.js");

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (walletAddress) { conditions.push(`wallet_address = $${idx++}`); params.push(walletAddress); }
  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await query<Record<string, unknown>>(
    `SELECT instrument_key,
            COUNT(*) FILTER (WHERE match_kind = 'matched') AS matched_count,
            COUNT(*) FILTER (WHERE match_kind = 'shortfall') AS shortfall_count,
            SUM(realized_pnl_usd) FILTER (WHERE match_kind = 'matched') AS realized_pnl_usd,
            SUM(cost_basis_usd) FILTER (WHERE match_kind = 'matched') AS total_cost_basis,
            SUM(proceeds_usd) FILTER (WHERE match_kind = 'matched') AS total_proceeds
     FROM proj_pnl_matches ${where}
     GROUP BY instrument_key
     ORDER BY realized_pnl_usd DESC NULLS LAST`,
    params,
  );

  return ok({
    view: "profits",
    count: rows.length,
    instruments: rows.map(r => ({
      instrumentKey: r.instrument_key,
      matchedCount: Number(r.matched_count),
      shortfallCount: Number(r.shortfall_count),
      realizedPnlUsd: r.realized_pnl_usd != null ? Number(r.realized_pnl_usd) : null,
      totalCostBasis: r.total_cost_basis != null ? Number(r.total_cost_basis) : null,
      totalProceeds: r.total_proceeds != null ? Number(r.total_proceeds) : null,
    })),
  });
}

async function inspectClosedPositions(namespace?: string): Promise<ToolResult> {
  const { query } = await import("@echo-agent/db/client.js");
  const conditions: string[] = ["status != 'open'"];
  const params: unknown[] = [];
  let idx = 1;

  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }
  params.push(50);

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM proj_open_positions WHERE ${conditions.join(" AND ")} ORDER BY closed_at DESC NULLS LAST LIMIT $${idx}`,
    params,
  );

  return ok({
    view: "closed_positions",
    count: rows.length,
    positions: rows.map(r => ({
      namespace: r.namespace,
      type: r.position_type,
      chain: r.chain,
      instrument: r.instrument_key,
      positionKey: r.position_key,
      entryPrice: r.entry_price_usd != null ? Number(r.entry_price_usd) : null,
      notionalUsd: r.notional_usd != null ? Number(r.notional_usd) : null,
      status: r.status,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
    })),
  });
}

async function inspectNonTradingHistory(namespace?: string, limit = 20): Promise<ToolResult> {
  const { query } = await import("@echo-agent/db/client.js");
  const conditions: string[] = ["product_type IN ('bridge', 'lend', 'wrap', 'allowance', 'reward', 'stake')"];
  const params: unknown[] = [];
  let idx = 1;

  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }
  params.push(limit);

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM proj_activity WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  return ok({
    view: "non_trading_history",
    count: rows.length,
    activities: rows.map(r => ({
      namespace: r.namespace,
      type: r.activity_type,
      product: r.product_type,
      chain: r.chain,
      wallet: r.wallet_address,
      captureStatus: r.capture_status,
      createdAt: r.created_at,
    })),
  });
}
