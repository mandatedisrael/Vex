/**
 * Balance sync — Khalani → proj_balances → proj_portfolio_snapshots.
 *
 * Khalani balance reads are scanned per chain, then written transactionally per
 * chain. Absent tokens are removed only for chains that were actually scanned.
 */

import { randomUUID } from "node:crypto";
import { getTokenBalancesAcrossChains } from "@tools/khalani/balances.js";
import { getCachedKhalaniChains } from "@tools/khalani/chains.js";
import { listWallets, type InventoryFamily } from "@tools/wallet/inventory.js";
import type { KhalaniToken, ChainFamily } from "@tools/khalani/types.js";
import { listLocalChains } from "@tools/evm-chains/registry.js";
import * as balancesRepo from "@vex-agent/db/repos/balances.js";
import type { BalanceRow } from "@vex-agent/db/repos/balances.js";
import { resolveChainHint } from "./chains.js";
import { syncLocalChainForWallet } from "./local-chain-balance-sync.js";
import { enrichChainOnePendleBalances } from "./pendle-enrichment.js";
import { PENDLE_CHAIN_ID } from "@tools/pendle/constants.js";
import logger from "@utils/logger.js";

/** ChainFamily ("eip155"|"solana") → inventory family ("evm"|"solana"). */
function toInventoryFamily(family: ChainFamily): InventoryFamily {
  return family === "solana" ? "solana" : "evm";
}

// ── Types ───────────────────────────────────────────────────────

export interface SyncResult {
  walletFamily: string;
  walletAddress: string;
  tokensUpdated: number;
  chainsUpdated: number;
  totalUsd: number;
}

export interface WalletSnapshotResult {
  walletFamily: string;
  walletAddress: string;
  snapshotId: number;
  totalUsd: number;
  pnlVsPrev: number | null;
}

export interface FullSyncResult {
  wallets: SyncResult[];
  /** One row per inventory wallet snapshotted this cycle. */
  snapshots: WalletSnapshotResult[];
  /** Aggregate USD across every synced wallet. */
  totalUsd: number;
  /** Shared id tying this cycle's per-wallet snapshot rows together. */
  snapshotGroupId: string;
}

export interface SelectiveSyncResult {
  wallets: SyncResult[];
  tokensUpdated: number;
  families: ChainFamily[];
}

// ── Core sync ───────────────────────────────────────────────────

/**
 * Sync balances for one wallet — Khalani chains via the Khalani scan, LOCAL
 * (non-Khalani) EVM chains via direct RPC. Both write the same transactional
 * per-chain replace, so callers (`fullBalanceSync`, `selectiveBalanceSync`) and
 * the snapshot / active_chains logic treat every chain uniformly.
 *
 * Routing is Khalani-registry-FIRST (same order as the inclusive resolver): a
 * chain genuinely present in the Khalani dynamic registry is synced via Khalani
 * even if the local registry also lists it — if Khalani later adds 4663, Khalani
 * wins automatically. Only chains in the local registry AND absent from Khalani
 * go to the direct-RPC path. When the ONLY requested chains are local, Khalani
 * is not called at all. For every pre-existing case (no local chain in scope)
 * the Khalani path is byte-identical to before.
 */
