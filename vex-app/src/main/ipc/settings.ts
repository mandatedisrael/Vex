/**
 * vex.settings.* — Phase 1 read-only preferences + telemetry consent toggle.
 */

import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import {
  preferencesSchema,
  type Preferences,
} from "@shared/schemas/preferences.js";
import { preferencesStore } from "../preferences/store.js";
import { registerHandler } from "./register-handler.js";

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
        return ok(next);
      },
    })
  );

  return handlers;
}
