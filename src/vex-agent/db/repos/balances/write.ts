/**
 * Balances repo — write paths (proj_balances upsert / full-replace).
 */

import { execute, getPool } from "../../client.js";
import type { BalanceRow } from "./types.js";

/** Upsert a single balance row. */
export async function upsertBalance(row: BalanceRow): Promise<void> {
  await execute(
    `INSERT INTO proj_balances (wallet_family, wallet_address, chain_id, token_address, token_symbol, token_name, balance_raw, balance_usd, price_usd, decimals, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (wallet_address, chain_id, token_address)
     DO UPDATE SET wallet_family = $1, token_symbol = $5, token_name = $6, balance_raw = $7, balance_usd = $8, price_usd = $9, decimals = $10, synced_at = NOW()`,
    [row.walletFamily, row.walletAddress, row.chainId, row.tokenAddress,
     row.tokenSymbol, row.tokenName, row.balanceRaw, row.balanceUsd, row.priceUsd, row.decimals],
  );
}

/**
 * Transactional full-replace for (walletAddress, chainId).
 * Deletes all existing rows for this wallet+chain, then inserts new ones.
 * Tokens absent from Khalani response are removed — no "ghost" balances.
 */
export async function replaceBalancesForChain(
  walletAddress: string,
  chainId: number,
  newRows: BalanceRow[],
): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Delete all existing for this wallet+chain
    await client.query(
      "DELETE FROM proj_balances WHERE wallet_address = $1 AND chain_id = $2",
      [walletAddress, chainId],
    );

    // Insert new rows
    for (const row of newRows) {
      await client.query(
        `INSERT INTO proj_balances (wallet_family, wallet_address, chain_id, token_address, token_symbol, token_name, balance_raw, balance_usd, price_usd, decimals, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [row.walletFamily, row.walletAddress, row.chainId, row.tokenAddress,
         row.tokenSymbol, row.tokenName, row.balanceRaw, row.balanceUsd, row.priceUsd, row.decimals],
      );
    }

    await client.query("COMMIT");
    return newRows.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
