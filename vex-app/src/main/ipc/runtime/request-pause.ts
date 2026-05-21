/**
 * `vex.runtime.requestPause` — enqueue-only audit + `pause_after_step`
 * row.
 *
 * **IPC MUST NOT apply the transition directly.** Clearing the
 * request before the runner sees it would let the active turn-loop
 * continue and overwrite the status (codex puzzle-03 review blocker
 * #1). The runner observes pending pause requests at its
 * iteration-boundary checkpoint in `turn-loop.ts` and applies the
 * transition there.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  runtimeRequestInputSchema,
  runtimeRequestPauseResultSchema,
  type RuntimeRequestPauseResult,
} from "@shared/schemas/runtime.js";
import { getActiveRunForSession } from "../../database/mission-runs-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "./_errors.js";
import { ensureEngineDbUrl } from "./_ensure-engine-db-url.js";
import { emitControlStateAfterChange } from "./_emit-control-state.js";

export function registerRuntimeRequestPauseHandler(): () => void {
  return registerHandler({
    channel: CH.runtime.requestPause,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeRequestPauseResultSchema,
    handle: async (input, ctx): Promise<Result<RuntimeRequestPauseResult>> => {
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
          status === "completed" ||
          status === "failed" ||
          status === "stopped" ||
          status === "cancelled"
        ) {
          return ok({ outcome: "terminal", status });
        }
        if (
          status === "paused_user" ||
          status === "paused_approval" ||
          status === "paused_wake" ||
          status === "paused_error"
        ) {
          // Already paused — return state without enqueueing a new
          // duplicate audit row. The active control plane (whoever
          // resumes next) will be the one to honor a fresh request.
          return ok({ outcome: "already_paused", status });
        }
        // Running — enqueue the request and return.
        const { enqueueRequest, getPendingForSession } = await import(
          "@vex-agent/db/repos/runtime-control-requests.js"
        );
        const pending = await getPendingForSession(input.sessionId);
        const existingPause = pending.find(
          (p) => p.kind === "pause_after_step",
        );
        if (existingPause) {
          return ok({ outcome: "already_pending", requestId: existingPause.id });
        }
        const request = await enqueueRequest({
          sessionId: input.sessionId,
          missionRunId: state.data.missionRunId,
          kind: "pause_after_step",
          requestedBy: "user",
          correlationId: ctx.requestId,
        });
        await emitControlStateAfterChange(input.sessionId, ctx.requestId);
        return ok({ outcome: "queued", requestId: request.id });
      } catch (cause) {
        log.warn(
          `[ipc:vex:runtime:requestPause] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
