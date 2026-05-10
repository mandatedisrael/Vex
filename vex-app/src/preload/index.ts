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
import { CH, EV } from "../shared/ipc/channels.js";
import { err, type Result, type VexError } from "../shared/ipc/result.js";
import { migrateProgressSchema } from "../shared/schemas/database.js";
import {
  composeLogSchema,
  installMethodSchema,
  installProgressSchema,
} from "../shared/schemas/docker.js";
import {
  keystoreSetInputSchema,
  setWizardStateInputSchema,
} from "../shared/schemas/wizard.js";
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

/**
 * Domain-namespaced event subscription helper. Renderer never sees raw
 * channel strings — every subscription comes through a typed bridge
 * method (`vex.docker.onInstallProgress`, etc.) that calls into this.
 * Payload is Zod-validated at the preload boundary so a misbehaving
 * main never injects unexpected shapes into renderer state.
 */
function subscribe<T>(
  channel: string,
  schema: z.ZodType<T>,
  cb: (payload: T) => void
): () => void {
  const handler = (_event: unknown, raw: unknown): void => {
    const parsed = schema.safeParse(raw);
    if (parsed.success) cb(parsed.data);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
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

  docker: {
    detect() {
      return invokeWithSchema(CH.docker.detect, {});
    },
    install(input: { method: import("../shared/schemas/docker.js").InstallMethod }) {
      return invokeWithSchema(
        CH.docker.install,
        input,
        z.object({ method: installMethodSchema }).strict()
      );
    },
    start() {
      return invokeWithSchema(CH.docker.start, {});
    },
    composeUp(input: { pgPort?: number } = {}) {
      return invokeWithSchema(
        CH.docker.composeUp,
        input,
        z
          .object({ pgPort: z.number().int().min(1).max(65535).optional() })
          .strict()
      );
    },
    composeDown() {
      return invokeWithSchema(CH.docker.composeDown, {});
    },
    onInstallProgress(cb) {
      return subscribe(EV.docker.installProgress, installProgressSchema, cb);
    },
    onComposeLog(cb) {
      return subscribe(EV.docker.composeLogs, composeLogSchema, cb);
    },
  },

  database: {
    migrate() {
      return invokeWithSchema(CH.database.migrate, {});
    },
    onProgress(cb) {
      return subscribe(EV.database.migrateProgress, migrateProgressSchema, cb);
    },
  },

  onboarding: {
    getEnvState() {
      return invokeWithSchema(CH.onboarding.getEnvState, {});
    },
    getWizardState() {
      return invokeWithSchema(CH.onboarding.getWizardState, {});
    },
    setWizardState(input: import("../shared/schemas/wizard.js").SetWizardStateInput) {
      return invokeWithSchema(
        CH.onboarding.setWizardState,
        input,
        setWizardStateInputSchema
      );
    },
    keystoreSet(input: import("../shared/schemas/wizard.js").KeystoreSetInput) {
      return invokeWithSchema(
        CH.onboarding.keystoreSet,
        input,
        keystoreSetInputSchema
      );
    },
  },

  settings: {
    getPreferences() {
      return invokeWithSchema(CH.settings.getPreferences, {});
    },
    setTelemetryConsent(input: { enabled: boolean }) {
      return invokeWithSchema(
        CH.settings.setTelemetryConsent,
        input,
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
