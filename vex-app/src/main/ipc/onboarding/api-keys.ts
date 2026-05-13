/**
 * vex.onboarding.apiKeysSet — Wizard Step 3 IPC handler (M9).
 *
 * Validates input via Zod, then runs the writer inside `withEnvWriteLock`
 * so it cannot interleave with
 * keystoreSet / embeddingConfigure / agentCoreConfigure on the same
 * `${CONFIG_DIR}/.env` file.
 *
 * Logging contract (codex turn 1 RED #6):
 *   - log only the canonical key NAMES being written + correlationId
 *   - NEVER values, lengths, or prefix/suffix previews
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  apiKeysSetInputSchema,
  apiKeysSetResultSchema,
  type ApiKeysSetResult,
} from "@shared/schemas/api-keys.js";
import { writeApiKeys } from "../../onboarding/api-keys-writer.js";
import { withEnvWriteLock } from "../../onboarding/env-write-mutex.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerApiKeysHandler(): () => void {
  return registerHandler({
    channel: CH.onboarding.apiKeysSet,
    domain: "onboarding",
    inputSchema: apiKeysSetInputSchema,
    outputSchema: apiKeysSetResultSchema,
    handle: async (input, ctx): Promise<Result<ApiKeysSetResult>> => {
      const outcome = await withEnvWriteLock(() => writeApiKeys(input));
      if (outcome.ok) {
        log.info(
          `[ipc:vex:onboarding:apiKeysSet] ` +
            `keys=${outcome.data.fieldsWritten.join(",") || "<none>"} ` +
            `correlationId=${ctx.requestId}`,
        );
      }
      return outcome;
    },
  });
}
