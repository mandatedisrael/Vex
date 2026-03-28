/**
 * Protocol runtime — discover_tools + execute_tool handlers.
 *
 * These are the two internal tools that the LLM uses to interact
 * with protocol capabilities. Discovery returns metadata.
 * Execution validates params, finds the handler, and calls it.
 */

import type {
  ProtocolDiscoveryRequest,
  ProtocolDiscoveryResult,
  ProtocolExecuteRequest,
  ProtocolExecutionContext,
} from "./types.js";
import type { ToolResult } from "../types.js";
import { PROTOCOL_TOOLS, PROTOCOL_NAMESPACE_ALLOWLIST, getProtocolHandler, getProtocolManifest } from "./catalog.js";
import logger from "@utils/logger.js";

const DEFAULT_DISCOVERY_LIMIT = 15;

// ── Discovery ────────────────────────────────────────────────────

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function discoverProtocolCapabilities(
  request: ProtocolDiscoveryRequest,
): ProtocolDiscoveryResult {
  const limit = typeof request.limit === "number" && Number.isFinite(request.limit)
    ? Math.max(1, Math.floor(request.limit))
    : DEFAULT_DISCOVERY_LIMIT;

  const matchingTools = PROTOCOL_TOOLS
    .filter(m => !m.requiresEnv || Boolean(process.env[m.requiresEnv]?.trim()))
    .filter(m => request.namespace ? m.namespace === request.namespace : true)
    .filter(m => request.includeMutating ? true : !m.mutating)
    .filter(m => request.includeDeclared ? true : m.lifecycle === "active")
    .filter(m => {
      if (!request.query) return true;
      const q = normalizeText(request.query);
      return [m.toolId, m.namespace, m.description]
        .some(v => normalizeText(v).includes(q));
    });

  const tools = matchingTools
    .slice(0, limit)
    .map(m => ({
      toolId: m.toolId,
      namespace: m.namespace,
      lifecycle: m.lifecycle,
      description: m.description,
      mutating: m.mutating,
      params: m.params,
      exampleParams: m.exampleParams,
    }));
  const totalCount = matchingTools.length;
  const hasMore = totalCount > tools.length;

  const warnings: string[] = [];
  if (tools.length === 0) {
    warnings.push("No protocol capabilities matched the query/filter.");
  }
  if (hasMore) {
    warnings.push(`Showing first ${tools.length} of ${totalCount} matching capabilities. Increase limit to see more.`);
  }

  const activeNamespaces = new Set(PROTOCOL_TOOLS.map(t => t.namespace));
  const declaredOnly = PROTOCOL_NAMESPACE_ALLOWLIST.filter(ns => !activeNamespaces.has(ns));
  if (declaredOnly.length > 0) {
    warnings.push(`Declared-only namespaces (coming soon): ${declaredOnly.join(", ")}`);
  }

  return { success: true, count: tools.length, totalCount, hasMore, tools, warnings };
}

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

  if (manifest.lifecycle !== "active") {
    return {
      success: false,
      output: `Protocol tool "${request.toolId}" is declared but not yet executable.`,
    };
  }

  if (manifest.requiresEnv && !process.env[manifest.requiresEnv]?.trim()) {
    return {
      success: false,
      output: `${request.toolId} requires ${manifest.requiresEnv} to be set in .env`,
    };
  }

  // Validate required params
  const params = request.params ?? {};
  for (const param of manifest.params) {
    if (param.required) {
      const value = params[param.key];
      if (value === undefined || value === null || value === "") {
        return {
          success: false,
          output: `Missing required parameter "${param.key}" for ${request.toolId}`,
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
  if (manifest.mutating && !context.approved && context.loopMode !== "full") {
    logger.info("protocol.execute.approval_required", { toolId: request.toolId, loopMode: context.loopMode });
    return {
      success: false,
      output: `${request.toolId} requires approval — mutating tool in ${context.loopMode} mode.`,
      pendingApproval: true,
    };
  }

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
    if (manifest.mutating) {
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
    const failedResult: ToolResult = { success: false, output: `${request.toolId} failed: ${message}` };
    if (manifest.mutating) {
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

/**
 * Extract external_refs from handler result data for correlation/lookup.
 * Maps known fields per namespace to canonical keys.
 */
function extractExternalRefs(data: Record<string, unknown> | undefined): Record<string, string> {
  if (!data) return {};
  const refs: Record<string, string> = {};
  // Correlation keys (NOT identity like walletAddress)
  const candidates = ["txHash", "orderId", "positionPubkey", "orderKey", "positionId", "conditionId", "signature", "instrumentKey", "positionKey"];

  for (const key of candidates) {
    let value = data[key];
    // Normalize: Polymarket returns "orderID" instead of "orderId"
    if (value === undefined && key === "orderId") value = data["orderID"];
    // Coerce numbers to strings (KyberSwap orderId can be number)
    if (typeof value === "number") value = String(value);
    if (typeof value === "string" && value) refs[key] = value;
  }

  // Check nested _tradeCapture for refs not in top-level data
  const capture = data._tradeCapture as Record<string, unknown> | undefined;
  if (capture) {
    if (!refs.signature && typeof capture.signature === "string" && capture.signature) {
      refs.signature = capture.signature;
    }
    // positionKey from capture (perps, predictions, LP)
    if (!refs.positionKey && typeof capture.positionKey === "string" && capture.positionKey) {
      refs.positionKey = capture.positionKey;
    }
    // instrumentKey from capture (spot, predictions, LP)
    if (!refs.instrumentKey && typeof capture.instrumentKey === "string" && capture.instrumentKey) {
      refs.instrumentKey = capture.instrumentKey;
    }
    // positionPubkey sometimes only in meta (perps close, prediction sell/claim)
    const meta = capture.meta as Record<string, unknown> | undefined;
    if (!refs.positionPubkey && typeof meta?.positionPubkey === "string" && meta.positionPubkey) {
      refs.positionPubkey = meta.positionPubkey;
    }
    // conditionId from meta (Polymarket)
    if (!refs.conditionId && typeof meta?.conditionId === "string" && meta.conditionId) {
      refs.conditionId = meta.conditionId;
    }
  }

  return refs;
}

async function captureExecution(
  toolId: string,
  namespace: string,
  sessionId: string | null,
  params: Record<string, unknown>,
  result: ToolResult,
  durationMs: number,
): Promise<void> {
  const { recordExecution } = await import("@echo-agent/db/repos/executions.js");
  const tradeCapture = (result.data?._tradeCapture as Record<string, unknown>) ?? null;
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
  if (tradeCapture && executionId > 0 && result.success) {
    try {
      const { populateActivity } = await import("@echo-agent/sync/activity-populator.js");
      await populateActivity(executionId, toolId, namespace, tradeCapture, externalRefs);
    } catch (err) {
      logger.warn("protocol.execute.activity_populate_failed", {
        toolId, namespace, executionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
