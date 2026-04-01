/**
 * PnL matches repo — proj_pnl_matches.
 *
 * Canonical realized PnL ledger. Each FIFO lot match records pro-rata
 * cost basis, proceeds, and realized PnL. Shortfall rows have lot_id = NULL.
 *
 * All pro-rata math is done in SQL (NUMERIC arithmetic) — no JS float.
 */

import { query, queryOne, getPool } from "../client.js";

export interface PnlMatch {
  id: number;
  matchKind: string;
  sellActivityId: number;
  lotId: number | null;
  instrumentKey: string;
  walletAddress: string;
  quantityMatched: string;
  costBasisUsd: string | null;
  proceedsUsd: string | null;
  realizedPnlUsd: string | null;
  namespace: string;
  chain: string;
  matchedAt: string;
}

export interface RecordMatchFromLotParams {
  sellActivityId: number;
  lotId: number;
  instrumentKey: string;
  walletAddress: string;
  matchedQty: string;
  sellOutputValueUsd: string | null;
  totalSellQty: string;
  namespace: string;
  chain: string;
}

export interface RecordShortfallParams {
  sellActivityId: number;
  instrumentKey: string;
  walletAddress: string;
  shortfallQty: string;
  sellOutputValueUsd: string | null;
  totalSellQty: string;
  namespace: string;
  chain: string;
}

/**
 * Record a matched FIFO lot consumption with SQL-side pro-rata math.
 * cost_basis_usd = lot.cost_basis_usd * matched_qty / lot.quantity_raw
 * proceeds_usd = sell.output_value_usd * matched_qty / total_sell_qty
 * realized_pnl_usd = proceeds - cost_basis
 */
export async function recordMatchFromLot(params: RecordMatchFromLotParams): Promise<number> {
  const result = await queryOne<{ id: number }>(
    `INSERT INTO proj_pnl_matches
       (match_kind, sell_activity_id, lot_id, instrument_key, wallet_address,
        quantity_matched, cost_basis_usd, proceeds_usd, realized_pnl_usd, namespace, chain)
     VALUES
       ('matched', $1, $2, $3, $4, $5,
        (SELECT cost_basis_usd * $5::numeric / quantity_raw::numeric FROM proj_pnl_lots WHERE id = $2),
        $6::numeric * $5::numeric / $7::numeric,
        ($6::numeric * $5::numeric / $7::numeric) -
          (SELECT cost_basis_usd * $5::numeric / quantity_raw::numeric FROM proj_pnl_lots WHERE id = $2),
        $8, $9)
     RETURNING id`,
    [
      params.sellActivityId, params.lotId, params.instrumentKey, params.walletAddress,
      params.matchedQty, params.sellOutputValueUsd, params.totalSellQty,
      params.namespace, params.chain,
    ],
  );
  return result?.id ?? 0;
}

/**
 * Record a shortfall — sell quantity exceeding tracked inventory.
 * lot_id = NULL, cost_basis_usd = NULL, realized_pnl_usd = NULL.
 * Proceeds are pro-rata via SQL if sell has valuation.
 */
export async function recordShortfall(params: RecordShortfallParams): Promise<number> {
  const result = await queryOne<{ id: number }>(
    `INSERT INTO proj_pnl_matches
       (match_kind, sell_activity_id, lot_id, instrument_key, wallet_address,
        quantity_matched, cost_basis_usd, proceeds_usd, realized_pnl_usd, namespace, chain)
     VALUES
       ('shortfall', $1, NULL, $2, $3, $4, NULL,
        $5::numeric * $4::numeric / $6::numeric,
        NULL, $7, $8)
     RETURNING id`,
    [
      params.sellActivityId, params.instrumentKey, params.walletAddress,
      params.shortfallQty, params.sellOutputValueUsd, params.totalSellQty,
      params.namespace, params.chain,
    ],
  );
  return result?.id ?? 0;
}

/** Get matches for an instrument+wallet (for per-instrument PnL). */
export async function getMatchesByInstrument(instrumentKey: string, walletAddress: string): Promise<PnlMatch[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM proj_pnl_matches
     WHERE instrument_key = $1 AND wallet_address = $2
     ORDER BY matched_at ASC`,
    [instrumentKey, walletAddress],
  );
  return rows.map(mapRow);
}

/** Get matches for a specific sell activity. */
export async function getMatchesBySell(sellActivityId: number): Promise<PnlMatch[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM proj_pnl_matches WHERE sell_activity_id = $1 ORDER BY id ASC",
    [sellActivityId],
  );
  return rows.map(mapRow);
}

/** Total realized PnL (NUMERIC → string). NULL if no matches. */
export async function getTotalRealizedPnl(walletAddress?: string, namespace?: string): Promise<string | null> {
  const conditions: string[] = ["match_kind = 'matched'"];
  const params: unknown[] = [];
  let idx = 1;

  if (walletAddress) { conditions.push(`wallet_address = $${idx++}`); params.push(walletAddress); }
  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }

  const row = await queryOne<{ total: string | null }>(
    `SELECT SUM(realized_pnl_usd) AS total FROM proj_pnl_matches WHERE ${conditions.join(" AND ")}`,
    params,
  );
  return row?.total ?? null;
}

function mapRow(r: Record<string, unknown>): PnlMatch {
  return {
    id: r.id as number,
    matchKind: r.match_kind as string,
    sellActivityId: r.sell_activity_id as number,
    lotId: r.lot_id as number | null,
    instrumentKey: r.instrument_key as string,
    walletAddress: r.wallet_address as string,
    quantityMatched: r.quantity_matched as string,
    costBasisUsd: r.cost_basis_usd != null ? String(r.cost_basis_usd) : null,
    proceedsUsd: r.proceeds_usd != null ? String(r.proceeds_usd) : null,
    realizedPnlUsd: r.realized_pnl_usd != null ? String(r.realized_pnl_usd) : null,
    namespace: r.namespace as string,
    chain: r.chain as string,
    matchedAt: r.matched_at as string,
  };
}
