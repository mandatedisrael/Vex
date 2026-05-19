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
  PolymarketAutoSetupInput,
  PolymarketAutoSetupResult,
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
  SessionDeleteInput,
  SessionDeleteResult,
  SessionGetInput,
  SessionList,
  SessionListItem,
  SessionSetPinnedInput,
  SessionSetPinnedResult,
} from "../schemas/sessions.js";
import type {
  ChatSubmitInput,
  ChatSubmitResult,
} from "../schemas/chat.js";
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
import type {
  CreateBugReportInput,
  CreateBugReportResult,
} from "../schemas/bug-reports.js";

export interface TelemetryReportInput {
  readonly kind: "caught" | "uncaught" | "boundary";
  readonly message: string;
  readonly componentStack?: string | null;
}

/**
 * Shape returned by long-running bridge methods that support user
 * cancellation (PR3). Renderer holds onto `cancel`; calling it asks
 * main to abort the in-flight handler. The original `promise` then
 * resolves to `Result<E:internal.cancelled>` — cancellation is a
 * normal Result outcome, not a rejection.
 *
 * `cancel` is idempotent: subsequent calls after the first are no-ops.
 */
export interface AbortableInvocation<T> {
  readonly promise: Promise<Result<T>>;
  readonly cancel: () => void;
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
    /**
     * Abortable variant of `composeUp` (PR3). Returns
     * `{promise, cancel}` so the renderer can let the user abort an
     * in-flight bootstrap (e.g. a slow image pull). On cancel, the
     * returned promise resolves to `Result<E:internal.cancelled>`.
     *
     * NOTE: this hits the SAME IPC channel as `composeUp` and shares
     * the same main-side single-flight semantics. A joined caller's
     * cancel detaches THAT caller's wait only — it never aborts the
     * shared compose subprocess (only the initiator's signal flows
     * into `runSpawn`).
     */
    readonly composeUpAbortable: (input: {
      readonly pgPort?: number;
    }) => AbortableInvocation<ComposeUpResult>;
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
    /**
     * One-click Polymarket setup (Phase 2 feature #7). Derives CLOB API
     * credentials from the unlocked EVM wallet keystore via the engine
     * primitive, persists them inside the encrypted secret vault, and
     * returns the wallet address. Result does NOT carry credentials —
     * the renderer reads canonical envState for confirmation.
     */
    readonly polymarketAutoSetup: (
      input: PolymarketAutoSetupInput
    ) => Promise<Result<PolymarketAutoSetupResult>>;
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
    /**
     * Pin/unpin a session. Idempotent on both sides: re-pinning preserves
     * the existing `pinnedAt`, re-unpinning is a no-op. Returns `null`
     * when the id is unknown (stale renderer cache).
     */
    readonly setPinned: (
      input: SessionSetPinnedInput
    ) => Promise<Result<SessionSetPinnedResult>>;
    /**
     * Soft-delete a session. Main enforces fail-closed against active
     * mission runs and pending approvals; the discriminated outcome
     * tells the renderer whether cache cleanup is appropriate.
     */
    readonly delete: (
      input: SessionDeleteInput
    ) => Promise<Result<SessionDeleteResult>>;
  };

  readonly chat: {
    /**
     * Submit operator text for the active session. Mission sessions treat
     * their first submit as the initial goal before entering setup.
     */
    readonly submit: (
      input: ChatSubmitInput
    ) => Promise<Result<ChatSubmitResult>>;
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

  /**
   * Local-first bug report sink (Phase 1). Persists to the local
   * `bug_reports` table after redaction. Distinct from Sentry telemetry —
   * this path runs without consent because the data stays on the user's
   * disk. Phase 3 will add an opt-in upload path on top of the same table.
   */
  readonly support: {
    readonly createBugReport: (
      input: CreateBugReportInput
    ) => Promise<Result<CreateBugReportResult>>;
  };
}
