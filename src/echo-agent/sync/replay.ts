/**
 * Replay projections — one-time correction tool.
 *
 * Reads immutable audit trail (protocol_executions + protocol_capture_items),
 * truncates projection tables, and re-runs activity population with
 * type correction from MUTATION_MATRIX.
 *
 * Does NOT modify protocol_executions or protocol_capture_items.
 * TRUNCATES only: proj_activity, proj_open_positions, proj_pnl_lots.
 *
 * Idempotent: can run multiple times with same result.
 * Run once after W3 handler fixes are deployed.
 */

import { query, execute } from "@echo-agent/db/client.js";
import { MUTATION_MATRIX, isExpectedType } from "@echo-agent/tools/protocols/mutation-matrix.js";
import { extractExternalRefs, replayActivityFromCapture } from "@echo-agent/tools/protocols/capture-pipeline.js";
import logger from "@utils/logger.js";

interface ReplayStats {
  replayed: number;
  skipped: number;
  errors: number;
}

/**
 * Replay all projections from protocol_executions + protocol_capture_items.
 *
 * Steps:
 * 1. TRUNCATE projection tables (proj_activity, proj_open_positions, proj_pnl_lots)
 * 2. Read all successful executions chronologically
 * 3. For each execution: read its capture_items (batch truth), apply type correction, replay
 * 4. Return stats
 */
export async function replayProjections(): Promise<ReplayStats> {
  const stats: ReplayStats = { replayed: 0, skipped: 0, errors: 0 };

  // 1. Truncate projection tables only (audit trail is immutable)
  logger.info("replay.truncating_projections");
  await execute("TRUNCATE proj_activity, proj_open_positions, proj_pnl_lots, proj_pnl_matches");

  // 2. Read all successful executions chronologically
  const executions = await query<Record<string, unknown>>(
    `SELECT id, tool_id, namespace, params, trade_capture
     FROM protocol_executions
     WHERE success = true
     ORDER BY created_at ASC`,
    [],
  );

  logger.info("replay.starting", { executionCount: executions.length });

  for (const exec of executions) {
    const executionId = exec.id as number;
    const toolId = exec.tool_id as string;
    const namespace = exec.namespace as string;
    const params = (exec.params as Record<string, unknown>) ?? {};
    const storedCapture = (exec.trade_capture as Record<string, unknown>) ?? null;

    // Skip preview executions
    if (params.dryRun === true) {
      stats.skipped++;
      continue;
    }

    try {
      // 3. Read capture items for this execution (batch truth — preserves capture_item_id FK)
      const captureItemRows = await query<Record<string, unknown>>(
        "SELECT id, trade_capture FROM protocol_capture_items WHERE execution_id = $1 ORDER BY id ASC",
        [executionId],
      );

      // Build items: prefer capture_items (batch truth), fallback to execution.trade_capture
      let items: { id: number | null; data: Record<string, unknown> }[];
      if (captureItemRows.length > 0) {
        items = captureItemRows
          .filter(r => r.trade_capture != null)
          .map(r => ({ id: r.id as number, data: r.trade_capture as Record<string, unknown> }));
      } else if (storedCapture) {
        items = [{ id: null, data: storedCapture }];
      } else {
        stats.skipped++;
        continue;
      }

      if (items.length === 0) {
        stats.skipped++;
        continue;
      }

      // 4. Apply type correction per item (single-type tools only)
      // Dual-type tools (e.g. polymarket buy/sell) chose type at execution time
      // based on result.status — stored type is already correct, don't overwrite.
      const contract = MUTATION_MATRIX.get(toolId);
      const correctedItems = items.map(item => {
        if (!contract) return item;
        const currentType = typeof item.data.type === "string" ? item.data.type : "";
        if (currentType && !isExpectedType(contract, currentType)) {
          if (Array.isArray(contract.expectedType)) {
            logger.warn("replay.dual_type_mismatch", { toolId, executionId, storedType: currentType, allowed: contract.expectedType });
            return item;
          }
          return { ...item, data: { ...item.data, type: contract.expectedType } };
        }
        return item;
      });

      // 5. Replay activity with capture_item_id FK preserved
      const executionRefs = extractExternalRefs({ _tradeCapture: storedCapture });
      await replayActivityFromCapture(executionId, toolId, namespace, correctedItems, executionRefs);
      stats.replayed++;

    } catch (err) {
      stats.errors++;
      logger.warn("replay.execution_failed", {
        executionId, toolId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("replay.completed", stats);
  return stats;
}