export async function syncWalletBalances(
  family: ChainFamily,
  address: string,
  chainIds?: number[],
): Promise<SyncResult> {
  const { khalaniChainIds, localChainIds, skipKhalani } = await partitionChainScope(family, chainIds);

  // Local chains FIRST so the Khalani path's final total-USD read (which sums
  // ALL of the wallet's proj_balances) already includes freshly-written local rows.
  let localTokens = 0;
  let localChainsUpdated = 0;
  for (const localChainId of localChainIds) {
    const local = await syncLocalChainForWallet(family, address, localChainId);
    localTokens += local.tokensUpdated;
    if (!local.skipped) localChainsUpdated += 1;
  }

  let base: SyncResult;
  if (skipKhalani) {
    // Only local chains were requested — do NOT call Khalani (an empty filter
    // there means "all Khalani chains"). Recompute the wallet total from the DB.
    const walletBalances = await balancesRepo.getBalances(address);
    base = {
      walletFamily: family,
      walletAddress: address,
      tokensUpdated: 0,
      chainsUpdated: 0,
      totalUsd: walletBalances.reduce((sum, b) => sum + (b.balanceUsd ?? 0), 0),
    };
  } else {
    base = await syncKhalaniWalletBalances(family, address, khalaniChainIds);
  }

  return {
    ...base,
    tokensUpdated: base.tokensUpdated + localTokens,
    chainsUpdated: base.chainsUpdated + localChainsUpdated,
  };
}

/**
 * Split a requested chain scope into Khalani vs local ids — Khalani registry
 * membership FIRST, local registry as fallback:
 * - A chain present in the Khalani dynamic registry routes to Khalani even if
 *   the local registry also lists it (upstream coverage wins by order).
 * - A chain is "local" only when it is in the local registry AND not in the
 *   Khalani registry.
 * - `chainIds` undefined → all Khalani chains (khalani filter undefined) + all
 *   local-only EVM chains (eip155 family only).
 * - `chainIds` provided  → the local-only subset goes direct-RPC; the rest go
 *   to Khalani. When nothing is left for Khalani, `skipKhalani` is set so the
 *   Khalani scan (whose empty filter means "all chains") is skipped entirely.
 * - Fail-open: if the Khalani registry fetch itself fails, partition on local
 *   registry membership alone — local chains keep syncing during a Khalani
 *   outage, and the Khalani scan surfaces its own error for its chains.
 */
async function partitionChainScope(
  family: ChainFamily,
  chainIds: number[] | undefined,
): Promise<{ khalaniChainIds: number[] | undefined; localChainIds: number[]; skipKhalani: boolean }> {
  if (family !== "eip155") {
    // No local chains outside EVM — preserve existing behavior exactly.
    return { khalaniChainIds: chainIds, localChainIds: [], skipKhalani: false };
  }

  const localRegistryIds = new Set(listLocalChains("eip155").map((chain) => chain.id));

  // Khalani-first: consult the dynamic registry (24h-cached; the Khalani scan
  // below reuses the same cache, so this adds no extra fetch). Fail-open on
  // registry-fetch failure (khalaniIds = null → local-registry partition).
  let khalaniIds: Set<number> | null = null;
  try {
    khalaniIds = new Set((await getCachedKhalaniChains()).map((chain) => chain.id));
  } catch {
    khalaniIds = null;
  }

  const isLocalOnly = (id: number): boolean =>
    localRegistryIds.has(id) && !(khalaniIds?.has(id) ?? false);

  if (chainIds === undefined) {
    const localChainIds = [...localRegistryIds].filter((id) => isLocalOnly(id));
    return { khalaniChainIds: undefined, localChainIds, skipKhalani: false };
  }

  const localChainIds = chainIds.filter((id) => isLocalOnly(id));
  const khalaniRemaining = chainIds.filter((id) => !isLocalOnly(id));
  if (khalaniRemaining.length === 0) {
    return { khalaniChainIds: undefined, localChainIds, skipKhalani: true };
  }
  return { khalaniChainIds: khalaniRemaining, localChainIds, skipKhalani: false };
}

/**
 * Sync balances for one wallet family via Khalani (byte-identical to the
 * pre-Wave-2 `syncWalletBalances`). Uses transactional full-replace per chain —
 * tokens absent from the response are removed.
 */
