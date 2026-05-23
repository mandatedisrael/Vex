/**
 * Protocol runtime — discover_tools + execute_tool handlers.
 *
 * These are the two internal tools that the LLM uses to interact
 * with protocol capabilities. Discovery returns metadata.
 * Execution validates params, finds the handler, and calls it.
 */

import type { ProtocolExecuteRequest, ProtocolExecutionContext, ProtocolToolManifest } from "./types.js";
import type { ToolResult } from "../types.js";
import type { ActionKind } from "../taxonomy.js";
import { getProtocolHandler, getProtocolManifest } from "./catalog.js";
import { isPreviewExecution, validateCaptureContract } from "./capture-validator.js";
import { extractExternalRefs, populateCaptureItems } from "./capture-pipeline.js";
import { MUTATION_MATRIX } from "./mutation-matrix.js";
import { isExecutableNamespace, NAMESPACE_LIFECYCLE } from "./lifecycle.js";
import { sanitizeJsonbValue } from "@vex-agent/db/params.js";
import type { ContextUsageBand } from "@vex-agent/engine/core/context-band.js";
import logger from "@utils/logger.js";

export { discoverProtocolCapabilities } from "./discovery.js";

// ── Action taxonomy derivation (puzzle 5 phase 1A heuristic) ────
//
// `ProtocolToolManifest` does not yet carry `actionKind` — phase 1B will add
// it per protocol tool. Until then, this helper derives a best-effort kind
// from existing manifest fields (`mutating` + optional `discovery.sideEffectLevel`)
// so the central dispatcher can still surface a `ToolResult.actionKind` to
// the policy / approval / audit layers introduced in puzzle 5 phase 2+.
//
// Heuristic rules (Codex GREEN LIGHT 2026-05-23, puzzle 5/1A):
//   1. `isPreviewExecution(...)` → `read` — preview/dryRun is read-only
//      simulation regardless of `mutating` flag (also bypasses the
//      approval gate below).
//   2. `!manifest.mutating` → `read`.
//   3. `mutating` + `sideEffectLevel === "high"` → `user_wallet_broadcast`
//      (chain-binding tools). Phase 1B will distinguish
//      `user_wallet_broadcast` vs `provider_action_request` per protocol.
//   4. `mutating` + `sideEffectLevel === "low"` → `external_post`
//      (off-chain order submit, social post).
//   5. `mutating` + (`sideEffectLevel === "none"` or undefined) →
//      `external_post` CONSERVATIVELY — we'd rather over-tag than miss a
//      mutation. Phase 1B replaces the heuristic with per-manifest `actionKind`.
//
// `provider_action_request` is intentionally NEVER returned in 1A — backend
// signer infrastructure does not exist in repo yet; puzzle 5 phase 6 will
// route provider-funded calls through that path explicitly.
//
// Tested in `src/__tests__/vex-agent/tools/execute-tool-taxonomy.test.ts`.
export function deriveProtocolActionKind(
  manifest: ProtocolToolManifest,
  params: Record<string, unknown>,
): ActionKind {
  if (isPreviewExecution(manifest.toolId, params)) return "read";
  if (!manifest.mutating) return "read";
  if (manifest.discovery?.sideEffectLevel === "high") return "user_wallet_broadcast";
  return "external_post";
}

/**
 * Local helper — stamp the derived `actionKind` on a `ToolResult`. ALWAYS
 * overwrites any handler-set value: for protocol tools the manifest-driven
 * classifier is authoritative, not handler payload. A handler trying to
 * downgrade a `user_wallet_broadcast` mutation to `read` cannot bypass the
 * policy classifier (Codex final review, puzzle 5/1A — 2026-05-23). Tested
 * in `execute-tool-taxonomy.test.ts` ("handler-set actionKind cannot
 * override the derived classifier").
 */
function withActionKind(result: ToolResult, actionKind: ActionKind): ToolResult {
  return { ...result, actionKind };
}

// ── Execution ────────────────────────────────────────────────────

