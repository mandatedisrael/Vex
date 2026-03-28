/**
 * Position projector — maps activity events to open positions and lot ledger.
 *
 * Called from activity-populator after each proj_activity insert.
 *
 * Rules:
 * - perps/prediction with position_key → proj_open_positions (open/close based on captureStatus)
 * - order (DCA/limit) with position_key → proj_open_positions (open/cancel lifecycle)
 * - lp with position_key → proj_open_positions (zap-in=open, zap-out=close, zap-migrate=close+open)
 * - spot buy → open lot in proj_pnl_lots
 * - spot sell → FIFO reduce lots in proj_pnl_lots
 * - bridge/lend/stake/reward → skip (no position or lot)
 */

import * as openPositionsRepo from "@echo-agent/db/repos/open-positions.js";
import * as pnlLotsRepo from "@echo-agent/db/repos/pnl-lots.js";
import type { Activity } from "@echo-agent/db/repos/activity.js";
import logger from "@utils/logger.js";

const OPEN_STATUSES = new Set(["open", "executed"]);
const CLOSE_STATUSES = new Set(["closed", "cancelled", "claimed"]);

/**
 * Project an activity event into open positions and/or lot ledger.
 */
export async function projectPosition(activity: Activity): Promise<void> {
  const { productType } = activity;

  switch (productType) {
    case "perps":
    case "prediction":
      return projectLifecyclePosition(activity);
    case "order":
      return projectOrderLifecycle(activity);
    case "lp":
      return projectLpLifecycle(activity);
    case "spot":
      return projectSpotLot(activity);
    default:
      // bridge, lend, stake, reward — no position or lot projection
      return;
  }
}

// ── Perps / Prediction position lifecycle ─────────────────────────

async function projectLifecyclePosition(activity: Activity): Promise<void> {
  const { positionKey, productType, walletAddress, instrumentKey, captureStatus } = activity;
  if (!positionKey) return;

  const status = captureStatus ?? "unknown";

  if (OPEN_STATUSES.has(status)) {
    await openPositionsRepo.upsertPosition({
      namespace: activity.namespace,
      positionType: productType,
      chain: activity.chain,
      externalId: positionKey,
      walletAddress: walletAddress ?? "",
      instrumentKey: instrumentKey ?? undefined,
      positionKey,
      status: "open",
      data: activity.meta,
    });
    logger.debug("sync.position.opened", { positionKey, productType });

  } else if (CLOSE_STATUSES.has(status)) {
    const closeStatus = status === "cancelled" ? "cancelled" : "closed";
    const closed = await openPositionsRepo.closePosition(activity.namespace, productType, positionKey, closeStatus);
    if (closed) {
      logger.debug("sync.position.closed", { positionKey, productType, closeStatus });
    }
  }
}

// ── Order lifecycle (DCA, limit orders) ───────────────────────────

async function projectOrderLifecycle(activity: Activity): Promise<void> {
  const { positionKey, walletAddress, instrumentKey, captureStatus } = activity;
  if (!positionKey) return;

  const status = captureStatus ?? "unknown";

  if (OPEN_STATUSES.has(status)) {
    await openPositionsRepo.upsertPosition({
      namespace: activity.namespace,
      positionType: "order",
      chain: activity.chain,
      externalId: positionKey,
      walletAddress: walletAddress ?? "",
      instrumentKey: instrumentKey ?? undefined,
      positionKey,
      status: "open",
      data: activity.meta,
    });
    logger.debug("sync.order.opened", { positionKey });

  } else if (status === "cancelled") {
    await openPositionsRepo.closePosition(activity.namespace, "order", positionKey, "cancelled");
    logger.debug("sync.order.cancelled", { positionKey });

  } else if (status === "executed" || status === "filled") {
    // Order filled — close the order position
    await openPositionsRepo.closePosition(activity.namespace, "order", positionKey, "filled");
    logger.debug("sync.order.filled", { positionKey });
  }
}

// ── LP lifecycle (zap-in/out/migrate) ─────────────────────────────

async function projectLpLifecycle(activity: Activity): Promise<void> {
  const { positionKey, walletAddress, instrumentKey } = activity;
  if (!positionKey) return;

  const action = (activity.meta as Record<string, unknown>)?.action as string | undefined;

  if (action === "zap-in") {
    await openPositionsRepo.upsertPosition({
      namespace: activity.namespace,
      positionType: "lp",
      chain: activity.chain,
      externalId: positionKey,
      walletAddress: walletAddress ?? "",
      instrumentKey: instrumentKey ?? undefined,
      positionKey,
      status: "open",
      data: activity.meta,
    });
    logger.debug("sync.lp.opened", { positionKey });

  } else if (action === "zap-out") {
    await openPositionsRepo.closePosition(activity.namespace, "lp", positionKey, "closed");
    logger.debug("sync.lp.closed", { positionKey });

  } else if (action === "zap-migrate") {
    // Close old position, open new (new instrumentKey from poolTo)
    await openPositionsRepo.closePosition(activity.namespace, "lp", positionKey, "migrated");
    // New position opened with new instrumentKey (from meta.poolTo)
    const newPool = (activity.meta as Record<string, unknown>)?.poolTo as string | undefined;
    if (newPool && instrumentKey) {
      await openPositionsRepo.upsertPosition({
        namespace: activity.namespace,
        positionType: "lp",
        chain: activity.chain,
        externalId: positionKey, // same NFT ID can be reused
        walletAddress: walletAddress ?? "",
        instrumentKey,
        positionKey,
        status: "open",
        data: activity.meta,
      });
      logger.debug("sync.lp.migrated", { positionKey, newPool });
    }
  }
}

// ── Spot lot ledger ───────────────────────────────────────────────

async function projectSpotLot(activity: Activity): Promise<void> {
  const { instrumentKey, walletAddress, tradeSide } = activity;
  if (!instrumentKey || !walletAddress) return;

  if (tradeSide === "buy") {
    const quantity = activity.outputAmount ?? "0";
    if (quantity === "0") return; // skip zero-quantity

    await pnlLotsRepo.openLot({
      instrumentKey,
      walletAddress,
      side: "buy",
      quantityRaw: quantity,
      costBasisUsd: activity.valueUsd ?? undefined,
      executionId: activity.executionId,
      activityId: activity.id,
      namespace: activity.namespace,
      chain: activity.chain,
    });
    logger.debug("sync.lot.opened", { instrumentKey });

  } else if (tradeSide === "sell") {
    const quantityToSell = BigInt(activity.inputAmount ?? "0");
    if (quantityToSell <= 0n) return;

    const openLots = await pnlLotsRepo.getOpenLots(instrumentKey, walletAddress);
    let remaining = quantityToSell;

    for (const lot of openLots) {
      if (remaining <= 0n) break;
      const lotRemaining = BigInt(lot.remainingQuantityRaw);
      const toReduce = remaining < lotRemaining ? remaining : lotRemaining;
      await pnlLotsRepo.reduceLot(lot.id, toReduce);
      remaining -= toReduce;
    }

    if (remaining > 0n) {
      logger.warn("sync.lot.insufficient_inventory", {
        instrumentKey,
        quantitySold: quantityToSell.toString(),
        shortfall: remaining.toString(),
        hint: "Sold more than tracked lots — possible external deposit or missing capture",
      });
    }

    logger.debug("sync.lot.reduced", { instrumentKey, quantitySold: quantityToSell.toString() });
  }
}
