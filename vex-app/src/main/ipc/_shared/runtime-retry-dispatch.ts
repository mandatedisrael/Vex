/**
 * Retry dispatcher for `mission.retry` — the "Recover after error" control.
 *
 * Deliberately distinct from `runResumeDispatch`: that dispatcher owns
 * paused_user / paused_wake and refuses paused_error. This one claims +
 * resumes ONLY a `paused_error` run, and classifies every other state
 * explicitly so the dispatcher is total. Fire-and-forget like the resume
 * path: it claims the lease + flips status, kicks off `resumeMissionRun`
 * asynchronously, and returns a Result immediately.
 *
 * Duplicates ~60% of `runResumeDispatch` by intent (codex review): a shared
 * claim + fire-and-forget helper is only worth extracting once the stop-fix
 * slice proves the shape is stable.
 */

import { randomUUID } from "node:crypto";
import { ok, err, type Result } from "@shared/ipc/result.js";
import type { MissionRunStatus } from "@shared/schemas/sessions.js";
import { getLatestRunForSession } from "../../database/mission-runs-db.js";
import { log } from "../../logger/index.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { emitControlStateAfterChange } from "../runtime/_emit-control-state.js";

export interface RetryFlowInput {
  readonly sessionId: string;
}

export interface RetryFlowContext {
  readonly requestId: string;
  /** Label used for structured logs (channel name without colon prefix). */
  readonly channelLabel: string;
}

export type RetryFlowResult =
  | { readonly outcome: "resumed"; readonly runId: string }
  | { readonly outcome: "already_running"; readonly runId: string }
  | { readonly outcome: "no_active_run" }
  | { readonly outcome: "blocked_approval"; readonly pendingApprovalId: string }
  | { readonly outcome: "blocked_terminal"; readonly status: MissionRunStatus }
  | { readonly outcome: "not_recoverable"; readonly status: MissionRunStatus }
  | { readonly outcome: "status_changed" }
  | { readonly outcome: "lease_busy"; readonly retryAfterMs?: number };

const LEASE_TTL_MS = 5 * 60_000;
const RETRY_OWNER_PREFIX = "ipc-retry-";

export async function runRetryDispatch(
  input: RetryFlowInput,
  ctx: RetryFlowContext,
): Promise<Result<RetryFlowResult>> {
  const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
  if (!dbUrlOutcome.ok) return dbUrlOutcome;
  try {
    const latest = await getLatestRunForSession(input.sessionId);
    if (!latest.ok) return latest;
    if (latest.data === null) return ok({ outcome: "no_active_run" });

    const runId = latest.data.missionRunId;
    const status = latest.data.status;
    if (status === "running") {
      return ok({ outcome: "already_running", runId });
    }
    if (status === "paused_approval") {
      return ok({ outcome: "blocked_approval", pendingApprovalId: runId });
    }
    if (
      status === "completed" ||
      status === "failed" ||
      status === "stopped" ||
      status === "cancelled"
    ) {
      return ok({ outcome: "blocked_terminal", status });
    }
    if (status === "paused_wake" || status === "paused_user") {
      // Not an error pause → Continue (runResumeDispatch) owns these.
      return ok({ outcome: "not_recoverable", status });
    }

    // status === "paused_error" — claim + flip + fire-and-forget resume.
    // Phase 4d: a human Recover supersedes any scheduled auto-retry — cancel
    // the pending error_retry wake so it can't fire later. A wake already
    // CONSUMED by the executor can't be cancelled; there, claimRunForAutoRetry's
    // atomic re-check (status/unsafe/attempt) is the authority and will skip.
    const { cancelForSession } = await import(
      "@vex-agent/db/repos/loop-wake.js"
    );
    await cancelForSession(input.sessionId, "superseded_by_manual_recover");

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
      fromStatuses: ["paused_error"],
      ownerId: `${RETRY_OWNER_PREFIX}${randomUUID()}`,
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
      // Deliberate re-read: if a race winner already resumed the run, report
      // it as already_running rather than a generic error.
      const after = await getLatestRunForSession(input.sessionId);
      if (after.ok && after.data?.status === "running") {
        return ok({ outcome: "already_running", runId: after.data.missionRunId });
      }
      return ok({ outcome: "status_changed" });
    }
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
    // Fire-and-forget. Bug-report sink + audit lifecycle on continuation.
    void (async () => {
      try {
        const { resumeMissionRun } = await import("@vex-agent/engine/index.js");
        await resumeMissionRun(runId);
        await markCleared(auditRequest.id, "resumed");
      } catch (cause) {
        log.warn(
          `[ipc:${ctx.channelLabel}] retry continuation failed runId=${runId}`,
          cause,
        );
        try {
          await markFailed(auditRequest.id, "continuation_failed");
        } catch {
          // best-effort audit
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
              title: `${ctx.channelLabel}.continuation_failed`,
              description: cause instanceof Error ? cause.message : String(cause),
              refs: {
                sessionId: input.sessionId,
                missionRunId: runId,
                correlationId: ctx.requestId,
              },
              agentContext: { runtimeStatus: "running" },
            },
            log,
          );
        } catch {
          // sink unreachable
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
          // best-effort
        }
      }
    })();
    await emitControlStateAfterChange(input.sessionId, ctx.requestId);
    return ok({ outcome: "resumed", runId });
  } catch (cause) {
    log.warn(
      `[ipc:${ctx.channelLabel}] failed correlationId=${ctx.requestId}`,
      cause,
    );
    return err(controlFailedError(ctx.requestId));
  }
}
