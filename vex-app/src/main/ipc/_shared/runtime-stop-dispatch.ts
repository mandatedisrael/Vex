/**
 * Shared stop-dispatch primitive used by both
 * `runtime.requestStop` and `mission.stop` IPC handlers.
 *
 * Returns the discriminated union compatible with both
 * `runtimeRequestStopResultSchema` and `missionStopResultSchema`.
 *
 * A `running` run is stopped GRACEFULLY: the handler enqueues a
 * `stop_terminal` audit row that the live runner observes at its next
 * iteration boundary (codex puzzle-03: IPC must not apply to a live loop
 * directly). A PAUSED run (approval/wake/error/user) has NO runner to observe
 * that request, so it is aborted directly via `abortActiveMissionForSession`
 * (the engine finalizes it to `cancelled` and rejects pending approvals +
 * cancels wakes).
 */

import { ok, err, type Result } from "@shared/ipc/result.js";
import type { MissionRunStatus } from "@shared/schemas/sessions.js";
import { getActiveRunForSession } from "../../database/mission-runs-db.js";
import { log } from "../../logger/index.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { emitControlStateAfterChange } from "../runtime/_emit-control-state.js";

export interface StopFlowInput {
  readonly sessionId: string;
}

export interface StopFlowContext {
  readonly requestId: string;
  readonly channelLabel: string;
}

export type StopFlowResult =
  | { readonly outcome: "queued"; readonly requestId: string }
  /** A paused run was aborted directly (engine finalized it to `cancelled`). */
  | { readonly outcome: "stopped" }
  | {
    readonly outcome: "already_terminal";
    readonly status: MissionRunStatus;
  }
  | { readonly outcome: "no_active_run" };

export async function runStopDispatch(
  input: StopFlowInput,
  ctx: StopFlowContext,
): Promise<Result<StopFlowResult>> {
  const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
  if (!dbUrlOutcome.ok) return dbUrlOutcome;
  try {
    const state = await getActiveRunForSession(input.sessionId);
    if (!state.ok) return state;
    if (!state.data.hasActiveRun) {
      return ok({ outcome: "no_active_run" });
    }
    const status = state.data.status;
    if (
      status === "completed"
      || status === "failed"
      || status === "stopped"
      || status === "cancelled"
    ) {
      return ok({ outcome: "already_terminal", status });
    }
    if (status === "running") {
      // Graceful path: the live runner observes this queued stop_terminal
      // request at its next iteration boundary and finalizes the run.
      const { enqueueRequest } = await import(
        "@vex-agent/db/repos/runtime-control-requests.js"
      );
      const request = await enqueueRequest({
        sessionId: input.sessionId,
        missionRunId: state.data.missionRunId,
        kind: "stop_terminal",
        requestedBy: "user",
        correlationId: ctx.requestId,
      });
      await emitControlStateAfterChange(input.sessionId, ctx.requestId);
      return ok({ outcome: "queued", requestId: request.id });
    }
    // Paused (approval/wake/error/user): no runner is observing, so a queued
    // stop would never be applied. Abort directly — the engine finalizes the
    // run to `cancelled` and rejects pending approvals + cancels wakes.
    const { abortActiveMissionForSession } = await import(
      "@vex-agent/engine/index.js"
    );
    const aborted = await abortActiveMissionForSession(input.sessionId);
    await emitControlStateAfterChange(input.sessionId, ctx.requestId);
    // null = the run vanished mid-flight; `aborted:false` = it was already
    // terminal by the time we aborted (race). Neither stopped a live paused
    // run, so report nothing-to-stop rather than a misleading `stopped`.
    if (aborted === null || !aborted.aborted) {
      return ok({ outcome: "no_active_run" });
    }
    return ok({ outcome: "stopped" });
  } catch (cause) {
    log.warn(
      `[ipc:${ctx.channelLabel}] failed correlationId=${ctx.requestId}`,
      cause,
    );
    return err(controlFailedError(ctx.requestId));
  }
}
