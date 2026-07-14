/**
 * `mission.getResultForRun` — read-only ledger row for a single mission run
 * (e.g. the post-mission summary card shown right after a run finalizes).
 * It is scoped to the requested wallet, just like mission history.
 * Reads the `mission_results` ledger (written by the engine's capture
 * hooks); returns null if the run was never opened (never started, or
 * accounting failed-soft before an open committed).
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  missionGetResultForRunInputSchema,
  missionGetResultForRunResultSchema,
  type MissionGetResultForRunResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { toMissionResultDto } from "./_result-dto.js";

export function registerMissionGetResultForRunHandler(): () => void {
  return registerHandler({
    channel: CH.mission.getResultForRun,
    domain: "mission",
    inputSchema: missionGetResultForRunInputSchema,
    outputSchema: missionGetResultForRunResultSchema,
    handle: async (input, ctx): Promise<Result<MissionGetResultForRunResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { getResultForRun } = await import(
          "@vex-agent/db/repos/mission-results.js"
        );
        const row = await getResultForRun(input.missionRunId, input.walletAddress);
        log.info(
          `[ipc:vex:mission:getResultForRun] ok found=${row !== null} correlationId=${ctx.requestId}`,
        );
        return ok(row === null ? null : toMissionResultDto(row));
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:getResultForRun] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
