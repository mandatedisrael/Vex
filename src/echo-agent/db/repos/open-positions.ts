/**
 * Open positions repo — proj_open_positions.
 *
 * Tracks lifecycle of perps, predictions, DCA/limit orders, LP positions.
 * Upsert by (namespace, position_type, external_id).
 */

import { query, queryOne, execute } from "../client.js";

export interface Position {
  id: number;
  namespace: string;
  positionType: string;
  chain: string;
  externalId: string | null;
  walletAddress: string;
  instrumentKey: string | null;
  positionKey: string | null;
  entryPriceUsd: string | null;
  currentValueUsd: string | null;
  unrealizedPnlUsd: string | null;
  notionalUsd: string | null;
  feeUsd: string | null;
  data: Record<string, unknown>;
  status: string;
  openedAt: string | null;
  closedAt: string | null;
}

export interface UpsertPositionRow {
  namespace: string;
  positionType: string;
  chain: string;
  externalId: string;
  walletAddress: string;
  instrumentKey?: string;
  positionKey?: string;
  entryPriceUsd?: string;
  notionalUsd?: string;
  feeUsd?: string;
  data?: Record<string, unknown>;
  status?: string;
}

/** Upsert position — ON CONFLICT updates status and data. */
export async function upsertPosition(row: UpsertPositionRow): Promise<void> {
  await execute(
    `INSERT INTO proj_open_positions (namespace, position_type, chain, external_id, wallet_address, instrument_key, position_key, entry_price_usd, notional_usd, fee_usd, data, status, opened_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
     ON CONFLICT (namespace, position_type, external_id) WHERE external_id IS NOT NULL
     DO UPDATE SET status = COALESCE($12, proj_open_positions.status),
       data = COALESCE($11, proj_open_positions.data),
       instrument_key = COALESCE($6, proj_open_positions.instrument_key),
       position_key = COALESCE($7, proj_open_positions.position_key),
       entry_price_usd = COALESCE($8, proj_open_positions.entry_price_usd),
       notional_usd = COALESCE($9, proj_open_positions.notional_usd),
       fee_usd = COALESCE($10, proj_open_positions.fee_usd),
       synced_at = NOW()`,
    [row.namespace, row.positionType, row.chain, row.externalId, row.walletAddress,
     row.instrumentKey ?? null, row.positionKey ?? null, row.entryPriceUsd ?? null,
     row.notionalUsd ?? null, row.feeUsd ?? null,
     JSON.stringify(row.data ?? {}), row.status ?? "open"],
  );
}

/** Close a position by marking status and closed_at. */
export async function closePosition(namespace: string, positionType: string, externalId: string, status = "closed"): Promise<boolean> {
  const n = await execute(
    "UPDATE proj_open_positions SET status = $4, closed_at = NOW(), synced_at = NOW() WHERE namespace = $1 AND position_type = $2 AND external_id = $3 AND status = 'open'",
    [namespace, positionType, externalId, status],
  );
  return n > 0;
}

/** Get open positions, optionally filtered. */
export async function getOpen(walletAddress?: string, namespace?: string): Promise<Position[]> {
  const conditions: string[] = ["status = 'open'"];
  const params: unknown[] = [];
  let idx = 1;

  if (walletAddress) { conditions.push(`wallet_address = $${idx++}`); params.push(walletAddress); }
  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM proj_open_positions WHERE ${conditions.join(" AND ")} ORDER BY opened_at DESC`,
    params,
  );
  return rows.map(mapRow);
}

/** Get position by position_key. */
export async function getByPositionKey(positionKey: string): Promise<Position | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM proj_open_positions WHERE position_key = $1 AND status = 'open' LIMIT 1",
    [positionKey],
  );
  return row ? mapRow(row) : null;
}

function mapRow(r: Record<string, unknown>): Position {
  return {
    id: r.id as number,
    namespace: r.namespace as string,
    positionType: r.position_type as string,
    chain: r.chain as string,
    externalId: r.external_id as string | null,
    walletAddress: r.wallet_address as string,
    instrumentKey: r.instrument_key as string | null,
    positionKey: r.position_key as string | null,
    entryPriceUsd: r.entry_price_usd != null ? String(r.entry_price_usd) : null,
    currentValueUsd: r.current_value_usd != null ? String(r.current_value_usd) : null,
    unrealizedPnlUsd: r.unrealized_pnl_usd != null ? String(r.unrealized_pnl_usd) : null,
    notionalUsd: r.notional_usd != null ? String(r.notional_usd) : null,
    feeUsd: r.fee_usd != null ? String(r.fee_usd) : null,
    data: (r.data as Record<string, unknown>) ?? {},
    status: r.status as string,
    openedAt: r.opened_at as string | null,
    closedAt: r.closed_at as string | null,
  };
}
