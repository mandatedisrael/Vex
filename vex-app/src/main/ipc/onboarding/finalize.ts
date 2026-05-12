/**
 * vex.onboarding.completeSetup — Wizard Step 9 IPC handler (M11).
 *
 * Single combined IPC: telemetryConsent rides alongside the finalize
 * trigger so consent application happens AFTER setup succeeds (codex
 * v2 WRONG-DIRECTION on D11). The actual sequencing lives in
 * `main/onboarding/finalize.ts::completeSetup` — this handler is a
 * thin Result-envelope adapter.
 *
 * Logging: outcome only (success/failure code) + has-backup boolean +
 * telemetryWarning boolean + correlationId. NEVER logs envState
 * details, paths, or the consent value beyond a boolean.
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  completeSetupInputSchema,
  completeSetupResultSchema,
  type CompleteSetupResult,
} from "@shared/schemas/finalize.js";
import { completeSetup } from "../../onboarding/finalize.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerFinalizeHandler(): () => void {
  return registerHandler({
    channel: CH.onboarding.completeSetup,
    domain: "onboarding",
    inputSchema: completeSetupInputSchema,
    outputSchema: completeSetupResultSchema,
    handle: async (input, ctx): Promise<Result<CompleteSetupResult>> => {
      const result = await completeSetup(input);
      if (!result.ok) {
        log.info(
          `[ipc:vex:onboarding:completeSetup] ` +
            `errCode=${result.error.code} correlationId=${ctx.requestId}`,
        );
        return result;
      }
      log.info(
        `[ipc:vex:onboarding:completeSetup] ok ` +
          `hasBackup=${result.data.backupPath !== null} ` +
          `telemetryWarning=${result.data.telemetryWarning !== null} ` +
          `correlationId=${ctx.requestId}`,
      );
      return result;
    },
  });
}
