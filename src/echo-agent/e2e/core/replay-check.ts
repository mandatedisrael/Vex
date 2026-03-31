/**
 * Replay smoke — verify replayProjections() is truthful.
 *
 * 1. Take snapshot of projection tables
 * 2. Run replayProjections() (truncates + rebuilds)
 * 3. Take snapshot again
 * 4. Compare counts — should match
 * 5. Verify audit trail (executions + capture_items) unchanged
 */

import { replayProjections } from "@echo-agent/sync/replay.js";
import { takePipelineSnapshot, type PipelineSnapshot } from "./db-assertions.js";
import logger from "@utils/logger.js";

export interface ReplayCheckResult {
  before: PipelineSnapshot;
  after: PipelineSnapshot;
  replayStats: { replayed: number; skipped: number; errors: number };
  auditIntact: boolean;
  projectionsMatch: boolean;
}

export async function runReplayCheck(): Promise<ReplayCheckResult> {
  // 1. Snapshot before
  const before = await takePipelineSnapshot();
  logger.info("e2e.replay.before", before);

  // 2. Replay
  const replayStats = await replayProjections();
  logger.info("e2e.replay.stats", replayStats);

  // 3. Snapshot after
  const after = await takePipelineSnapshot();
  logger.info("e2e.replay.after", after);

  // 4. Audit trail must be unchanged
  const auditIntact = before.executions === after.executions
    && before.captureItems === after.captureItems;

  // 5. Projections should match (activities rebuilt from capture items)
  const projectionsMatch = before.activities === after.activities
    && before.openPositions === after.openPositions
    && before.lots === after.lots;

  if (!auditIntact) {
    logger.error("e2e.replay.audit_changed", { before, after });
  }
  if (!projectionsMatch) {
    logger.warn("e2e.replay.projection_drift", { before, after });
  }

  return { before, after, replayStats, auditIntact, projectionsMatch };
}
