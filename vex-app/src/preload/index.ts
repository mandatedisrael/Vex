/**
 * Preload bridge — exposes typed `window.vex` API to renderer.
 *
 * Bundled to CommonJS at `dist/preload/index.cjs` (Vite preload config) —
 * sandboxed preload requires CJS per Electron docs.
 *
 * Exposes ONLY whitelisted business methods. NEVER `ipcRenderer`, `send`,
 * `invoke`, or raw channel names. Every payload validated:
 *   1. Preload-side Zod schema (catches programmer error early in renderer)
 *   2. Main-side Zod schema in registerHandler (defense-in-depth)
 *
 * Outputs are typed Result<T, VexError>.
 */

import { contextBridge, ipcRenderer } from "electron";
import { z } from "zod";
import { CH } from "../shared/ipc/channels.js";
import { err, type Result, type VexError } from "../shared/ipc/result.js";
import type { VexBridge } from "../shared/types/bridge.js";

function newRequestId(): string {
  return crypto.randomUUID();
}

function preloadValidationError(): Result<never, VexError> {
  return err({
    code: "validation.invalid_input",
    domain: "preload",
    message: "Invalid input rejected by preload boundary.",
    retryable: false,
    userActionable: false,
    redacted: true,
  });
}

async function invokeWithSchema<T, I = unknown>(
  channel: string,
  payload: I,
  inputSchema?: z.ZodType<I>
): Promise<Result<T, VexError>> {
  if (inputSchema) {
    // Preload-side validation: catch invalid renderer payloads before crossing IPC.
    const parsed = inputSchema.safeParse(payload);
    if (!parsed.success) {
      return preloadValidationError() as Result<T, VexError>;
    }
  }
  const requestId = newRequestId();
  return (await ipcRenderer.invoke(channel, {
    requestId,
    payload: payload ?? {},
  })) as Result<T, VexError>;
}

// ── Preload-side schemas (mirror main; lightweight) ───────────────────────
const setTelemetryConsentSchema = z.boolean();
const reportRendererErrorSchema = z
  .object({
    kind: z.enum(["caught", "uncaught", "boundary"]),
    message: z.string().max(2000),
    componentStack: z.string().max(10000).nullable().optional(),
  })
  .strict();

// ── Bridge implementation — must satisfy VexBridge contract ───────────────
const api = {
  capabilities: {
    get() {
      return invokeWithSchema(CH.capabilities.get, {});
    },
  },

  system: {
    health() {
      return invokeWithSchema(CH.system.health, {});
    },
    osInfo() {
      return invokeWithSchema(CH.system.osInfo, {});
    },
    network() {
      return invokeWithSchema(CH.system.network, {});
    },
  },

  settings: {
    getPreferences() {
      return invokeWithSchema(CH.settings.getPreferences, {});
    },
    setTelemetryConsent(enabled: boolean) {
      return invokeWithSchema(
        CH.settings.setTelemetryConsent,
        { enabled },
        z.object({ enabled: setTelemetryConsentSchema }).strict()
      );
    },
  },

  telemetry: {
    reportRendererError(input) {
      return invokeWithSchema(
        CH.telemetry.reportRendererError,
        input,
        reportRendererErrorSchema
      );
    },
  },
} satisfies VexBridge;

contextBridge.exposeInMainWorld("vex", api);
