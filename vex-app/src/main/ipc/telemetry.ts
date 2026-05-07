/**
 * vex.telemetry.reportRendererError — no-op stub bez consent.
 *
 * Per plan §L: Sentry SDK NIE init przed user explicit consent. Renderer code
 * może bezpiecznie wywoływać `window.vex.telemetry.reportRendererError(...)`
 * — jeśli consent NIE granted, returns ok({}) bez network call.
 *
 * Phase 2 (lub M11 z consent): zastąp ten stub real Sentry capture.
 */

import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import { preferencesStore } from "../preferences/store.js";
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
        // No-op: user has not opted in. Silently drop.
        return ok({ recorded: false });
      }
      // Phase 1: even with consent, we do NOT log raw renderer error messages
      // — they may contain wallet addresses, tx hashes, or other sensitive
      // strings. Real Sentry capture with full redacting beforeSend hook lands
      // in M11 (per plan §L). Until then, return recorded:false silently.
      void input;
      return ok({ recorded: false });
    },
  });
}
