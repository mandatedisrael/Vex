/**
 * Top-up history + funding baseline repo.
 */

import { queryOne, query, execute } from "../client.js";
import type { FundingBaseline, TopupHistoryEntry, TopupEventType } from "../../types.js";

// ── Funding baseline ──────────────────────────────────────────────────

export async function getBaseline(): Promise<FundingBaseline> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT baseline_locked, baseline_total, last_topup_at, last_topup_amount, updated_at FROM funding_baseline WHERE id = 1",
  );
  if (!row) {
    return { baselineLocked: 0, baselineTotal: 0, lastTopupAt: null, lastTopupAmount: null, updatedAt: new Date().toISOString() };
  }
  return {
    baselineLocked: Number(row.baseline_locked),
    baselineTotal: Number(row.baseline_total),
    lastTopupAt: row.last_topup_at ? (row.last_topup_at as Date).toISOString() : null,
    lastTopupAmount: row.last_topup_amount != null ? Number(row.last_topup_amount) : null,
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export async function updateBaseline(locked: number, total: number, topupAmount?: number): Promise<void> {
  await execute(
    `UPDATE funding_baseline SET
      baseline_locked = $1, baseline_total = $2,
      last_topup_at = NOW(), last_topup_amount = $3, updated_at = NOW()
     WHERE id = 1`,
    [locked, total, topupAmount ?? null],
  );
}

// ── Top-up history ────────────────────────────────────────────────────

export async function recordEvent(entry: {
  eventType: TopupEventType;
  action?: string;
  amount?: number;
  balanceBefore?: number;
  balanceAfter?: number;
  source?: "auto" | "manual";
  error?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await execute(
    `INSERT INTO topup_history (event_type, action, amount, balance_before, balance_after, source, error, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.eventType,
      entry.action ?? null,
      entry.amount ?? null,
      entry.balanceBefore ?? null,
      entry.balanceAfter ?? null,
      entry.source ?? "auto",
      entry.error ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}

export async function getRecentHistory(limit = 20): Promise<TopupHistoryEntry[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM topup_history ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
  return rows.map((row) => ({
    id: row.id as number,
    eventType: row.event_type as TopupEventType,
    action: row.action as string | null,
    amount: row.amount != null ? Number(row.amount) : null,
    balanceBefore: row.balance_before != null ? Number(row.balance_before) : null,
    balanceAfter: row.balance_after != null ? Number(row.balance_after) : null,
    source: row.source as "auto" | "manual",
    error: row.error as string | null,
    metadata: (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) as Record<string, unknown>,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}