async function syncKhalaniWalletBalances(
  family: ChainFamily,
  address: string,
  chainIds?: number[],
): Promise<SyncResult> {
  // `address` is supplied by the caller (inventory iteration). Address-only —
  // the sync path never touches key material.

  // Fetch from Khalani. Scanning per chain avoids incomplete multi-chain
  // balance responses and lets cleanup distinguish "empty" from "not scanned".
  const scan = await getTokenBalancesAcrossChains({ address, family, chainIds });
  const tokens = scan.tokens;

  // Group by chainId for transactional replace
  const byChain = new Map<number, BalanceRow[]>();
  for (const token of tokens) {
    const row = mapTokenToBalance(family, address, token);
    const existing = byChain.get(token.chainId) ?? [];
    existing.push(row);
    byChain.set(token.chainId, existing);
  }

  // Get previously known chains — if Khalani now returns nothing for a chain,
  // we must replace with empty to remove stale "ghost" balances
  const previousChains = await balancesRepo.getBalancesByChain(address);
  const refreshedChainIds = new Set(scan.scannedChainIds);
  for (const prev of previousChains) {
    // Only clean chains that the scanner actually refreshed successfully.
    if (!refreshedChainIds.has(prev.chainId)) continue;
    if (!byChain.has(prev.chainId)) {
      byChain.set(prev.chainId, []); // empty = delete all tokens for this chain
    }
  }

  // Pendle enrichment (Wave 5) — merge tracked PT balances into the chain-1 set
  // BEFORE the per-chain replace. SCOPE LOCK (G2#2): run ONLY when the Khalani
  // scan actually refreshed chain 1, so a sync scoped to another chain never
  // synthesizes/replaces chain-1 rows. Fail-soft (keeps Khalani rows); the DB
  // read inside PROPAGATES (2b doctrine).
  if (refreshedChainIds.has(PENDLE_CHAIN_ID)) {
    const existing = byChain.get(PENDLE_CHAIN_ID) ?? [];
    const merged = await enrichChainOnePendleBalances(family, address, existing);
    if (merged.length > 0 || byChain.has(PENDLE_CHAIN_ID)) {
      byChain.set(PENDLE_CHAIN_ID, merged);
    }
  }

  // Replace per chain (transactional) — empty arrays delete stale rows
  let tokensUpdated = 0;
  for (const [chainId, rows] of byChain) {
    const count = await balancesRepo.replaceBalancesForChain(address, chainId, rows);
    tokensUpdated += count;
  }

  // Calculate total USD for this wallet
  const walletBalances = await balancesRepo.getBalances(address);
  const totalUsd = walletBalances.reduce((sum, b) => sum + (b.balanceUsd ?? 0), 0);

  logger.info("sync.balance.completed", {
    family,
    address: address.slice(0, 10) + "...",
    tokens: tokensUpdated,
    chains: byChain.size,
    chainErrors: scan.chainErrors.length,
    totalUsd: totalUsd.toFixed(2),
  });

  return {
    walletFamily: family,
    walletAddress: address,
    tokensUpdated,
    chainsUpdated: byChain.size,
    totalUsd,
  };
}

/**
 * Full balance sync — both wallet families + portfolio snapshot.
 */
