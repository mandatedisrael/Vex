/**
 * `vex.runtime.requestStop` — enqueue-only audit + `stop_terminal`
 * row. Runner observes the request at the iteration-boundary
 * checkpoint and applies the terminal transition (codex review
 * blocker #1 — IPC must not apply directly).
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  runtimeRequestInputSchema,
  runtimeRequestStopResultSchema,
  type RuntimeRequestStopResult,
} from "@shared/schemas/runtime.js";
import { getActiveRunForSession } from "../../database/mission-runs-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "./_errors.js";
import { ensureEngineDbUrl } from "./_ensure-engine-db-url.js";
import { emitControlStateAfterChange } from "./_emit-control-state.js";

export function registerRuntimeRequestStopHandler(): () => void {
  return registerHandler({
    channel: CH.runtime.requestStop,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeRequestStopResultSchema,
    handle: async (input, ctx): Promise<Result<RuntimeRequestStopResult>> => {
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
          return ok({ outcome: "already_terminal", status });
        }
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
      } catch (cause) {
        log.warn(
          `[ipc:vex:runtime:requestStop] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
