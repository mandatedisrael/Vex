/**
 * Replay smoke — verify replayProjections() is truthful.
 *
 * 1. Take snapshot (counts + content hashes) of projection tables
 * 2. Run replayProjections() (truncates + rebuilds)
 * 3. Take snapshot again
 * 4. Compare counts AND content hashes — both must match
 * 5. Verify audit trail (executions + capture_items) unchanged
 */

import { createHash } from "node:crypto";
import { replayProjections } from "@echo-agent/sync/replay.js";
import { takePipelineSnapshot, type PipelineSnapshot } from "./db-assertions.js";
import { query } from "@echo-agent/db/client.js";
import logger from "@utils/logger.js";

// ── Content hashing — business fields only, no timestamps ──────

interface ProjectionHashes {
  activity: string;
  positions: string;
  lots: string;
  matches: string;
}

async function hashProjections(): Promise<ProjectionHashes> {
  // Hash business fields only — exclude capture_item_id (auto-increment FK that
  // changes after TRUNCATE without RESTART IDENTITY, causing false hash drift)
  const activityRows = await query(
    `SELECT execution_id, namespace, activity_type, product_type,
            trade_side, chain, wallet_address, instrument_key, position_key, capture_status,
            input_value_usd, output_value_usd, fee_value_usd, unit_price_usd, valuation_source,
            benchmark_asset_key, settlement_asset_key, input_value_native, output_value_native
     FROM proj_activity ORDER BY execution_id, id`,
    [],
  );

  const positionRows = await query(
    `SELECT namespace, position_type, chain, wallet_address,
            instrument_key, position_key, status, external_id,
            entry_price_usd, notional_usd, fee_usd, contracts, settlement_asset_key
     FROM proj_open_positions ORDER BY namespace, position_type, external_id`,
    [],
  );

  const lotRows = await query(
    `SELECT execution_id, instrument_key, namespace, chain, wallet_address,
            side, status, quantity_raw, remaining_quantity_raw, cost_basis_usd, price_usd,
            cost_basis_native, benchmark_asset_key
     FROM proj_pnl_lots ORDER BY instrument_key, opened_at, id`,
    [],
  );

  // Hash business fields only — exclude sell_activity_id and lot_id (auto-increment FKs
  // that change after TRUNCATE without RESTART IDENTITY, causing false hash drift)
  const matchRows = await query(
    `SELECT match_kind, instrument_key, wallet_address,
            quantity_matched, cost_basis_usd, proceeds_usd, realized_pnl_usd,
            cost_basis_native, proceeds_native, realized_pnl_native, benchmark_asset_key,
            namespace, chain
     FROM proj_pnl_matches ORDER BY instrument_key, namespace, id`,
    [],
  );

  return {
    activity: createHash("sha256").update(JSON.stringify(activityRows)).digest("hex"),
    positions: createHash("sha256").update(JSON.stringify(positionRows)).digest("hex"),
    lots: createHash("sha256").update(JSON.stringify(lotRows)).digest("hex"),
    matches: createHash("sha256").update(JSON.stringify(matchRows)).digest("hex"),
  };
}

// ── Replay check ───────────────────────────────────────────────

export interface ReplayCheckResult {
  before: PipelineSnapshot & { hashes: ProjectionHashes };
  after: PipelineSnapshot & { hashes: ProjectionHashes };
  replayStats: { replayed: number; skipped: number; errors: number };
  auditIntact: boolean;
  projectionsMatch: boolean;
  hashesMatch: { activity: boolean; positions: boolean; lots: boolean; matches: boolean };
}

export async function runReplayCheck(): Promise<ReplayCheckResult> {
  // 1. Snapshot before (counts + hashes)
  const beforeCounts = await takePipelineSnapshot();
  const beforeHashes = await hashProjections();
  const before = { ...beforeCounts, hashes: beforeHashes };
  logger.info("e2e.replay.before", { counts: beforeCounts, hashes: beforeHashes });

  // 2. Replay
  const replayStats = await replayProjections();
  logger.info("e2e.replay.stats", replayStats);

  // 3. Snapshot after
  const afterCounts = await takePipelineSnapshot();
  const afterHashes = await hashProjections();
  const after = { ...afterCounts, hashes: afterHashes };
  logger.info("e2e.replay.after", { counts: afterCounts, hashes: afterHashes });

  // 4. Audit trail must be unchanged
  const auditIntact = before.executions === after.executions
    && before.captureItems === after.captureItems;

  // 5. Content hashes must match (not just counts)
  const hashesMatch = {
    activity: beforeHashes.activity === afterHashes.activity,
    positions: beforeHashes.positions === afterHashes.positions,
    lots: beforeHashes.lots === afterHashes.lots,
    matches: beforeHashes.matches === afterHashes.matches,
  };

  const projectionsMatch = hashesMatch.activity && hashesMatch.positions && hashesMatch.lots && hashesMatch.matches;

  if (!auditIntact) {
    logger.error("e2e.replay.audit_changed", { before: beforeCounts, after: afterCounts });
  }
  if (!projectionsMatch) {
    logger.warn("e2e.replay.projection_drift", { hashesMatch, before: beforeHashes, after: afterHashes });
  }

  return { before, after, replayStats, auditIntact, projectionsMatch, hashesMatch };
}
