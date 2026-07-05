/**
 * Pendle balance enrichment for Ethereum (chain 1) — Wave 5.
 *
 * Khalani's cross-chain balance scan can miss (or leave unpriced) exotic Pendle
 * PT tokens. This step reads the wallet's TRACKED Pendle PT balances directly
 * from Ethereum RPC, prices them from Pendle's assets/all, and MERGES the rows
 * into the chain-1 balance set the caller is about to write — deduped by address:
 *   - a Pendle-priced row WINS over a Khalani row with no price,
 *   - a Khalani row that already has a price WINS (upstream is authoritative once
 *     it prices the token).
 *
 * SCOPE LOCK (G2#2): the caller runs this ONLY when the Khalani scan actually
 * refreshed chain 1. A selective sync scoped to another chain must never
 * synthesize/replace chain-1 rows.
 *
 * Failure semantics (2b doctrine): RPC + Pendle-API failures are FAIL-SOFT (the
 * Khalani rows pass through untouched). The tracked-token DB read PROPAGATES so a
 * local-DB fault surfaces and the worker retries, exactly like the Khalani path.
 */

import { formatUnits, getAddress, type Address } from "viem";

import { getPendleClient } from "@tools/pendle/client.js";
import { getPendlePublicClient } from "@tools/pendle/evm-client.js";
import { PENDLE_CHAIN_ID, PENDLE_ERC20_ABI } from "@tools/pendle/constants.js";
import { PENDLE_CHAIN_SLUG } from "@tools/pendle/chains.js";
import type { ChainFamily } from "@tools/khalani/types.js";
import * as activityRepo from "@vex-agent/db/repos/activity.js";
import type { BalanceRow } from "@vex-agent/db/repos/balances.js";
import logger from "@utils/logger.js";

/**
 * Merge Pendle PT rows into the wallet's Ethereum balance rows (dedup by address).
 * `khalaniRows` is the chain-1 set the caller will write. Returns the merged set.
 * DB read propagates; RPC/API failures fail soft (return `khalaniRows` unchanged).
 */
export async function enrichChainOnePendleBalances(
  family: ChainFamily,
  walletAddress: string,
  khalaniRows: BalanceRow[],
): Promise<BalanceRow[]> {
  if (family !== "eip155") return khalaniRows;

  // DB READ — propagates (a failing tracked-token query is a local-DB fault the
  // operator must see, not a condition to paper over).
  const trackedAddrs = await activityRepo.getTrackedEvmTokensForChain({
    walletAddress,
    chainKeys: [PENDLE_CHAIN_SLUG],
  });
  if (trackedAddrs.length === 0) return khalaniRows;

  // RPC + API — FAIL-SOFT. On any error keep the Khalani rows untouched.
  let pendleRows: BalanceRow[];
  try {
    const assets = await getPendleClient().getAllAssets();
    const assetByLower = new Map(assets.map((a) => [a.address.toLowerCase(), a]));

    // Restrict to tokens Pendle recognizes as PT (self-limiting to PT holdings —
    // equivalent to the PT addresses recorded in proj_activity meta.pendle).
    const ptAddrs: Address[] = [];
    for (const raw of trackedAddrs) {
      let addr: Address;
      try {
        addr = getAddress(raw);
      } catch {
        continue;
      }
      if (assetByLower.get(addr.toLowerCase())?.baseType === "PT") ptAddrs.push(addr);
    }
    if (ptAddrs.length === 0) return khalaniRows;

    const client = getPendlePublicClient();
    const owner = getAddress(walletAddress);
    const reads = await client.multicall({
      allowFailure: true,
      contracts: ptAddrs.map(
        (address) => ({ address, abi: PENDLE_ERC20_ABI, functionName: "balanceOf", args: [owner] }) as const,
      ),
    });

    pendleRows = [];
    for (let i = 0; i < ptAddrs.length; i++) {
      const read = reads[i];
      if (read?.status !== "success") continue;
      const balance = read.result as bigint;
      if (balance <= 0n) continue;
      const address = ptAddrs[i]!;
      const asset = assetByLower.get(address.toLowerCase())!;
      const decimals = asset.decimals ?? 18;
      const priceUsd = asset.priceUsd;
      const human = Number(formatUnits(balance, decimals));
      const balanceUsd = priceUsd !== null && Number.isFinite(human) ? human * priceUsd : null;
      pendleRows.push({
        walletFamily: family,
        walletAddress,
        chainId: PENDLE_CHAIN_ID,
        tokenAddress: address,
        tokenSymbol: asset.symbol,
        tokenName: null,
        balanceRaw: balance.toString(),
        balanceUsd,
        priceUsd,
        decimals,
      });
    }
  } catch (err) {
    logger.warn("sync.pendle_enrichment.failed", {
      address: walletAddress.slice(0, 10) + "...",
      error: err instanceof Error ? err.name : "unknown",
    });
    return khalaniRows;
  }

  if (pendleRows.length === 0) return khalaniRows;
  return mergePendleRows(khalaniRows, pendleRows);
}

/**
 * Dedup-by-address merge. A Pendle-priced row wins over an unpriced Khalani row;
 * a Khalani row that already has a price wins over the Pendle row. Exported for
 * focused unit tests.
 */
export function mergePendleRows(khalaniRows: BalanceRow[], pendleRows: BalanceRow[]): BalanceRow[] {
  const byLower = new Map<string, BalanceRow>();
  for (const row of khalaniRows) byLower.set(row.tokenAddress.toLowerCase(), row);
  for (const pendle of pendleRows) {
    const key = pendle.tokenAddress.toLowerCase();
    const existing = byLower.get(key);
    if (!existing) {
      byLower.set(key, pendle);
      continue;
    }
    // Khalani row with a price is authoritative; otherwise the Pendle-priced row wins.
    if (existing.priceUsd === null && pendle.priceUsd !== null) {
      byLower.set(key, pendle);
    }
  }
  return [...byLower.values()];
}
