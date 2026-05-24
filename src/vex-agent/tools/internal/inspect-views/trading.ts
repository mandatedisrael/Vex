/**
 * Portfolio inspect — trading views: lots, profits, unrealized.
 * PnL economics and FIFO lot state.
 */

import type { ToolResult } from "../../types.js";
import { ok } from "../types.js";

export async function inspectLots(addresses: string[], instrumentKey?: string, namespace?: string, status?: string): Promise<ToolResult> {
  const { query } = await import("@vex-agent/db/client.js");
  // Always wallet-scoped (ANY('{}') → no rows for an empty selection).
  const conditions: string[] = ["wallet_address = ANY($1::text[])"];
  const params: unknown[] = [addresses];
  let idx = 2;

  if (instrumentKey) { conditions.push(`instrument_key = $${idx++}`); params.push(instrumentKey); }
  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }
  if (status) { conditions.push(`status = $${idx++}`); params.push(status); }

  const where = `WHERE ${conditions.join(" AND ")}`;
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
      costBasisNative: r.cost_basis_native != null ? Number(r.cost_basis_native) : null,
      benchmarkAssetKey: r.benchmark_asset_key,
      status: r.status,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
    })),
  });
}

export async function inspectProfits(addresses: string[], namespace?: string, instrumentKey?: string, groupBy?: string): Promise<ToolResult> {
  const { query } = await import("@vex-agent/db/client.js");

  // Wallet scope comes from the session selection, NOT a caller-supplied
  // address (which the renderer must not be trusted to set).
  const conditions: string[] = ["wallet_address = ANY($1::text[])"];
  const params: unknown[] = [addresses];
  let idx = 2;

  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }
  if (instrumentKey) { conditions.push(`instrument_key = $${idx++}`); params.push(instrumentKey); }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const groupCol = groupBy === "namespace" ? "namespace" : "instrument_key";

  const rows = await query<Record<string, unknown>>(
    `SELECT ${groupCol} AS group_key,
            COUNT(*) FILTER (WHERE match_kind = 'matched') AS matched_count,
            COUNT(*) FILTER (WHERE match_kind = 'shortfall') AS shortfall_count,
            SUM(realized_pnl_usd) FILTER (WHERE match_kind = 'matched') AS realized_pnl_usd,
            SUM(cost_basis_usd) FILTER (WHERE match_kind = 'matched') AS total_cost_basis,
            SUM(proceeds_usd) FILTER (WHERE match_kind = 'matched') AS total_proceeds,
            SUM(realized_pnl_native) FILTER (WHERE match_kind = 'matched') AS realized_pnl_native,
            MAX(benchmark_asset_key) AS benchmark_asset_key
     FROM proj_pnl_matches ${where}
     GROUP BY ${groupCol}
     ORDER BY realized_pnl_usd DESC NULLS LAST`,
    params,
  );

  return ok({
    view: "profits",
    groupBy: groupBy === "namespace" ? "namespace" : "instrument",
    count: rows.length,
    items: rows.map(r => ({
      key: r.group_key,
      matchedCount: Number(r.matched_count),
      shortfallCount: Number(r.shortfall_count),
      realizedPnlUsd: r.realized_pnl_usd != null ? Number(r.realized_pnl_usd) : null,
      totalCostBasis: r.total_cost_basis != null ? Number(r.total_cost_basis) : null,
      totalProceeds: r.total_proceeds != null ? Number(r.total_proceeds) : null,
      realizedPnlNative: r.realized_pnl_native != null ? Number(r.realized_pnl_native) : null,
      benchmarkAssetKey: r.benchmark_asset_key,
    })),
  });
}

export async function inspectUnrealized(addresses: string[], namespace?: string): Promise<ToolResult> {
  const { query } = await import("@vex-agent/db/client.js");
  const { parseInstrumentKey } = await import("@vex-agent/sync/instrument-key.js");
  const { getPortfolioChainId, resolvePortfolioChainIds } = await import("@vex-agent/sync/portfolio-chain-map.js");

  const lotConditions: string[] = ["l.status IN ('open', 'partial')", "l.wallet_address = ANY($1::text[])"];
  const lotParams: unknown[] = [addresses];
  let idx = 2;
  if (namespace) { lotConditions.push(`l.namespace = $${idx++}`); lotParams.push(namespace); }

  const rows = await query<Record<string, unknown>>(
    `SELECT l.instrument_key, l.wallet_address, l.namespace, l.chain,
            SUM(l.remaining_quantity_raw::numeric) AS total_remaining_raw,
            SUM(l.quantity_raw::numeric) AS total_quantity_raw,
            SUM(l.cost_basis_usd) AS total_cost_basis_usd,
            SUM(l.cost_basis_usd * l.remaining_quantity_raw::numeric / l.quantity_raw::numeric) AS remaining_cost_basis_usd,
            SUM(l.cost_basis_native * l.remaining_quantity_raw::numeric / l.quantity_raw::numeric) AS remaining_cost_basis_native,
            MAX(l.benchmark_asset_key) AS benchmark_asset_key
     FROM proj_pnl_lots l
     WHERE ${lotConditions.join(" AND ")}
     GROUP BY l.instrument_key, l.wallet_address, l.namespace, l.chain`,
    lotParams,
  );

  const items: Record<string, unknown>[] = [];
  const parsedRows = rows.map((row) => ({
    row,
    parsed: parseInstrumentKey(String(row.instrument_key)),
  }));
  const chainIds = await resolvePortfolioChainIds(parsedRows.map((entry) => entry.parsed.chain));

  for (const { row: r, parsed } of parsedRows) {
    let currentPrice: number | null = null;
    let decimals = 18;

    if (parsed.tokenAddress) {
      const chainId = getPortfolioChainId(chainIds, parsed.chain);
      if (chainId != null) {
        const balanceRows = await query<Record<string, unknown>>(
          `SELECT price_usd, decimals FROM proj_balances
           WHERE wallet_address = $1 AND token_address = $2 AND chain_id = $3
           LIMIT 1`,
          [r.wallet_address, parsed.tokenAddress, chainId],
        );
        if (balanceRows.length > 0) {
          currentPrice = balanceRows[0].price_usd != null ? Number(balanceRows[0].price_usd) : null;
          decimals = (balanceRows[0].decimals as number) ?? 18;
        }
      }
    }

    const remainingQtyHuman = Number(BigInt(String(r.total_remaining_raw))) / Math.pow(10, decimals);
    const currentValueUsd = currentPrice != null ? remainingQtyHuman * currentPrice : null;
    const remainingCostBasis = r.remaining_cost_basis_usd != null ? Number(r.remaining_cost_basis_usd) : null;
    const unrealizedPnl = currentValueUsd != null && remainingCostBasis != null
      ? currentValueUsd - remainingCostBasis : null;

    items.push({
      instrumentKey: r.instrument_key,
      namespace: r.namespace,
      chain: r.chain,
      remainingQtyRaw: String(r.total_remaining_raw),
      currentPrice,
      currentValueUsd,
      remainingCostBasisUsd: remainingCostBasis,
      unrealizedPnlUsd: unrealizedPnl,
      remainingCostBasisNative: r.remaining_cost_basis_native != null ? Number(r.remaining_cost_basis_native) : null,
      benchmarkAssetKey: r.benchmark_asset_key,
    });
  }

  return ok({
    view: "unrealized",
    count: items.length,
    instruments: items,
  });
}
