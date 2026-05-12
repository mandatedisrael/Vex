/**
 * vex.telemetry.reportRendererError — Sentry-backed renderer error
 * forwarder (M11 upgrade).
 *
 * Behaviour:
 *   - No consent → ok({recorded:false}) silently. Renderer uses the
 *     same `window.vex.telemetry.reportRendererError` call path
 *     regardless of consent state — no branching in renderer code.
 *   - Consent granted but Sentry SDK not initialized (DSN missing /
 *     init failed) → also ok({recorded:false}). The SDK lifecycle
 *     module already logs the reason.
 *   - Consent granted + SDK initialized → captureRendererError forwards
 *     via dynamic import so the @sentry/electron module stays unloaded
 *     pre-consent (codex v3 hard fix #2).
 *
 * The redacting `beforeSend` + breadcrumb allowlist handle the actual
 * scrubbing on the SDK side.
 */

import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import { preferencesStore } from "../preferences/store.js";
import { captureRendererError } from "../telemetry/sentry-lifecycle.js";
import { registerHandler } from "./register-handler.js";

const reportInput = z
  .object({
    kind: z.enum(["caught", "uncaught", "boundary"]),
    message: z.string().max(2000),
    componentStack: z.string().max(10000).nullable().optional(),
  })
  .strict();

const recordedOutput = z.object({ recorded: z.boolean() }).strict();

export function registerTelemetryHandler(): () => void {
  return registerHandler({
    channel: CH.telemetry.reportRendererError,
    domain: "telemetry",
    inputSchema: reportInput,
    outputSchema: recordedOutput,
    handle: async (input): Promise<Result<{ recorded: boolean }>> => {
      const prefs = await preferencesStore.load();
      if (!prefs.telemetry.enabled) {
        return ok({ recorded: false });
      }
      const recorded = await captureRendererError({
        kind: input.kind,
        message: input.message,
        componentStack: input.componentStack ?? null,
      });
      return ok({ recorded });
    },
  });
}
