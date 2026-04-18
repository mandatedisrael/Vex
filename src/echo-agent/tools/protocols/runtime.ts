/**
 * Protocol runtime — discover_tools + execute_tool handlers.
 *
 * These are the two internal tools that the LLM uses to interact
 * with protocol capabilities. Discovery returns metadata.
 * Execution validates params, finds the handler, and calls it.
 */

import type { ProtocolExecuteRequest, ProtocolExecutionContext } from "./types.js";
import type { ToolResult } from "../types.js";
import { getProtocolHandler, getProtocolManifest } from "./catalog.js";
import { isPreviewExecution, validateCaptureContract } from "./capture-validator.js";
import { extractExternalRefs, populateCaptureItems } from "./capture-pipeline.js";
import { MUTATION_MATRIX } from "./mutation-matrix.js";
import logger from "@utils/logger.js";

export { discoverProtocolCapabilities } from "./discovery.js";

// ── Execution ────────────────────────────────────────────────────

export async function executeProtocolTool(
  request: ProtocolExecuteRequest,
  context: ProtocolExecutionContext,
): Promise<ToolResult> {
  const manifest = getProtocolManifest(request.toolId);
  if (!manifest) {
    return {
      success: false,
      output: `Unknown protocol tool: ${request.toolId}. Use discover_tools to find available tools.`,
    };
  }

  // Note: `manifest.lifecycle` is always "active" after PR1 narrowed the
  // ToolLifecycle union; no runtime lifecycle gate needed. If a future
  // variant is added (e.g. "declared" / "experimental"), reintroduce the
  // gate here *and* decide the discovery contract in tandem.

  if (manifest.requiresEnv && !process.env[manifest.requiresEnv]?.trim()) {
    return {
      success: false,
      output: `${request.toolId} requires ${manifest.requiresEnv} to be set in .env`,
    };
  }

  // Validate params — presence (required) and runtime type (§1f).
  // Pre-PR1 runtime only checked `required`; that left handlers defending
  // against bad types with `as any` casts on SDK enum params. Rejecting the
  // call here gives the LLM a clear error instead of silently coercing via
  // `str()` / `num()` readers inside each handler.
  const params = request.params ?? {};
  for (const param of manifest.params) {
    const value = params[param.key];
    const missing = value === undefined || value === null || value === "";
    if (param.required && missing) {
      return {
        success: false,
        output: `Missing required parameter "${param.key}" for ${request.toolId}`,
      };
    }
    if (!missing) {
      const actualType = typeof value;
      // `ProtocolParamDef.type` is "string" | "number" | "boolean" — all
      // primitives observable via `typeof`. If we later add "object" /
      // "array" variants, widen the check (or move to a JsonSchema walker).
      if (actualType !== param.type) {
        return {
          success: false,
          output: `Parameter "${param.key}" for ${request.toolId} has invalid type: expected ${param.type}, got ${actualType}`,
        };
      }
    }
  }

  // Find handler
  const handler = getProtocolHandler(request.toolId);
  if (!handler) {
    return {
      success: false,
      output: `No handler registered for ${request.toolId}. This is a bug — manifest exists but handler is missing.`,
    };
  }

  // Approval gate — mutating tools require approval in restricted/off mode
  // Preview (dryRun) is read-only simulation — skip approval
  if (manifest.mutating && !context.approved && context.loopMode !== "full" && !isPreviewExecution(request.toolId, params)) {
    logger.info("protocol.execute.approval_required", { toolId: request.toolId, loopMode: context.loopMode });
    return {
      success: false,
      output: `${request.toolId} requires approval — mutating tool in ${context.loopMode} mode.`,
      pendingApproval: true,
    };
  }

  // Determine preview BEFORE handler call — flag survives thrown exceptions
  const isPreview = isPreviewExecution(request.toolId, params);
  const shouldCapture = manifest.mutating && !isPreview;

  // Execute + capture
  const startTime = Date.now();
  try {
    const result = await handler(params, context);
    const durationMs = Date.now() - startTime;

    logger.info("protocol.execute.completed", {
      toolId: request.toolId,
      success: result.success,
      durationMs,
    });

    // Capture mutating execution — awaited inline for deterministic projection readiness
    // protocol_executions: ALL mutations (success + failure) for audit
    // proj_activity + positions/lots: ONLY successful mutations (business truth)
    // Preview executions skip capture entirely (determined before handler call)
    if (shouldCapture) {
      try {
        await captureExecution(request.toolId, manifest.namespace, context.sessionId ?? null, params, result, durationMs);
      } catch (err) {
        logger.warn("protocol.execute.capture_failed", {
          toolId: request.toolId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    logger.warn("protocol.execute.failed", {
      toolId: request.toolId,
      error: message,
      durationMs,
    });

    // Capture thrown mutations to audit trail only (no projections for failures)
    // Preview: skip capture even for thrown exceptions
    const failedResult: ToolResult = { success: false, output: `${request.toolId} failed: ${message}` };
    if (shouldCapture) {
      try {
        await captureExecution(request.toolId, manifest.namespace, context.sessionId ?? null, params, failedResult, durationMs);
      } catch (captureErr) {
        logger.warn("protocol.execute.capture_failed", {
          toolId: request.toolId,
          error: captureErr instanceof Error ? captureErr.message : String(captureErr),
        });
      }
    }

    return failedResult;
  }
}

// ── Execution capture ───────────────────────────────────────────

// extractExternalRefs moved to capture-pipeline.ts (shared with replay.ts)

async function captureExecution(
  toolId: string,
  namespace: string,
  sessionId: string | null,
  params: Record<string, unknown>,
  result: ToolResult,
  durationMs: number,
): Promise<void> {
  // Defense-in-depth: preview results are NOT mutations — skip entire capture pipeline
  if (result.data?.dryRun === true) return;

  const { recordExecution } = await import("@echo-agent/db/repos/executions.js");
  const tradeCapture = (result.data?._tradeCapture as Record<string, unknown>) ?? null;
  const tradeCaptureItems = result.data?._tradeCaptureItems as Record<string, unknown>[] | undefined;
  const externalRefs = extractExternalRefs(result.data);

  const executionId = await recordExecution(
    toolId, namespace, sessionId, params,
    result.data ?? {}, result.success,
    tradeCapture, externalRefs, durationMs,
  );

  // Enqueue sync runs for this namespace (only on success — failed mutations don't need projection refresh)
  if (result.success && executionId > 0) {
    try {
      const { getJobsForNamespace, enqueueRun } = await import("@echo-agent/db/repos/sync.js");
      const jobs = await getJobsForNamespace(namespace);
      for (const job of jobs) {
        await enqueueRun(job.id, executionId);
      }
    } catch (err) {
      logger.warn("protocol.execute.sync_enqueue_failed", {
        toolId, namespace, executionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Populate proj_activity ONLY for successful executions (projections = business truth)
  // Failed mutations go to protocol_executions audit log but NOT to activity/positions/lots
  if (executionId > 0 && result.success) {
    // Validate capture contract before sending to projection pipeline
    // For fanOut:"items" tools, validate items (not summary) — summary intentionally lacks per-item identity
    const contract = MUTATION_MATRIX.get(toolId);
    const itemsToValidate = contract?.fanOut === "items" && Array.isArray(tradeCaptureItems) && tradeCaptureItems.length > 0
      ? tradeCaptureItems
      : tradeCapture ? [tradeCapture] : [];
    const allValid = itemsToValidate.every(item => validateCaptureContract(toolId, item));
    if (!allValid) {
      logger.warn("protocol.execute.capture_validation_failed", {
        toolId, namespace, executionId,
        hint: "Capture blocked by validator — not sent to projection pipeline",
      });
      return;
    }
    try {
      await populateCaptureItems(executionId, toolId, namespace, tradeCapture, tradeCaptureItems, externalRefs);
    } catch (err) {
      logger.warn("protocol.execute.activity_populate_failed", {
        toolId, namespace, executionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// populateCaptureItems moved to capture-pipeline.ts (shared with replay.ts)