export async function fullBalanceSync(): Promise<FullSyncResult> {
  // One group id ties every per-wallet snapshot row from this cycle together,
  // so an aggregate view can stitch a cycle back despite distinct created_at.
  const snapshotGroupId = randomUUID();
  const wallets: SyncResult[] = [];
  const snapshots: WalletSnapshotResult[] = [];
  let aggregateTotalUsd = 0;

  // Project EVERY inventory wallet (≤3 EVM + ≤3 Solana), one snapshot each.
  for (const family of ["eip155", "solana"] as const) {
    for (const entry of listWallets(toInventoryFamily(family))) {
      const sync = await syncWalletBalances(family, entry.address);
      wallets.push(sync);
      aggregateTotalUsd += sync.totalUsd;

      const positions = await buildPositionsBreakdown(family, entry.address);
      const positionData = positions as { chains?: Array<{ chainId: number }> };
      const chainSet = new Set<string>();
      for (const c of positionData.chains ?? []) chainSet.add(String(c.chainId));

      const { snapshotId, pnlVsPrev } = await balancesRepo.insertSnapshot({
        walletFamily: family,
        walletAddress: entry.address,
        snapshotGroupId,
        totalUsd: sync.totalUsd,
        positions,
        activeChains: [...chainSet],
      });
      snapshots.push({
        walletFamily: family,
        walletAddress: entry.address,
        snapshotId,
        totalUsd: sync.totalUsd,
        pnlVsPrev,
      });
    }
  }

  logger.info("sync.balance.full_completed", {
    wallets: wallets.length,
    snapshots: snapshots.length,
    totalUsd: aggregateTotalUsd.toFixed(2),
    snapshotGroupId,
  });

  // Refresh prediction mark-to-market after balance update
  try {
    const { refreshPredictionMtm } = await import("./mtm.js");
    await refreshPredictionMtm();
  } catch (err) {
    logger.warn("sync.balance.mtm_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { wallets, snapshots, totalUsd: aggregateTotalUsd, snapshotGroupId };
}

/**
 * Selective sync — only affected chains after a trade. Syncs EVERY inventory
 * wallet for the affected family (bounded ≤3) because the background pipeline
 * has no session context to know which wallet traded. Does NOT snapshot
 * (snapshots are produced only by full sync).
 */
export async function selectiveBalanceSync(chainHint: string): Promise<SelectiveSyncResult> {
  const { family, chainIds } = await resolveChainHint(chainHint);
  const ids = chainIds.length > 0 ? chainIds : undefined;
  const wallets: SyncResult[] = [];
  let tokensUpdated = 0;
  for (const entry of listWallets(toInventoryFamily(family))) {
    const sync = await syncWalletBalances(family, entry.address, ids);
    wallets.push(sync);
    tokensUpdated += sync.tokensUpdated;
  }
  return { wallets, tokensUpdated, families: [family] };
}

// ── Helpers ─────────────────────────────────────────────────────

function mapTokenToBalance(family: ChainFamily, walletAddress: string, token: KhalaniToken): BalanceRow {
  const balanceRaw = token.extensions?.balance ?? "0";
  const priceUsdStr = token.extensions?.price?.usd;
  const priceUsd = priceUsdStr ? parseFloat(priceUsdStr) : null;

  // Calculate USD value: balance in human units * price
  let balanceUsd: number | null = null;
  if (priceUsd !== null && balanceRaw !== "0") {
    try {
      const balanceHuman = Number(BigInt(balanceRaw)) / Math.pow(10, token.decimals);
      balanceUsd = balanceHuman * priceUsd;
    } catch {
      // BigInt parse failure — skip USD calculation
    }
  }

  return {
    walletFamily: family,
    walletAddress,
    chainId: token.chainId,
    tokenAddress: token.address,
    tokenSymbol: token.symbol,
    tokenName: token.name,
    balanceRaw,
    balanceUsd,
    priceUsd,
    decimals: token.decimals,
  };
}

/** Build the per-chain token breakdown for ONE wallet's snapshot row. */
async function buildPositionsBreakdown(
  family: ChainFamily,
  address: string,
): Promise<Record<string, unknown>> {
  const chainSummaries = await balancesRepo.getBalancesByChain(address);
  const chains: Array<Record<string, unknown>> = [];

  for (const summary of chainSummaries) {
    const tokens = await balancesRepo.getBalances(address, summary.chainId);
    chains.push({
      chainId: summary.chainId,
      totalUsd: summary.totalUsd,
      tokens: tokens.map(t => ({
        address: t.tokenAddress,
        symbol: t.tokenSymbol,
        balanceRaw: t.balanceRaw,
        balanceUsd: t.balanceUsd,
        priceUsd: t.priceUsd,
        decimals: t.decimals,
      })),
    });
  }

  const walletTotalUsd = chainSummaries.reduce((sum, c) => sum + c.totalUsd, 0);
  return { family, address, totalUsd: walletTotalUsd, chains };
}
