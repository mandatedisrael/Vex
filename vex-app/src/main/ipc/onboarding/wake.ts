/**
 * vex.onboarding.wakeSet — Wizard Step 8 IPC handler (M11).
 *
 * Validates the discriminated input via Zod (enabled=true requires
 * interval + batch in canonical ranges; enabled=false has no extras)
 * and writes via `withEnvWriteLock`.
 *
 * Logging: enabled + counts. The values are non-secret so we surface
 * the schedule numbers in success logs to help operators diagnose
 * "wake settings not picked up" support tickets.
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  wakeSetInputSchema,
  wakeSetResultSchema,
  type WakeSetResult,
} from "@shared/schemas/wake.js";
import { writeWake } from "../../onboarding/wake-writer.js";
import { withEnvWriteLock } from "../../onboarding/env-write-mutex.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerWakeHandler(): () => void {
  return registerHandler({
    channel: CH.onboarding.wakeSet,
    domain: "onboarding",
    inputSchema: wakeSetInputSchema,
    outputSchema: wakeSetResultSchema,
    handle: async (input, ctx): Promise<Result<WakeSetResult>> => {
      const result = await withEnvWriteLock(() => writeWake(input));
      if (!result.ok) {
        log.info(
          `[ipc:vex:onboarding:wakeSet] ` +
            `errCode=${result.error.code} correlationId=${ctx.requestId}`,
        );
        return result;
      }
      const detail = input.enabled
        ? `interval=${input.intervalMs} batch=${input.batchSize}`
        : "interval=- batch=-";
      log.info(
        `[ipc:vex:onboarding:wakeSet] enabled=${input.enabled} ${detail} ` +
          `wrote=${result.data.fieldsWritten.length} ` +
          `deleted=${result.data.fieldsDeleted.length} ` +
          `correlationId=${ctx.requestId}`,
      );
      return result;
    },
  });
}
