/**
 * `mission.listResults` — read-only, PER-WALLET mission history for the
 * Mission History view. Reads the `mission_results` ledger (written by the
 * engine's capture hooks — see `engine/mission/mission-results-capture.ts`),
 * newest first.
 *
 * There is intentionally no "list every wallet" read — the caller always
 * supplies the wallet address it wants history for.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  missionListResultsInputSchema,
  missionListResultsResultSchema,
  DEFAULT_MISSION_RESULTS_LIMIT,
  type MissionListResultsResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { toMissionResultDto } from "./_result-dto.js";

export function registerMissionListResultsHandler(): () => void {
  return registerHandler({
    channel: CH.mission.listResults,
    domain: "mission",
    inputSchema: missionListResultsInputSchema,
    outputSchema: missionListResultsResultSchema,
    handle: async (input, ctx): Promise<Result<MissionListResultsResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { listResultsForWallet } = await import(
          "@vex-agent/db/repos/mission-results.js"
        );
        const rows = await listResultsForWallet(
          input.walletAddress,
          input.limit ?? DEFAULT_MISSION_RESULTS_LIMIT,
        );
        const dtos = rows.map(toMissionResultDto);
        log.info(
          `[ipc:vex:mission:listResults] ok count=${dtos.length} correlationId=${ctx.requestId}`,
        );
        return ok(dtos);
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:listResults] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
