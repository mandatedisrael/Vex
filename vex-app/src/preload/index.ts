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
import {
  walletExportPrivateKeyInputSchema,
  walletGenerateInputSchema,
  walletImportEvmInputSchema,
  walletImportSolanaInputSchema,
  walletOpenBackupFolderInputSchema,
  walletRestoreInputSchema,
} from "../shared/schemas/wallets.js";
import {
  apiKeysSetInputSchema,
  polymarketAutoSetupInputSchema,
} from "../shared/schemas/api-keys.js";
import { embeddingConfigureInputSchema } from "../shared/schemas/embedding.js";
import { agentCoreConfigureInputSchema } from "../shared/schemas/agent-core.js";
import { providerPersistInputSchema } from "../shared/schemas/provider.js";
import { completeSetupInputSchema } from "../shared/schemas/finalize.js";
import {
  secretsLockInputSchema,
  secretsUnlockInputSchema,
} from "../shared/schemas/secrets.js";
import {
  sessionCreateInputSchema,
  sessionGetInputSchema,
} from "../shared/schemas/sessions.js";
import type { VexBridge } from "../shared/types/bridge.js";

function newRequestId(): string {
  return crypto.randomUUID();
}

function preloadValidationError(correlationId: string): Result<never, VexError> {
  return err({
    code: "validation.invalid_input",
    domain: "preload",
    message: "Invalid input rejected by preload boundary.",
    retryable: false,
    userActionable: false,
    redacted: true,
    correlationId,
  });
}

async function invokeWithSchema<T, I = unknown>(
  channel: string,
  payload: I,
  inputSchema?: z.ZodType<I>
): Promise<Result<T, VexError>> {
  // Generate the correlation id up front so validation errors carry it too.
  const requestId = newRequestId();
  if (inputSchema) {
    // Preload-side validation: catch invalid renderer payloads before crossing IPC.
    const parsed = inputSchema.safeParse(payload);
    if (!parsed.success) {
      return preloadValidationError(requestId) as Result<T, VexError>;
    }
  }
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

  secrets: {
    status() {
      return invokeWithSchema(CH.secrets.status, {});
    },
    unlock(input: import("../shared/schemas/secrets.js").SecretsUnlockInput) {
      return invokeWithSchema(
        CH.secrets.unlock,
        input,
        secretsUnlockInputSchema
      );
    },
    lock() {
      return invokeWithSchema(CH.secrets.lock, {}, secretsLockInputSchema);
    },
  },

  wallet: {
    exportPrivateKey(
      input: import("../shared/schemas/wallets.js").WalletExportPrivateKeyInput
    ) {
      return invokeWithSchema(
        CH.wallet.exportPrivateKey,
        input,
        walletExportPrivateKeyInputSchema
      );
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
    walletGenerateEvm() {
      return invokeWithSchema(
        CH.onboarding.walletGenerateEvm,
        {},
        walletGenerateInputSchema
      );
    },
    walletGenerateSolana() {
      return invokeWithSchema(
        CH.onboarding.walletGenerateSolana,
        {},
        walletGenerateInputSchema
      );
    },
    walletImportEvm(input: import("../shared/schemas/wallets.js").WalletImportEvmInput) {
      return invokeWithSchema(
        CH.onboarding.walletImportEvm,
        input,
        walletImportEvmInputSchema
      );
    },
    walletImportSolana(input: import("../shared/schemas/wallets.js").WalletImportSolanaInput) {
      return invokeWithSchema(
        CH.onboarding.walletImportSolana,
        input,
        walletImportSolanaInputSchema
      );
    },
    walletRestoreFromBackup(input: import("../shared/schemas/wallets.js").WalletRestoreInput) {
      return invokeWithSchema(
        CH.onboarding.walletRestoreFromBackup,
        input,
        walletRestoreInputSchema
      );
    },
    walletOpenBackupFolder(input: import("../shared/schemas/wallets.js").WalletOpenBackupFolderInput) {
      return invokeWithSchema(
        CH.onboarding.walletOpenBackupFolder,
        input,
        walletOpenBackupFolderInputSchema
      );
    },
    apiKeysSet(input: import("../shared/schemas/api-keys.js").ApiKeysSetInput) {
      return invokeWithSchema(
        CH.onboarding.apiKeysSet,
        input,
        apiKeysSetInputSchema
      );
    },
    polymarketAutoSetup(
      input: import("../shared/schemas/api-keys.js").PolymarketAutoSetupInput
    ) {
      return invokeWithSchema(
        CH.onboarding.polymarketAutoSetup,
        input,
        polymarketAutoSetupInputSchema
      );
    },
    embeddingConfigure(input: import("../shared/schemas/embedding.js").EmbeddingConfigureInput) {
      return invokeWithSchema(
        CH.onboarding.embeddingConfigure,
        input,
        embeddingConfigureInputSchema
      );
    },
    agentCoreConfigure(input: import("../shared/schemas/agent-core.js").AgentCoreConfigureInput) {
      return invokeWithSchema(
        CH.onboarding.agentCoreConfigure,
        input,
        agentCoreConfigureInputSchema
      );
    },
    providerPersist(input: import("../shared/schemas/provider.js").ProviderPersistInput) {
      return invokeWithSchema(
        CH.onboarding.providerPersist,
        input,
        providerPersistInputSchema
      );
    },
    completeSetup(input: import("../shared/schemas/finalize.js").CompleteSetupInput) {
      return invokeWithSchema(
        CH.onboarding.completeSetup,
        input,
        completeSetupInputSchema
      );
    },
  },

  sessions: {
    create(input: import("../shared/schemas/sessions.js").SessionCreateInput) {
      return invokeWithSchema(
        CH.sessions.create,
        input,
        sessionCreateInputSchema
      );
    },
    list() {
      return invokeWithSchema(CH.sessions.list, {});
    },
    get(input: import("../shared/schemas/sessions.js").SessionGetInput) {
      return invokeWithSchema(
        CH.sessions.get,
        input,
        sessionGetInputSchema
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
