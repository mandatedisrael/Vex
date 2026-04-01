/**
 * PnL lots repo — proj_pnl_lots.
 *
 * Spot DEX cost basis ledger. Buys open lots, sells close lots FIFO.
 * Cross-protocol: slop.trade.buy → jaine.swap.sell works because
 * both use instrumentKey = 0g:{tokenAddress}.
 */

import { query, queryOne, execute } from "../client.js";

export interface Lot {
  id: number;
  instrumentKey: string;
  walletAddress: string;
  side: string;
  quantityRaw: string;
  costBasisUsd: string | null;
  priceUsd: string | null;
  remainingQuantityRaw: string;
  executionId: number | null;
  activityId: number | null;
  namespace: string;
  chain: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
}

export interface OpenLotRow {
  instrumentKey: string;
  walletAddress: string;
  side: string;
  quantityRaw: string;
  costBasisUsd?: string;
  priceUsd?: string;
  executionId?: number;
  activityId?: number;
  namespace: string;
  chain: string;
}

/** Open a new lot (buy event). */
export async function openLot(row: OpenLotRow): Promise<number> {
  const result = await queryOne<{ id: number }>(
    `INSERT INTO proj_pnl_lots (instrument_key, wallet_address, side, quantity_raw, cost_basis_usd, price_usd, remaining_quantity_raw, execution_id, activity_id, namespace, chain)
     VALUES ($1, $2, $3, $4, $5, $6, $4, $7, $8, $9, $10) RETURNING id`,
    [row.instrumentKey, row.walletAddress, row.side, row.quantityRaw,
     row.costBasisUsd ?? null, row.priceUsd ?? null,
     row.executionId ?? null, row.activityId ?? null, row.namespace, row.chain],
  );
  return result?.id ?? 0;
}

/** Get open lots for instrument+wallet, ordered by opened_at ASC (FIFO). */
export async function getOpenLots(instrumentKey: string, walletAddress: string): Promise<Lot[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM proj_pnl_lots
     WHERE instrument_key = $1 AND wallet_address = $2 AND status IN ('open', 'partial')
     ORDER BY opened_at ASC`,
    [instrumentKey, walletAddress],
  );
  return rows.map(mapRow);
}

/**
 * Reduce a lot by quantity sold. Updates remaining_quantity_raw.
 * If remaining reaches 0, marks lot as closed.
 */
export async function reduceLot(lotId: number, quantitySold: bigint): Promise<void> {
  const lot = await queryOne<Record<string, unknown>>(
    "SELECT remaining_quantity_raw FROM proj_pnl_lots WHERE id = $1",
    [lotId],
  );
  if (!lot) return;

  const remaining = BigInt(lot.remaining_quantity_raw as string);
  const newRemaining = remaining - quantitySold;

  if (newRemaining <= 0n) {
    await execute(
      "UPDATE proj_pnl_lots SET remaining_quantity_raw = '0', status = 'closed', closed_at = NOW() WHERE id = $1",
      [lotId],
    );
  } else {
    await execute(
      "UPDATE proj_pnl_lots SET remaining_quantity_raw = $2, status = 'partial' WHERE id = $1",
      [lotId, newRemaining.toString()],
    );
  }
}

/** Close a lot entirely. */
export async function closeLot(lotId: number): Promise<void> {
  await execute(
    "UPDATE proj_pnl_lots SET remaining_quantity_raw = '0', status = 'closed', closed_at = NOW() WHERE id = $1",
    [lotId],
  );
}

/** Get lots linked to an execution. */
export async function getLotsByExecution(executionId: number): Promise<Lot[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM proj_pnl_lots WHERE execution_id = $1 ORDER BY opened_at ASC",
    [executionId],
  );
  return rows.map(mapRow);
}

function mapRow(r: Record<string, unknown>): Lot {
  return {
    id: r.id as number,
    instrumentKey: r.instrument_key as string,
    walletAddress: r.wallet_address as string,
    side: r.side as string,
    quantityRaw: r.quantity_raw as string,
    costBasisUsd: r.cost_basis_usd != null ? String(r.cost_basis_usd) : null,
    priceUsd: r.price_usd != null ? String(r.price_usd) : null,
    remainingQuantityRaw: r.remaining_quantity_raw as string,
    executionId: r.execution_id as number | null,
    activityId: r.activity_id as number | null,
    namespace: r.namespace as string,
    chain: r.chain as string,
    status: r.status as string,
    openedAt: r.opened_at as string,
    closedAt: r.closed_at as string | null,
  };
}
