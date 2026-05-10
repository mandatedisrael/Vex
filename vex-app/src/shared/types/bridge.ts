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
  HealthReport,
  NetworkProbe,
  OsInfo,
} from "../schemas/system.js";
import type { Preferences } from "../schemas/preferences.js";

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

  readonly onboarding: {
    readonly getEnvState: () => Promise<Result<EnvState>>;
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
