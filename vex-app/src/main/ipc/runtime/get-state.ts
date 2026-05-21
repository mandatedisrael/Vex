/**
 * `vex.runtime.getState` — read-only. Pulls the active mission run row
 * + lease summary + top pending control kind in one round-trip (see
 * `mission-runs-db.ts getActiveRunForSession`). Renderer uses this to
 * gate the pause/stop/resume buttons.
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  runtimeRequestInputSchema,
  runtimeStateDtoSchema,
  type RuntimeStateDto,
} from "@shared/schemas/runtime.js";
import { getActiveRunForSession } from "../../database/mission-runs-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerRuntimeGetStateHandler(): () => void {
  return registerHandler({
    channel: CH.runtime.getState,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeStateDtoSchema,
    handle: async (input, ctx): Promise<Result<RuntimeStateDto>> => {
      const outcome = await getActiveRunForSession(input.sessionId);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:runtime:getState] ok sessionId=${input.sessionId} ` +
            `hasActiveRun=${outcome.data.hasActiveRun} ` +
            `status=${outcome.data.status ?? "none"} ` +
            `leaseActive=${outcome.data.leaseActive} ` +
            `pendingControl=${outcome.data.pendingControlKind ?? "none"} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:runtime:getState] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}
