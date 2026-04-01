/**
 * Activity repo — proj_activity CRUD.
 *
 * Unified cross-protocol activity feed.
 * One execution can have N activity rows (batch captures like predict.closeAll).
 */

import { query, queryOne, execute } from "../client.js";

export interface ActivityRow {
  namespace: string;
  activityType: string;
  productType: string;
  tradeSide: string | null;
  chain: string;
  executionId: number;
  captureItemId: number | null;
  walletAddress: string | null;
  inputToken: string | null;
  inputAmount: string | null;
  outputToken: string | null;
  outputAmount: string | null;
  valueUsd: number | null;
  inputValueUsd: string | null;
  outputValueUsd: string | null;
  feeValueUsd: string | null;
  unitPriceUsd: string | null;
  valuationSource: string | null;
  captureStatus: string | null;
  positionKey: string | null;
  instrumentKey: string | null;
  externalRefs: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export interface Activity extends ActivityRow {
  id: number;
  createdAt: string;
}

/** Insert activity row. Returns 0 if insert failed. */
export async function insertActivity(row: ActivityRow): Promise<number> {
  const result = await queryOne<{ id: number }>(
    `INSERT INTO proj_activity
     (namespace, activity_type, product_type, trade_side, chain, execution_id, capture_item_id,
      wallet_address, input_token, input_amount, output_token, output_amount,
      value_usd, input_value_usd, output_value_usd, fee_value_usd, unit_price_usd, valuation_source,
      capture_status, position_key, instrument_key, external_refs, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
     RETURNING id`,
    [
      row.namespace, row.activityType, row.productType, row.tradeSide, row.chain,
      row.executionId, row.captureItemId, row.walletAddress, row.inputToken, row.inputAmount,
      row.outputToken, row.outputAmount, row.valueUsd,
      row.inputValueUsd, row.outputValueUsd, row.feeValueUsd, row.unitPriceUsd, row.valuationSource,
      row.captureStatus, row.positionKey,
      row.instrumentKey, JSON.stringify(row.externalRefs), JSON.stringify(row.meta),
    ],
  );
  return result?.id ?? 0;
}

/** Get activities with optional filters. */
export async function getActivities(opts?: {
  walletAddress?: string;
  namespace?: string;
  productType?: string;
  limit?: number;
}): Promise<Activity[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts?.walletAddress) { conditions.push(`wallet_address = $${idx++}`); params.push(opts.walletAddress); }
  if (opts?.namespace) { conditions.push(`namespace = $${idx++}`); params.push(opts.namespace); }
  if (opts?.productType) { conditions.push(`product_type = $${idx++}`); params.push(opts.productType); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 50;
  params.push(limit);

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM proj_activity ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );
  return rows.map(mapRow);
}

/** Get activities by execution_id (batch captures produce multiple rows). */
export async function getByExecution(executionId: number): Promise<Activity[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM proj_activity WHERE execution_id = $1 ORDER BY id ASC",
    [executionId],
  );
  return rows.map(mapRow);
}

/** Get activities by position_key (for lifecycle tracking). */
export async function getByPositionKey(positionKey: string): Promise<Activity[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM proj_activity WHERE position_key = $1 ORDER BY created_at ASC",
    [positionKey],
  );
  return rows.map(mapRow);
}

/** Get activities by instrument_key (for lot tracking). */
export async function getByInstrumentKey(instrumentKey: string): Promise<Activity[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM proj_activity WHERE instrument_key = $1 ORDER BY created_at ASC",
    [instrumentKey],
  );
  return rows.map(mapRow);
}

function mapRow(r: Record<string, unknown>): Activity {
  const inputValueUsd = r.input_value_usd != null ? String(r.input_value_usd) : null;
  const outputValueUsd = r.output_value_usd != null ? String(r.output_value_usd) : null;
  // Backwards compat: valueUsd computed from new fields
  const legacyValueUsd = r.value_usd != null ? Number(r.value_usd)
    : outputValueUsd != null ? Number(outputValueUsd)
    : inputValueUsd != null ? Number(inputValueUsd)
    : null;

  return {
    id: r.id as number,
    namespace: r.namespace as string,
    activityType: r.activity_type as string,
    productType: r.product_type as string,
    tradeSide: r.trade_side as string | null,
    chain: r.chain as string,
    executionId: r.execution_id as number,
    captureItemId: r.capture_item_id as number | null,
    walletAddress: r.wallet_address as string | null,
    inputToken: r.input_token as string | null,
    inputAmount: r.input_amount as string | null,
    outputToken: r.output_token as string | null,
    outputAmount: r.output_amount as string | null,
    valueUsd: legacyValueUsd,
    inputValueUsd,
    outputValueUsd,
    feeValueUsd: r.fee_value_usd != null ? String(r.fee_value_usd) : null,
    unitPriceUsd: r.unit_price_usd != null ? String(r.unit_price_usd) : null,
    valuationSource: r.valuation_source as string | null,
    captureStatus: r.capture_status as string | null,
    positionKey: r.position_key as string | null,
    instrumentKey: r.instrument_key as string | null,
    externalRefs: (r.external_refs as Record<string, unknown>) ?? {},
    meta: (r.meta as Record<string, unknown>) ?? {},
    createdAt: r.created_at as string,
  };
}