export async function executeProtocolTool(
  request: ProtocolExecuteRequest,
  context: ProtocolExecutionContext,
): Promise<ToolResult> {
  const manifest = getProtocolManifest(request.toolId);
  if (!manifest) {
    // Unknown manifest — leave `actionKind` undefined per Codex review
    // (puzzle 5/1A): policy layer treats missing `actionKind` as the
    // conservative "unknown action" signal.
    return {
      success: false,
      output: `Unknown protocol tool: ${request.toolId}. Use discover_tools to find available tools.`,
    };
  }

  // Derive target action kind ONCE — every subsequent return path stamps it
  // on the `ToolResult` so the dispatcher / policy / audit layers see the
  // target classification, NOT the `execute_tool` wrapper's `read`.
  const params = request.params ?? {};
  const derivedActionKind = deriveProtocolActionKind(manifest, params);

  // Note: `manifest.lifecycle` is always "active" after PR1 narrowed the
  // ToolLifecycle union; no runtime lifecycle gate at the per-tool level.
  // Per-namespace lifecycle is enforced below via `isExecutableNamespace`.

  // Per-namespace lifecycle gate — `deprecated_hidden` namespaces refuse
  // execution unless `VEX_ALLOW_DEPRECATED_PROTOCOLS=1`. `reserved` never
  // execute. See `lifecycle.ts` and `embeddings/_DEPRECATED.md`.
  if (!isExecutableNamespace(manifest.namespace)) {
    const status = NAMESPACE_LIFECYCLE[manifest.namespace];
    const hint = status === "deprecated_hidden"
      ? "Set VEX_ALLOW_DEPRECATED_PROTOCOLS=1 to allow execution."
      : "Reserved namespace has no executable handlers.";
    logger.info("protocol.execute.namespace_blocked", {
      toolId: request.toolId,
      namespace: manifest.namespace,
      lifecycle: status,
    });
    return withActionKind({
      success: false,
      output: `Namespace "${manifest.namespace}" is ${status} and not executable. ${hint}`,
    }, derivedActionKind);
  }

  if (manifest.requiresEnv && !process.env[manifest.requiresEnv]?.trim()) {
    return withActionKind({
      success: false,
      output: `${request.toolId} requires ${manifest.requiresEnv} to be set in .env`,
    }, derivedActionKind);
  }

  // Pressure-barrier guard for protocol tools — at band ≥ barrier, mutating
  // protocol calls are blocked unless they are preview/dryRun. The agent must
  // call `compact_now` first to clear the barrier. Same semantics as the
  // dispatcher's hard-deny for internal mutating tools.
  if (
    context.contextUsageBand
    && manifest.mutating
    && !isPreviewExecution(request.toolId, params)
  ) {
    const band = context.contextUsageBand;
    if (band === "barrier" || band === "critical") {
      logger.info("protocol.execute.pressure_denied", {
        toolId: request.toolId,
        band,
      });
      return withActionKind({
        success: false,
        output:
          `${request.toolId} is blocked at context pressure ${band}. `
          + `Call compact_now first to compact the conversation; the next turn after compaction restores the full tool set.`,
      }, derivedActionKind);
    }
  }

  // Validate params — presence (required) and runtime type (§1f).
  // Pre-PR1 runtime only checked `required`; that left handlers defending
  // against bad types with `as-any` casts on SDK enum params. Rejecting the
  // call here gives the LLM a clear error instead of silently coercing via
  // `str()` / `num()` readers inside each handler.
  for (const param of manifest.params) {
    const value = params[param.key];
    const missing = value === undefined || value === null || value === "";
    if (param.required && missing) {
      return withActionKind({
        success: false,
        output: `Missing required parameter "${param.key}" for ${request.toolId}`,
      }, derivedActionKind);
    }
    if (!missing) {
      const actualType = typeof value;
      // `ProtocolParamDef.type` is "string" | "number" | "boolean" — all
      // primitives observable via `typeof`. If we later add "object" /
      // "array" variants, widen the check (or move to a JsonSchema walker).
      if (actualType !== param.type) {
        return withActionKind({
          success: false,
          output: `Parameter "${param.key}" for ${request.toolId} has invalid type: expected ${param.type}, got ${actualType}`,
        }, derivedActionKind);
      }
    }
  }

  // Find handler
  const handler = getProtocolHandler(request.toolId);
  if (!handler) {
    return withActionKind({
      success: false,
      output: `No handler registered for ${request.toolId}. This is a bug — manifest exists but handler is missing.`,
    }, derivedActionKind);
  }

  // Approval gate — mutating tools require approval under restricted permission.
  // Preview (dryRun) is read-only simulation — skip approval.
  if (manifest.mutating && !context.approved && context.sessionPermission === "restricted" && !isPreviewExecution(request.toolId, params)) {
    logger.info("protocol.execute.approval_required", { toolId: request.toolId, permission: context.sessionPermission });
    return withActionKind({
      success: false,
      output: `${request.toolId} requires approval — mutating tool in restricted permission mode.`,
      pendingApproval: true,
    }, derivedActionKind);
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

    return withActionKind(result, derivedActionKind);
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
    const failedResult: ToolResult = withActionKind(
      { success: false, output: `${request.toolId} failed: ${message}` },
      derivedActionKind,
    );
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

  const { recordExecution } = await import("@vex-agent/db/repos/executions.js");
  const paramsForStorage = sanitizeRecord(params);
  const resultData = sanitizeRecord(result.data ?? {});
  const tradeCapture = isRecord(resultData._tradeCapture) ? resultData._tradeCapture : null;
  const tradeCaptureItems = sanitizeRecordArray(resultData._tradeCaptureItems);
  const externalRefs = extractExternalRefs(resultData);

  const executionId = await recordExecution(
    toolId, namespace, sessionId, paramsForStorage,
    resultData, result.success,
    tradeCapture, externalRefs, durationMs,
  );

  // Enqueue sync runs for this namespace (only on success — failed mutations don't need projection refresh)
  if (result.success && executionId > 0) {
    try {
      const { getJobsForNamespace, enqueueRun } = await import("@vex-agent/db/repos/sync.js");
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

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeJsonbValue(value);
  return isRecord(sanitized) ? sanitized : {};
}

function sanitizeRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const sanitized = sanitizeJsonbValue(value);
  if (!Array.isArray(sanitized)) return undefined;

  const records = sanitized.filter(isRecord);
  return records.length > 0 ? records : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
