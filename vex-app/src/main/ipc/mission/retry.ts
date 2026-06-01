/**
 * `mission.retry` — the "Recover after error" control.
 *
 * Delegates to the dedicated retry dispatcher, which claims + resumes ONLY a
 * `paused_error` run (Continue/requestResume keep owning paused_user/wake and
 * refusing paused_error). Fire-and-forget; returns a discriminated Result.
 */

import { CH } from "@shared/ipc/channels.js";
import {
  missionRetryInputSchema,
  missionRetryResultSchema,
} from "@shared/schemas/mission.js";
import { registerHandler } from "../register-handler.js";
import { runRetryDispatch } from "../_shared/runtime-retry-dispatch.js";

export function registerMissionRetryHandler(): () => void {
  return registerHandler({
    channel: CH.mission.retry,
    domain: "mission",
    inputSchema: missionRetryInputSchema,
    outputSchema: missionRetryResultSchema,
    handle: async (input, ctx) =>
      runRetryDispatch(input, {
        requestId: ctx.requestId,
        channelLabel: "vex:mission:retry",
      }),
  });
}
