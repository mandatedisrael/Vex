/**
 * VexBridge — typed surface exposed to renderer via contextBridge.
 *
 * Source-of-truth interface lives in src/shared/ so renderer + preload + main
 * all reference the same contract. Preload `satisfies VexBridge` ensures the
 * implementation matches without leaking implementation details to renderer.
 */

import type { Result } from "../ipc/result.js";
import type { Capabilities } from "../schemas/capabilities.js";
import type {
  MigrateProgress,
  MigrateResult,
} from "../schemas/database.js";
import type {
  ComposeDownResult,
  ComposeLog,
  ComposeUpResult,
  DockerStatus,
  InstallMethod,
  InstallProgress,
  InstallResult,
  StartResult,
} from "../schemas/docker.js";
import type { EnvState } from "../schemas/onboarding.js";
import type {
  KeystoreSetInput,
  KeystoreSetResult,
  SetWizardStateInput,
  WizardState,
} from "../schemas/wizard.js";
import type {
  WalletExportPrivateKeyInput,
  WalletExportPrivateKeyResult,
  WalletGenerateEvmResult,
  WalletGenerateSolanaResult,
  WalletImportEvmInput,
  WalletImportEvmResult,
  WalletImportSolanaInput,
  WalletImportSolanaResult,
  WalletOpenBackupFolderInput,
  WalletOpenBackupFolderResult,
  WalletRestoreInput,
  WalletRestoreResult,
} from "../schemas/wallets.js";
import type {
  ApiKeysSetInput,
  ApiKeysSetResult,
} from "../schemas/api-keys.js";
import type {
  EmbeddingConfigureInput,
  EmbeddingConfigureResult,
} from "../schemas/embedding.js";
import type {
  AgentCoreConfigureInput,
  AgentCoreConfigureResult,
} from "../schemas/agent-core.js";
import type {
  ProviderPersistInput,
  ProviderPersistResult,
} from "../schemas/provider.js";
import type {
  CompleteSetupInput,
  CompleteSetupResult,
} from "../schemas/finalize.js";
import type {
  SessionCreateInput,
  SessionCreateResult,
  SessionGetInput,
  SessionList,
  SessionListItem,
} from "../schemas/sessions.js";
import type {
  HealthReport,
  NetworkProbe,
  OsInfo,
} from "../schemas/system.js";
import type { Preferences } from "../schemas/preferences.js";
import type {
  SecretsLockResult,
  SecretsStatus,
  SecretsUnlockInput,
  SecretsUnlockResult,
} from "../schemas/secrets.js";

export interface TelemetryReportInput {
  readonly kind: "caught" | "uncaught" | "boundary";
  readonly message: string;
  readonly componentStack?: string | null;
}

export interface VexBridge {
  readonly capabilities: {
    readonly get: () => Promise<Result<Capabilities>>;
  };

  readonly system: {
    readonly health: () => Promise<Result<HealthReport>>;
    readonly osInfo: () => Promise<Result<OsInfo>>;
    readonly network: () => Promise<Result<NetworkProbe>>;
  };

  readonly docker: {
    readonly detect: () => Promise<Result<DockerStatus>>;
    readonly install: (input: {
      readonly method: InstallMethod;
    }) => Promise<Result<InstallResult>>;
    readonly start: () => Promise<Result<StartResult>>;
    readonly composeUp: (input: {
      readonly pgPort?: number;
    }) => Promise<Result<ComposeUpResult>>;
    readonly composeDown: () => Promise<Result<ComposeDownResult>>;
    /**
     * Subscribe to install progress events. Returns an idempotent
     * unsubscribe function — call it from the React effect cleanup
     * (skill §11). The renderer never sees the raw IPC channel.
     */
    readonly onInstallProgress: (
      cb: (payload: InstallProgress) => void
    ) => () => void;
    readonly onComposeLog: (
      cb: (payload: ComposeLog) => void
    ) => () => void;
  };

