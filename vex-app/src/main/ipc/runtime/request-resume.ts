/**
 * `vex.runtime.requestResume` — atomic lease claim + status flip,
 * then fire-and-forget continuation via lazy `engine` import.
 *
 * The IPC result reports the synchronous outcome of the claim
 * (`resumed` / `lease_busy` / `blocked_*`); the actual continuation
 * runs to completion in the background with explicit
 * `.then` / `.catch` / `.finally` so the audit
 * `runtime_control_request` row never hangs on `observed`.
 *
 * `lease_busy` carries `retryAfterMs` (computed from
 * `currentLease.expiresAt - now()`) but never the owner id —
 * lease ownership stays internal runtime state.
 */

import { randomUUID } from "node:crypto";
import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  runtimeRequestInputSchema,
  runtimeRequestResumeResultSchema,
  type RuntimeRequestResumeResult,
} from "@shared/schemas/runtime.js";
import { getActiveRunForSession } from "../../database/mission-runs-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "./_errors.js";
import { ensureEngineDbUrl } from "./_ensure-engine-db-url.js";
import { emitControlStateAfterChange } from "./_emit-control-state.js";

const LEASE_TTL_MS = 5 * 60_000; // 5 minutes
const RESUME_OWNER_PREFIX = "ipc-resume-";

export function registerRuntimeRequestResumeHandler(): () => void {
  return registerHandler({
    channel: CH.runtime.requestResume,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeRequestResumeResultSchema,
    handle: async (input, ctx): Promise<Result<RuntimeRequestResumeResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const state = await getActiveRunForSession(input.sessionId);
        if (!state.ok) return state;
        if (!state.data.hasActiveRun || state.data.missionRunId === null) {
          return ok({ outcome: "no_active_run" });
        }
        const status = state.data.status;
        const runId = state.data.missionRunId;
        if (status === "running") {
          return ok({ outcome: "already_running", runId });
        }
        if (status === "paused_approval") {
          return ok({
            outcome: "blocked_approval",
            pendingApprovalId: runId, // placeholder; precise id comes in puzzle 05
          });
        }
        if (status === "paused_error") {
          return ok({
            outcome: "blocked_error",
            reason: state.data.stopReason ?? "paused_error",
          });
        }
        if (
          status === "completed" ||
          status === "failed" ||
          status === "stopped" ||
          status === "cancelled"
        ) {
          return ok({ outcome: "blocked_error", reason: status });
        }
        // status is `paused_user` or `paused_wake` — claim lease + atomic flip.
        const { enqueueRequest, markObserved, markCleared, markFailed } =
          await import("@vex-agent/db/repos/runtime-control-requests.js");
        const auditRequest = await enqueueRequest({
          sessionId: input.sessionId,
          missionRunId: runId,
          kind: "resume",
          requestedBy: "user",
          correlationId: ctx.requestId,
        });
        const { claimRunLeaseAndFlipToRunning } = await import(
          "@vex-agent/engine/runtime/lease-and-status.js"
        );
        const claim = await claimRunLeaseAndFlipToRunning({
          sessionId: input.sessionId,
          missionRunId: runId,
          fromStatuses: [status],
          ownerId: `${RESUME_OWNER_PREFIX}${randomUUID()}`,
          processKind: "electron_main",
          ttlMs: LEASE_TTL_MS,
        });
        if (claim.outcome === "lease_busy") {
          await markFailed(auditRequest.id, "lease_busy");
          const retryAfterMs = Math.max(
            0,
            claim.currentLease.expiresAt.getTime() - Date.now(),
          );
          await emitControlStateAfterChange(input.sessionId, ctx.requestId);
          return ok({ outcome: "lease_busy", retryAfterMs });
        }
        if (claim.outcome === "status_mismatch") {
          await markFailed(auditRequest.id, "status_changed");
          return ok({
            outcome: "blocked_error",
            reason: "status_changed",
          });
        }

        // Lease claimed + status flipped to running. Mark request
        // observed + dispatch continuation fire-and-forget. The
        // explicit completion wrapper (.then/.catch/.finally) ensures
        // the audit row + lease both reach a terminal state even on
        // continuation throw or process crash within main.
        await markObserved(auditRequest.id);
        const ownerId = claim.lease.ownerId;
        const { createLeaseHandle } = await import(
          "@vex-agent/engine/runtime/lease-handle.js"
        );
        const handle = createLeaseHandle({
          lease: claim.lease,
          ownerId,
          ttlMs: LEASE_TTL_MS,
        });
        // Fire-and-forget — IPC returns immediately with `resumed`.
        void (async () => {
          try {
            const { resumeMissionRun } = await import(
              "@vex-agent/engine/index.js"
            );
            await resumeMissionRun(runId);
            await markCleared(auditRequest.id, "resumed");
          } catch (err) {
            log.warn(
              `[runtime:requestResume] continuation failed runId=${runId}`,
              err,
            );
            try {
              await markFailed(auditRequest.id, "continuation_failed");
            } catch {
              // intentionally swallowed — audit row best-effort
            }
            try {
              const { getBugReportSink } = await import(
                "@vex-agent/engine/support/bug-report-registry.js"
              );
              const { emitBugReportSafe } = await import(
                "@vex-lib/diagnostics/bug-report-sink.js"
              );
              await emitBugReportSafe(
                getBugReportSink(),
                {
                  source: "agent",
                  category: "mission_system_error",
                  severity: "error",
                  title: "runtime.requestResume.continuation_failed",
                  description:
                    err instanceof Error ? err.message : String(err),
                  refs: {
                    sessionId: input.sessionId,
                    missionRunId: runId,
                    correlationId: ctx.requestId,
                  },
                  agentContext: {
                    runtimeStatus: "running",
                  },
                },
                log,
              );
            } catch {
              // bug sink itself unreachable — log already covered above
            }
          } finally {
            try {
              const { releaseLeaseAndEmitControlState } = await import(
                "@vex-agent/engine/runtime/release-and-emit.js"
              );
              await releaseLeaseAndEmitControlState(handle, input.sessionId, {
                missionRunId: runId,
                correlationId: ctx.requestId,
              });
            } catch {
              // intentionally swallowed
            }
          }
        })();

        await emitControlStateAfterChange(input.sessionId, ctx.requestId);
        return ok({ outcome: "resumed", runId });
      } catch (cause) {
        log.warn(
          `[ipc:vex:runtime:requestResume] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
