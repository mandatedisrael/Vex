/**
 * Synthetic capture — records settlement/reconciliation events through the
 * standard capture pipeline without going through runtime.ts.
 *
 * Used by prediction-settlement-sync.ts for auto-settled positions.
 *
 * Pipeline: validate → recordExecution() → populateCaptureItems()
 * → activity-populator → position-projector
 *
 * NOT in MUTATION_MATRIX (no phantom entries). capture-validator returns
 * true for unknown toolIds, so the standard pipeline handles them.
 */

import { extractExternalRefs, populateCaptureItems } from "@echo-agent/tools/protocols/capture-pipeline.js";
import logger from "@utils/logger.js";

export interface SyntheticCaptureOpts {
  /** Synthetic toolId — NOT in MUTATION_MATRIX (e.g. "settlement_sync.jupiter"). */
  toolId: string;
  /** Protocol namespace ("solana", "polymarket"). */
  namespace: string;
  /** Session ID (null for background sync). */
  sessionId?: string | null;
  /** Trade capture with standard fields (type, status, walletAddress, positionKey, etc.). */
  tradeCapture: Record<string, unknown>;
  /** Source identifier for audit trail. */
  source: string;
}

/**
 * Validate synthetic capture has minimum required fields.
 * Own boundary guard since MUTATION_MATRIX is bypassed.
 */
function validateSyntheticCapture(capture: Record<string, unknown>): void {
  const type = capture.type;
  const status = capture.status;
  const walletAddress = capture.walletAddress;
  const positionKey = capture.positionKey;

  if (typeof type !== "string" || !type) {
    throw new Error("synthetic capture: missing type");
  }
  if (typeof status !== "string" || !status) {
    throw new Error("synthetic capture: missing status");
  }
  if (typeof walletAddress !== "string" || !walletAddress) {
    throw new Error("synthetic capture: missing walletAddress");
  }
  if (typeof positionKey !== "string" || !positionKey) {
    throw new Error("synthetic capture: missing positionKey");
  }

  // instrumentKey optional (claim has exception), but warn if missing for prediction
  if (type === "prediction" && !capture.instrumentKey) {
    logger.warn("synthetic_capture.no_instrument_key", { positionKey });
  }
}

/**
 * Record a synthetic execution and push it through the capture pipeline.
 *
 * Returns the execution ID (> 0 on success, 0 on failure).
 */
export async function recordSyntheticCapture(opts: SyntheticCaptureOpts): Promise<number> {
  const { toolId, namespace, sessionId, tradeCapture, source } = opts;

  // Local validation boundary
  validateSyntheticCapture(tradeCapture);

  const externalRefs = extractExternalRefs({ _tradeCapture: tradeCapture });

  // Write audit row to protocol_executions
  const { recordExecution } = await import("@echo-agent/db/repos/executions.js");
  const executionId = await recordExecution(
    toolId,
    namespace,
    sessionId ?? null,
    { source, detectedAt: new Date().toISOString() },
    { _tradeCapture: tradeCapture },
    true, // success
    tradeCapture,
    externalRefs,
    0, // durationMs — not applicable for sync-originated captures
  );

  if (executionId <= 0) {
    logger.warn("synthetic_capture.execution_failed", { toolId, namespace });
    return 0;
  }

  // Push through capture pipeline → activity → position projector
  try {
    await populateCaptureItems(executionId, toolId, namespace, tradeCapture, undefined, externalRefs);
  } catch (err) {
    logger.warn("synthetic_capture.pipeline_failed", {
      toolId, namespace, executionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("synthetic_capture.recorded", {
    toolId, namespace, executionId, source,
    positionKey: tradeCapture.positionKey,
    status: tradeCapture.status,
  });

  return executionId;
}
