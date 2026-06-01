/**
 * `mission.getRenewableSource` — read-only resolver of the latest
 * terminal accepted mission for the Renew control.
 *
 * Renderer flow (MissionControls):
 *   no active run + a renewable source exists
 *     → renderer reads `mission.getRenewableSource(sessionId)`
 *     → if `missionId` → renders Renew → `mission.renew({ sessionId, previousMissionId })`
 *     → if `null`     → no Renew button
 *
 * Latest-run semantics + 4-of-4 acceptance gate live in
 * `getRenewableSourceForSession` (vex-app/src/main/database/missions-db.ts).
 */

import { CH } from "@shared/ipc/channels.js";
import { type Result } from "@shared/ipc/result.js";
import {
  missionGetRenewableSourceInputSchema,
  missionGetRenewableSourceResultSchema,
  type MissionGetRenewableSourceResult,
} from "@shared/schemas/mission.js";
import { getRenewableSourceForSession } from "../../database/missions-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerMissionGetRenewableSourceHandler(): () => void {
  return registerHandler({
    channel: CH.mission.getRenewableSource,
    domain: "mission",
    inputSchema: missionGetRenewableSourceInputSchema,
    outputSchema: missionGetRenewableSourceResultSchema,
    handle: async (
      input,
      ctx,
    ): Promise<Result<MissionGetRenewableSourceResult>> => {
      const outcome = await getRenewableSourceForSession(input.sessionId);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:mission:getRenewableSource] ok ` +
            `sessionId=${input.sessionId} ` +
            `present=${outcome.data !== null} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:mission:getRenewableSource] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}
