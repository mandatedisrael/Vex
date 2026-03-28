/**
 * Balance sync — Khalani → proj_balances → proj_portfolio_snapshots.
 *
 * One Khalani call per wallet family returns native + altcoins with USD prices.
 * Transactional full-replace per chain — absent tokens are removed.
 */

import { getKhalaniClient } from "@tools/khalani/client.js";
import { requireEvmWallet, requireSolanaWallet } from "@tools/wallet/multi-auth.js";
import type { KhalaniToken, ChainFamily } from "@tools/khalani/types.js";
import * as balancesRepo from "@echo-agent/db/repos/balances.js";
import type { BalanceRow } from "@echo-agent/db/repos/balances.js";
import { resolveChainHint } from "./chains.js";
import logger from "@utils/logger.js";

// ── Types ───────────────────────────────────────────────────────

export interface SyncResult {
  walletFamily: string;
  walletAddress: string;
  tokensUpdated: number;
  chainsUpdated: number;
  totalUsd: number;
}

export interface FullSyncResult {
  wallets: SyncResult[];
  totalUsd: number;
  snapshotId: number;
  pnlVsPrev: number | null;
}

// ── Core sync ───────────────────────────────────────────────────

/**
 * Sync balances for one wallet family via Khalani.
 * Uses transactional full-replace per chain — tokens absent from response are removed.
 */
export async function syncWalletBalances(
  family: ChainFamily,
  chainIds?: number[],
): Promise<SyncResult | null> {
  // Resolve wallet address — skip if not configured
  let address: string;
  try {
    address = family === "solana"
      ? requireSolanaWallet().address
      : requireEvmWallet().address;
  } catch {
    logger.debug("sync.balance.wallet_not_configured", { family });
    return null;
  }

  // Fetch from Khalani
  const client = getKhalaniClient();
  const tokens = await client.getTokenBalances(address, chainIds);

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
  const refreshedChainIds = new Set(byChain.keys());
  for (const prev of previousChains) {
    // If we filtered by chainIds, only clean chains in the filter
    if (chainIds && !chainIds.includes(prev.chainId)) continue;
    if (!refreshedChainIds.has(prev.chainId)) {
      byChain.set(prev.chainId, []); // empty = delete all tokens for this chain
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
  const wallets: SyncResult[] = [];

  // Try EVM
  const evm = await syncWalletBalances("eip155");
  if (evm) wallets.push(evm);

  // Try Solana
  const sol = await syncWalletBalances("solana");
  if (sol) wallets.push(sol);

  // Build snapshot
  const totalUsd = await balancesRepo.getTotalUsd();
  const positions = await buildPositionsBreakdown();
  const activeChains = [...new Set(wallets.flatMap(w => {
    // Collect chainIds from balances
    return [];  // filled from positions below
  }))];

  // Extract active chains from positions
  const positionData = positions as { wallets?: Array<{ chains?: Array<{ chainId: number }> }> };
  const chainSet = new Set<string>();
  for (const w of positionData.wallets ?? []) {
    for (const c of w.chains ?? []) {
      chainSet.add(String(c.chainId));
    }
  }

  const prev = await balancesRepo.getLatestSnapshot();
  const pnlVsPrev = prev ? totalUsd - prev.totalUsd : null;
  const snapshotId = await balancesRepo.insertSnapshot(totalUsd, positions, [...chainSet], "sync");

  logger.info("sync.balance.full_completed", {
    wallets: wallets.length,
    totalUsd: totalUsd.toFixed(2),
    snapshotId,
    pnlVsPrev: pnlVsPrev?.toFixed(2) ?? "first",
  });

  return { wallets, totalUsd, snapshotId, pnlVsPrev };
}

/**
 * Selective sync — only affected chains after a trade.
 * Does NOT create a snapshot (snapshot only on full sync).
 */
export async function selectiveBalanceSync(chainHint: string): Promise<SyncResult | null> {
  const { family, chainIds } = await resolveChainHint(chainHint);
  return syncWalletBalances(family, chainIds.length > 0 ? chainIds : undefined);
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

/** Build per-wallet, per-chain breakdown for snapshot positions. */
async function buildPositionsBreakdown(): Promise<Record<string, unknown>> {
  const wallets: Array<Record<string, unknown>> = [];

  for (const family of ["eip155", "solana"] as const) {
    let address: string;
    try {
      address = family === "solana"
        ? requireSolanaWallet().address
        : requireEvmWallet().address;
    } catch {
      continue;
    }

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
    wallets.push({ family, address, totalUsd: walletTotalUsd, chains });
  }

  return { wallets };
}
