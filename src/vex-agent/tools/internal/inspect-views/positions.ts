/**
 * Portfolio inspect — position views: open_positions, closed_positions, orders.
 * Lifecycle state of predictions, perps, orders, LP.
 */

import type { ToolResult } from "../../types.js";
import { ok } from "../types.js";

export async function inspectOpenPositions(addresses: string[], namespace?: string, limit = 20): Promise<ToolResult> {
  const { getOpen } = await import("@vex-agent/db/repos/open-positions.js");
  // `getOpen` returns the full wallet-scoped set (no SQL LIMIT in the repo); cap
  // the rows here to keep the tool surface bounded, matching the list-limit
  // pattern used by the other position/order views.
  const positions = (await getOpen(addresses, namespace)).slice(0, limit);

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
      contracts: p.contracts != null ? Number(p.contracts) : null,
      settlementAsset: p.settlementAssetKey,
      currentValue: p.currentValueUsd != null ? Number(p.currentValueUsd) : null,
      unrealizedPnl: p.unrealizedPnlUsd != null ? Number(p.unrealizedPnlUsd) : null,
      status: p.status,
      openedAt: p.openedAt,
    })),
  });
}

export async function inspectClosedPositions(addresses: string[], namespace?: string, limit = 20): Promise<ToolResult> {
  const { query } = await import("@vex-agent/db/client.js");
  // wallet-scoped: ANY('{}') matches nothing, so an empty set → no rows.
  const conditions: string[] = ["status != 'open'", "wallet_address = ANY($1::text[])"];
  const params: unknown[] = [addresses];
  let idx = 2;

  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }
  params.push(limit);

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

export async function inspectOrders(addresses: string[], namespace?: string, status?: string, limit = 20): Promise<ToolResult> {
  const { query } = await import("@vex-agent/db/client.js");
  const conditions: string[] = ["position_type = 'order'", "wallet_address = ANY($1::text[])"];
  const params: unknown[] = [addresses];
  let idx = 2;

  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }
  if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
  params.push(limit);

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM proj_open_positions WHERE ${conditions.join(" AND ")} ORDER BY opened_at DESC LIMIT $${idx}`,
    params,
  );

  return ok({
    view: "orders",
    count: rows.length,
    orders: rows.map(r => ({
      namespace: r.namespace,
      chain: r.chain,
      instrumentKey: r.instrument_key,
      positionKey: r.position_key,
      status: r.status,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
    })),
  });
}