  readonly database: {
    readonly migrate: () => Promise<Result<MigrateResult>>;
    /**
     * Subscribe to migration progress events. Returns idempotent
     * unsubscribe — call from React effect cleanup. The bus replays
     * the most recent event to new subscribers so a late join
     * (StrictMode re-mount, joined single-flight) doesn't miss the
     * planned/index/total handshake.
     */
    readonly onProgress: (
      cb: (payload: MigrateProgress) => void
    ) => () => void;
  };

  readonly secrets: {
    readonly status: () => Promise<Result<SecretsStatus>>;
    readonly unlock: (
      input: SecretsUnlockInput
    ) => Promise<Result<SecretsUnlockResult>>;
    readonly lock: () => Promise<Result<SecretsLockResult>>;
  };

  /**
   * Sudo-style wallet operations on existing keystores. Distinct from
   * `onboarding.wallet*` which create/import keystores during setup —
   * these run post-onboarding and require a fresh password challenge.
   */
  readonly wallet: {
    /**
     * Re-authenticate the user, decrypt the chain's keystore inside
     * main, and place the raw private key on the OS clipboard with an
     * auto-clear lease. The renderer never sees the secret — the
     * Result only reports `copied: true` + how long until clipboard
     * is wiped. Triggers `wallet.export_throttled` (with retryAfterMs)
     * on rapid retries, and relocks the vault after 5 wrong-password
     * attempts in a single process lifetime.
     */
    readonly exportPrivateKey: (
      input: WalletExportPrivateKeyInput
    ) => Promise<Result<WalletExportPrivateKeyResult>>;
  };

  readonly onboarding: {
    readonly getEnvState: () => Promise<Result<EnvState>>;
    readonly getWizardState: () => Promise<Result<WizardState>>;
    readonly setWizardState: (
      input: SetWizardStateInput
    ) => Promise<Result<WizardState>>;
    readonly keystoreSet: (
      input: KeystoreSetInput
    ) => Promise<Result<KeystoreSetResult>>;
    readonly walletGenerateEvm: () => Promise<Result<WalletGenerateEvmResult>>;
    readonly walletGenerateSolana: () => Promise<Result<WalletGenerateSolanaResult>>;
    readonly walletImportEvm: (
      input: WalletImportEvmInput
    ) => Promise<Result<WalletImportEvmResult>>;
    readonly walletImportSolana: (
      input: WalletImportSolanaInput
    ) => Promise<Result<WalletImportSolanaResult>>;
    readonly walletRestoreFromBackup: (
      input: WalletRestoreInput
    ) => Promise<Result<WalletRestoreResult>>;
    readonly walletOpenBackupFolder: (
      input: WalletOpenBackupFolderInput
    ) => Promise<Result<WalletOpenBackupFolderResult>>;
    readonly apiKeysSet: (
      input: ApiKeysSetInput
    ) => Promise<Result<ApiKeysSetResult>>;
    readonly embeddingConfigure: (
      input: EmbeddingConfigureInput
    ) => Promise<Result<EmbeddingConfigureResult>>;
    readonly agentCoreConfigure: (
      input: AgentCoreConfigureInput
    ) => Promise<Result<AgentCoreConfigureResult>>;
    readonly providerPersist: (
      input: ProviderPersistInput
    ) => Promise<Result<ProviderPersistResult>>;
    readonly completeSetup: (
      input: CompleteSetupInput
    ) => Promise<Result<CompleteSetupResult>>;
  };

  readonly sessions: {
    readonly create: (
      input: SessionCreateInput
    ) => Promise<Result<SessionCreateResult>>;
    readonly list: () => Promise<Result<SessionList>>;
    readonly get: (
      input: SessionGetInput
    ) => Promise<Result<SessionListItem | null>>;
  };

  readonly settings: {
    readonly getPreferences: () => Promise<Result<Preferences>>;
    readonly setTelemetryConsent: (
      input: { readonly enabled: boolean }
    ) => Promise<Result<Preferences>>;
  };

  readonly telemetry: {
    readonly reportRendererError: (
      input: TelemetryReportInput
    ) => Promise<Result<{ recorded: boolean }>>;
  };
}
