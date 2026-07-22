/**
 * vex.settings.* — Phase 1 read-only preferences + telemetry consent toggle.
 */

import { dialog } from "electron";
import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  preferencesSchema,
  type Preferences,
} from "@shared/schemas/preferences.js";
import { hyperliquidSettingsUpdateInputSchema } from "@shared/schemas/hyperliquid.js";
import {
  userProfileSchema,
  type UserProfile,
} from "@shared/schemas/user-profile.js";
import { hyperliquidPolicySchema } from "@vex-lib/hyperliquid-policy.js";
import { preferencesStore } from "../preferences/store.js";
import {
  disableSentry,
  initSentryIfConsented,
} from "../telemetry/sentry-lifecycle.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";
import { controlFailedError } from "./runtime/_errors.js";
import { ensureEngineDbUrl } from "./runtime/_ensure-engine-db-url.js";

const empty = z.object({}).strict();

const setTelemetryConsentInput = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export function registerSettingsHandlers(): Array<() => void> {
  const handlers: Array<() => void> = [];

  handlers.push(
    registerHandler({
      channel: CH.settings.getPreferences,
      domain: "settings",
      inputSchema: empty,
      outputSchema: preferencesSchema,
      handle: async (): Promise<Result<Preferences>> => {
        const prefs = await preferencesStore.load();
        return ok(preferencesSchema.parse(prefs));
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.settings.setHyperliquidPolicy,
      domain: "settings",
      inputSchema: hyperliquidSettingsUpdateInputSchema,
      outputSchema: preferencesSchema,
      handle: async (input, ctx): Promise<Result<Preferences>> => {
        const current = await preferencesStore.load();
        const nextPolicy = hyperliquidPolicySchema.parse({
          ...current.hyperliquid.policy,
          ...input.policy,
        });
        if (policyLooseningRequiresConfirmation(current.hyperliquid.policy, nextPolicy)) {
          const confirmation = await dialog.showMessageBox({
            type: "warning",
            buttons: ["Cancel", "Allow policy loosening"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
            title: "Allow riskier Hyperliquid policy?",
            message: "This change weakens a Hyperliquid safety control.",
            detail: "Disabling mandatory stop-losses or egress approval, or increasing the leverage cap, can increase the risk of loss.",
          });
          if (confirmation.response !== 1) {
            return err({
              code: "wallet.risk_confirmation_required",
              domain: "settings",
              message: "Hyperliquid policy loosening was not confirmed.",
              retryable: false,
              userActionable: true,
              redacted: true,
              correlationId: ctx.requestId,
            });
          }
        }
        const next = await preferencesStore.update({
          hyperliquid: {
            ...current.hyperliquid,
            policy: nextPolicy,
          },
        });
        return ok(preferencesSchema.parse(next));
      },
    }),
  );

  handlers.push(
    registerHandler({
      channel: CH.settings.setTelemetryConsent,
      domain: "settings",
      inputSchema: setTelemetryConsentInput,
      outputSchema: preferencesSchema,
      handle: async ({ enabled }): Promise<Result<Preferences>> => {
        const next = await preferencesStore.update({
          telemetry: {
            enabled,
            consentedAt: enabled ? new Date().toISOString() : null,
          },
        });
        // M11: keep Sentry SDK lifecycle in sync with consent state.
        // initSentryIfConsented + disableSentry are both idempotent so a
        // double-flip (e.g. "off" → "off") is harmless.
        if (enabled) {
          await initSentryIfConsented();
        } else {
          await disableSentry();
        }
        return ok(next);
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.settings.getUserProfile,
      domain: "settings",
      inputSchema: empty,
      outputSchema: userProfileSchema,
      handle: async (_input, ctx): Promise<Result<UserProfile>> => {
        const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
        if (!dbUrlOutcome.ok) return dbUrlOutcome;
        try {
          const { getUserProfile } = await import("@vex-agent/db/repos/soul.js");
          // The repo layer stays string-loose (soul.ts doc comment); re-parse
          // through the enum-constrained schema both to narrow the type and
          // to defend against a stale/malformed stored value.
          return ok(userProfileSchema.parse(await getUserProfile()));
        } catch (cause) {
          log.warn(`[ipc:vex:settings:getUserProfile] failed correlationId=${ctx.requestId}`, cause);
          return err(controlFailedError(ctx.requestId));
        }
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.settings.setUserProfile,
      domain: "settings",
      inputSchema: userProfileSchema,
      outputSchema: userProfileSchema,
      handle: async (input, ctx): Promise<Result<UserProfile>> => {
        const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
        if (!dbUrlOutcome.ok) return dbUrlOutcome;
        try {
          const { setUserProfile, getUserProfile } = await import(
            "@vex-agent/db/repos/soul.js"
          );
          // `stylePreset`/`characteristics`/`riskAppetite` are optional at
          // this boundary (043) so the pre-043 VexSetupDialog UI keeps
          // validating without sending them. The repo's full-set write always
          // wants concrete values, so an omitted field coalesces to the same
          // "unset" value an explicit null/[] would produce.
          await setUserProfile({
            displayName: input.displayName,
            instructionsMd: input.instructionsMd,
            workDescription: input.workDescription,
            stylePreset: input.stylePreset ?? null,
            characteristics: input.characteristics ?? [],
            riskAppetite: input.riskAppetite ?? null,
          });
          return ok(userProfileSchema.parse(await getUserProfile()));
        } catch (cause) {
          log.warn(`[ipc:vex:settings:setUserProfile] failed correlationId=${ctx.requestId}`, cause);
          return err(controlFailedError(ctx.requestId));
        }
      },
    })
  );

  return handlers;
}

function policyLooseningRequiresConfirmation(
  current: { readonly requireStopLoss: boolean; readonly egressAlwaysApprove: boolean; readonly leverageCapDefault: number },
  next: { readonly requireStopLoss: boolean; readonly egressAlwaysApprove: boolean; readonly leverageCapDefault: number },
): boolean {
  return (current.requireStopLoss && !next.requireStopLoss)
    || (current.egressAlwaysApprove && !next.egressAlwaysApprove)
    || next.leverageCapDefault > current.leverageCapDefault;
}
