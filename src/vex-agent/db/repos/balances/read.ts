/**
 * Balances repo — read paths (per-wallet balances, per-chain aggregation, total USD).
 */

import { query, queryOne } from "../../client.js";
import { mapBalanceRow } from "./mappers.js";
import type { BalanceRow, ChainSummary } from "./types.js";

/** Get all balances for a wallet, optionally filtered by chain. */
export async function getBalances(walletAddress: string, chainId?: number): Promise<BalanceRow[]> {
  const sql = chainId !== undefined
    ? "SELECT * FROM proj_balances WHERE wallet_address = $1 AND chain_id = $2 ORDER BY balance_usd DESC NULLS LAST"
    : "SELECT * FROM proj_balances WHERE wallet_address = $1 ORDER BY balance_usd DESC NULLS LAST";
  const params = chainId !== undefined ? [walletAddress, chainId] : [walletAddress];
  const rows = await query<Record<string, unknown>>(sql, params);
  return rows.map(mapBalanceRow);
}

/** Per-chain aggregation for UI. */
export async function getBalancesByChain(walletAddress: string): Promise<ChainSummary[]> {
  const rows = await query<{ chain_id: string | number; total_usd: string; token_count: string }>(
    `SELECT chain_id, COALESCE(SUM(balance_usd), 0) AS total_usd, COUNT(*) AS token_count
     FROM proj_balances WHERE wallet_address = $1
     GROUP BY chain_id ORDER BY total_usd DESC`,
    [walletAddress],
  );
  return rows.map(r => ({
    chainId: Number(r.chain_id),
    totalUsd: parseFloat(r.total_usd),
    tokenCount: parseInt(r.token_count, 10),
  }));
}

/**
 * Total USD value. `addresses` undefined → ALL wallets (legacy/global); a set →
 * only those wallets; an EMPTY set → 0 (never global — Codex 5E-2). Session
 * reads pass the selected wallet set (puzzle 5 phase 5E-2).
 */
export async function getTotalUsd(addresses?: string[]): Promise<number> {
  if (addresses !== undefined && addresses.length === 0) return 0;
  const row = addresses !== undefined
    ? await queryOne<{ total: string }>(
        "SELECT COALESCE(SUM(balance_usd), 0) AS total FROM proj_balances WHERE wallet_address = ANY($1::text[])",
        [addresses],
      )
    : await queryOne<{ total: string }>(
        "SELECT COALESCE(SUM(balance_usd), 0) AS total FROM proj_balances",
      );
  return parseFloat(row?.total ?? "0");
}
