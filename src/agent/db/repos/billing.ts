/**
 * Billing snapshots repo — tracks provider balance over time.
 */

import { query, queryOne, execute } from "../client.js";

export interface BillingSnapshot {
  providerBalance: number;
  providerAvailable: number;
  providerLocked: number;
  sessionCost: number;
  fetchedAt: string;
}

export async function insertSnapshot(s: Omit<BillingSnapshot, "fetchedAt"> & { provider?: string; currency?: string }): Promise<void> {
  await execute(
    "INSERT INTO billing_snapshots (provider_balance, provider_available, provider_locked, session_cost, provider, currency) VALUES ($1, $2, $3, $4, $5, $6)",
    [s.providerBalance, s.providerAvailable, s.providerLocked, s.sessionCost, s.provider ?? null, s.currency ?? null],
  );
}

export async function getLatest(): Promise<BillingSnapshot | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT provider_balance, provider_available, provider_locked, session_cost, fetched_at FROM billing_snapshots ORDER BY fetched_at DESC LIMIT 1",
  );
  if (!row) return null;
  return {
    providerBalance: Number(row.provider_balance),
    providerAvailable: Number(row.provider_available),
    providerLocked: Number(row.provider_locked),
    sessionCost: Number(row.session_cost),
    fetchedAt: row.fetched_at as string,
  };
}

export async function getHistory(hours = 24): Promise<BillingSnapshot[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT provider_balance, provider_available, provider_locked, session_cost, fetched_at
     FROM billing_snapshots WHERE fetched_at > NOW() - INTERVAL '${hours} hours' ORDER BY fetched_at ASC`,
  );
  return rows.map(r => ({
    providerBalance: Number(r.provider_balance),
    providerAvailable: Number(r.provider_available),
    providerLocked: Number(r.provider_locked),
    sessionCost: Number(r.session_cost),
    fetchedAt: r.fetched_at as string,
  }));
}
