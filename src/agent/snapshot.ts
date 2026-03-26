/**
 * Portfolio snapshot builder.
 *
 * Collects balances from all active chains via Khalani + native CLI,
 * calculates total USD, compares with previous snapshot for P&L.
 */

import { execFile } from "node:child_process";
import * as snapshotsRepo from "./db/repos/snapshots.js";
import { query } from "./db/client.js";
import { getDefaultTrackedChains, normalizePortfolioChain, resolvePortfolioChainName } from "./portfolio-chains.js";
import logger from "../utils/logger.js";

interface Position {
  chain: string;
  token: string;
  symbol: string;
  amount: string;
  usdValue: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Take a full portfolio snapshot across all active chains.
 * Calls CLI commands to fetch balances, stores in DB.
 */
export async function takeSnapshot(source = "cron"): Promise<number> {
  const activeChains = await getActiveChains();
  const positions: Position[] = [];

  // EVM balances (0G + any chain agent traded on)
  // CLI outputs: { success: true, address: "0x...", tokens: KhalaniToken[] }
  // KhalaniToken has: address, chainId, symbol, decimals, extensions.balance, extensions.price.usd
  try {
    const evmResult = await runCli(["khalani", "tokens", "balances", "--wallet", "eip155", "--json"]);
    const evmData = JSON.parse(evmResult);
    if (evmData.success && Array.isArray(evmData.tokens)) {
      for (const b of evmData.tokens) {
        const rawBalance = Number(b.extensions?.balance ?? 0);
        const decimals = Number(b.decimals ?? 0);
        const balance = decimals > 0 ? rawBalance / (10 ** decimals) : rawBalance;
        const priceUsd = Number(b.extensions?.price?.usd ?? 0);
        if (isNaN(balance) || isNaN(priceUsd)) {
          logger.warn("snapshot.evm.invalid_token_data", { symbol: b.symbol, balance: b.extensions?.balance, price: b.extensions?.price?.usd });
          continue;
        }
        positions.push({
          chain: resolvePortfolioChainName(b.chainId),
          token: b.address ?? "native",
          symbol: b.symbol ?? "???",
          amount: String(balance),
          usdValue: balance * priceUsd,
        });
      }
    } else if (evmData.success) {
      logger.warn("snapshot.evm.unexpected_shape", { keys: Object.keys(evmData) });
    }
  } catch (err) {
    logger.warn("snapshot.evm.failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Solana balances (same shape as EVM)
  try {
    const solResult = await runCli(["khalani", "tokens", "balances", "--wallet", "solana", "--json"]);
    const solData = JSON.parse(solResult);
    if (solData.success && Array.isArray(solData.tokens)) {
      for (const b of solData.tokens) {
        const rawBalance = Number(b.extensions?.balance ?? 0);
        const decimals = Number(b.decimals ?? 0);
        const balance = decimals > 0 ? rawBalance / (10 ** decimals) : rawBalance;
        const priceUsd = Number(b.extensions?.price?.usd ?? 0);
        if (isNaN(balance) || isNaN(priceUsd)) {
          logger.warn("snapshot.solana.invalid_token_data", { symbol: b.symbol, balance: b.extensions?.balance, price: b.extensions?.price?.usd });
          continue;
        }
        positions.push({
          chain: "solana",
          token: b.address ?? "native",
          symbol: b.symbol ?? "SOL",
          amount: String(balance),
          usdValue: balance * priceUsd,
        });
      }
    } else if (solData.success) {
      logger.warn("snapshot.solana.unexpected_shape", { keys: Object.keys(solData) });
    }
  } catch (err) {
    logger.warn("snapshot.solana.failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // 0G native balance fallback
  try {
    const ogResult = await runCli(["wallet", "balance", "--json"]);
    const ogData = JSON.parse(ogResult);
    const native = isRecord(ogData?.native) ? ogData.native : null;
    const balance = native?.balance != null
      ? String(native.balance)
      : ogData?.balance != null
        ? String(ogData.balance)
        : null;
    const usdValueRaw = native?.usdValue ?? ogData?.usdValue ?? 0;
    const usdValue = Number(usdValueRaw);
    if (ogData.success && balance != null) {
      const existing = positions.find(p => p.chain === "0g" && p.symbol === "0G");
      if (!existing) {
        positions.push({
          chain: "0g", token: "native", symbol: "0G",
          amount: balance,
          usdValue: Number.isFinite(usdValue) ? usdValue : 0,
        });
      }
    }
  } catch (err) { logger.debug("snapshot.0g_balance.fallback", { error: err instanceof Error ? err.message : String(err) }); }

  const totalUsd = positions.reduce((sum, p) => sum + p.usdValue, 0);

  // Compare with previous
  const prev = await snapshotsRepo.getLatest();
  let pnlVsPrev: number | undefined;
  let pnlPctVsPrev: number | undefined;
  if (prev && prev.totalUsd > 0) {
    pnlVsPrev = totalUsd - prev.totalUsd;
    pnlPctVsPrev = (pnlVsPrev / prev.totalUsd) * 100;
  }

  const id = await snapshotsRepo.insertSnapshot({
    totalUsd, positions, activeChains,
    pnlVsPrev, pnlPctVsPrev, source,
  });

  logger.info("snapshot.captured", { totalUsd: totalUsd.toFixed(2), positions: positions.length, chains: activeChains.length });
  return id;
}

/** Get active chains from trades + defaults. */
async function getActiveChains(): Promise<string[]> {
  const defaults = new Set(getDefaultTrackedChains());
  try {
    const rows = await query<{ chain: string }>("SELECT DISTINCT chain FROM trades");
    for (const r of rows) defaults.add(normalizePortfolioChain(r.chain));
  } catch { /* expected: no trades table or rows yet */ }
  return [...defaults];
}

function runCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("echoclaw", [...args], { timeout: 30_000, maxBuffer: 512 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}
