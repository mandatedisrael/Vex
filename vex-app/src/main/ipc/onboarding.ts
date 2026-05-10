/**
 * vex.onboarding.* — wizard surface.
 *
 * M2 shipped `getEnvState()` for System Check.
 * M7 adds:
 *   - `getWizardState()` / `setWizardState()` — partial-state-recovery
 *     persistence for the multi-step wizard
 *   - `keystoreSet({ password })` — Step 1 (master password) writer
 *
 * M8–M11 land the remaining wizard step handlers (wallets*, apiKeysSet,
 * embeddingConfigure, agentCoreConfigure, provider*, modeSet, wakeSet,
 * completeSetup).
 */

import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  envStateSchema,
  type EnvState,
} from "@shared/schemas/onboarding.js";
import {
  keystoreSetInputSchema,
  keystoreSetResultSchema,
  setWizardStateInputSchema,
  wizardStateResultSchema,
  type KeystoreSetResult,
  type WizardState,
} from "@shared/schemas/wizard.js";
import { gatherEnvState } from "../onboarding/env-state.js";
import { setKeystorePassword } from "../onboarding/keystore-writer.js";
import { wizardStateStore } from "../onboarding/wizard-state-store.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

const empty = z.object({}).strict();

export function registerOnboardingHandlers(): Array<() => void> {
  const handlers: Array<() => void> = [];

  handlers.push(
    registerHandler({
      channel: CH.onboarding.getEnvState,
      domain: "onboarding",
      inputSchema: empty,
      outputSchema: envStateSchema,
      handle: async (): Promise<Result<EnvState>> => ok(await gatherEnvState()),
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.getWizardState,
      domain: "onboarding",
      inputSchema: empty,
      outputSchema: wizardStateResultSchema,
      handle: async (): Promise<Result<WizardState>> =>
        ok(await wizardStateStore.load()),
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.setWizardState,
      domain: "onboarding",
      inputSchema: setWizardStateInputSchema,
      outputSchema: wizardStateResultSchema,
      handle: async (input, ctx): Promise<Result<WizardState>> => {
        log.info(
          `[ipc:vex:onboarding:setWizardState] ` +
            `step=${input.currentStepId} completed=${input.completedSteps.length} ` +
            `correlationId=${ctx.requestId}`
        );
        try {
          return ok(await wizardStateStore.update(input));
        } catch (cause) {
          // Map fs failures + post-merge schema rejections to a domain
          // error the wizard UI can show as "Could not save progress —
          // retry" instead of bubbling out as internal.contract_violation
          // through registerHandler (codex turn 6 YELLOW #1).
          log.error(
            `[ipc:vex:onboarding:setWizardState] update failed correlationId=${ctx.requestId}`,
            cause
          );
          return err({
            code: "onboarding.step_failed",
            domain: "onboarding",
            message: "Could not save wizard progress. Please retry.",
            retryable: true,
            userActionable: true,
            redacted: true,
            correlationId: ctx.requestId,
          });
        }
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.keystoreSet,
      domain: "onboarding",
      inputSchema: keystoreSetInputSchema,
      outputSchema: keystoreSetResultSchema,
      handle: async (input, ctx): Promise<Result<KeystoreSetResult>> => {
        const result = await setKeystorePassword(input.password);
        if (result.ok) {
          log.info(
            `[ipc:vex:onboarding:keystoreSet] kind=${result.data.kind} ` +
              `correlationId=${ctx.requestId}`
          );
        }
        return result;
      },
    })
  );

  return handlers;
}
