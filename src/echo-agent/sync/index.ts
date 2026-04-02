/**
 * Sync module public API.
 *
 * initSync() — call on boot (after migrations).
 * syncTick() — call periodically from engine (every 60s).
 */

import { seedSyncJobs } from "./seed.js";
import { fullBalanceSync } from "./balance-sync.js";
import { drainPendingRuns } from "./worker.js";
import * as syncRepo from "@echo-agent/db/repos/sync.js";
import logger from "@utils/logger.js";

/** Default periodic interval for full balance refresh (5 min). */
const DEFAULT_PERIODIC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Initialize sync pipeline on boot.
 *
 * Order matters:
 * 1. Seed jobs (idempotent)
 * 2. Drain pending runs from previous process (selective, no snapshot)
 * 3. Full balance sync + authoritative startup snapshot
 */
export async function initSync(): Promise<void> {
  logger.info("sync.init.starting");

  // 1. Seed default sync jobs
  await seedSyncJobs();

  // 2. Drain backlog from previous run (avoids double-snapshot)
  const backlog = await drainPendingRuns();
  if (backlog.processed > 0) {
    logger.info("sync.init.backlog_drained", { processed: backlog.processed });
  }

  // 3. Authoritative startup full sync + snapshot
  try {
    const result = await fullBalanceSync();
    logger.info("sync.init.completed", {
      totalUsd: result.totalUsd.toFixed(2),
      wallets: result.wallets.length,
      snapshotId: result.snapshotId,
    });
  } catch (err) {
    logger.error("sync.init.balance_sync_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't throw — agent should still start even if balance sync fails
  }
}

/**
 * Periodic sync tick — called by engine every ~60s.
 *
 * 1. Drain any pending post-mutation runs
 * 2. Check if periodic jobs are due (balances, prediction_settlement, etc.)
 */
export async function syncTick(): Promise<void> {
  // 1. Drain post-mutation runs
  const drain = await drainPendingRuns();

  // 2. Check all periodic jobs
  const periodicJobs = (await syncRepo.getAllJobs()).filter(
    j => j.strategy === "periodic" && j.namespace === "_global",
  );

  for (const job of periodicJobs) {
    const intervalMs = (job.intervalSeconds ?? 300) * 1000;

    const lastRun = await syncRepo.getLastCompletedRun(job.id);
    const lastRunAge = lastRun?.endedAt
      ? Date.now() - new Date(lastRun.endedAt).getTime()
      : Infinity;

    if (lastRunAge <= intervalMs) continue;

    try {
      if (job.syncType === "balances") {
        const result = await fullBalanceSync();
        const runId = await syncRepo.enqueueRun(job.id);
        await syncRepo.completeRun(runId, { periodic: true, totalUsd: result.totalUsd }, result.wallets.reduce((s, w) => s + w.tokensUpdated, 0));
      } else if (job.syncType === "prediction_settlement") {
        const { reconcilePredictionSettlements } = await import("./prediction-settlement-sync.js");
        const settlementResult = await reconcilePredictionSettlements();
        const runId = await syncRepo.enqueueRun(job.id);
        await syncRepo.completeRun(runId, { ...settlementResult }, settlementResult.closed);
      } else {
        logger.debug("sync.tick.unknown_periodic", { syncType: job.syncType });
      }
    } catch (err) {
      logger.warn("sync.tick.periodic_failed", {
        syncType: job.syncType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export { fullBalanceSync, selectiveBalanceSync } from "./balance-sync.js";
export { drainPendingRuns } from "./worker.js";
export { seedSyncJobs } from "./seed.js";
