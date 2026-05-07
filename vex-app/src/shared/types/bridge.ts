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

  readonly settings: {
    readonly getPreferences: () => Promise<Result<Preferences>>;
    readonly setTelemetryConsent: (
      enabled: boolean
    ) => Promise<Result<Preferences>>;
  };

  readonly telemetry: {
    readonly reportRendererError: (
      input: TelemetryReportInput
    ) => Promise<Result<{ recorded: boolean }>>;
  };
}
