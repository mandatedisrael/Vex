/**
 * vex.onboarding.modeSet — Wizard Step 7 IPC handler (M11).
 *
 * Validates the discriminated input via Zod (mission requires loopMode
 * + initialPrompt; chat is bare; full_autonomous accepts optional
 * prompt) and wraps `writeMode` in `withEnvWriteLock` so a single
 * .env mutation lands per call.
 *
 * Logging contract: mode value + counts only. NEVER logs the user's
 * mission goal or autonomous seed prompt — those carry intent the
 * operator did not consent to expose.
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  modeSetInputSchema,
  modeSetResultSchema,
  type ModeSetResult,
} from "@shared/schemas/mode.js";
import { writeMode } from "../../onboarding/mode-writer.js";
import { withEnvWriteLock } from "../../onboarding/env-write-mutex.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerModeHandler(): () => void {
  return registerHandler({
    channel: CH.onboarding.modeSet,
    domain: "onboarding",
    inputSchema: modeSetInputSchema,
    outputSchema: modeSetResultSchema,
    handle: async (input, ctx): Promise<Result<ModeSetResult>> => {
      const result = await withEnvWriteLock(() => writeMode(input));
      if (!result.ok) {
        log.info(
          `[ipc:vex:onboarding:modeSet] ` +
            `errCode=${result.error.code} correlationId=${ctx.requestId}`,
        );
        return result;
      }
      log.info(
        `[ipc:vex:onboarding:modeSet] mode=${input.mode} ` +
          `wrote=${result.data.fieldsWritten.length} ` +
          `deleted=${result.data.fieldsDeleted.length} ` +
          `correlationId=${ctx.requestId}`,
      );
      return result;
    },
  });
}
