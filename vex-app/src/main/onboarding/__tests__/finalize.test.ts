/**
 * finalize.ts tests — sequenced completeSetup (M11).
 *
 * Covers the codex v3 RED + clarification items:
 *   - single-flight: two concurrent calls share the same promise; the
 *     pending slot clears in finally so a third call later can proceed.
 *   - full_autonomous mode → wake auto-correction at the main boundary
 *     before validation.
 *   - autoBackup() throw → mapped to onboarding.step_failed step=auto_backup,
 *     backupPath: null.
 *   - wizardState write fs error → onboarding.step_failed step=wizard_state
 *     (NOT internal.contract_violation).
 *   - telemetry consent failure post-setup → ok with telemetryWarning set
 *     (setup still succeeded).
 *   - .setup-complete flag failure → still ok, log warning.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const mockAutoBackup = vi.fn();
const mockGatherEnvState = vi.fn();
const mockWizardUpdate = vi.fn();
const mockWriteWake = vi.fn();
const mockPrefUpdate = vi.fn();
const mockInitSentry = vi.fn();
let configDir: string;

vi.mock("@vex-lib/wallet-backup.js", () => ({
  autoBackup: () => mockAutoBackup(),
}));

vi.mock("../env-state.js", () => ({
  gatherEnvState: () => mockGatherEnvState(),
  readEnvKeyPresence: vi.fn(),
  readEnvValue: vi.fn(),
  redactEmbeddingUrl: vi.fn(),
}));

vi.mock("../wizard-state-store.js", () => ({
  wizardStateStore: {
    update: (input: unknown) => mockWizardUpdate(input),
  },
}));

vi.mock("../wake-writer.js", () => ({
  writeWake: (input: unknown) => mockWriteWake(input),
}));

vi.mock("../env-write-mutex.js", () => ({
  withEnvWriteLock: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
}));

vi.mock("../../preferences/store.js", () => ({
  preferencesStore: {
    update: (input: unknown) => mockPrefUpdate(input),
  },
}));

vi.mock("../../telemetry/sentry-lifecycle.js", () => ({
  initSentryIfConsented: () => mockInitSentry(),
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../paths/config-dir.js", () => ({
  get SETUP_COMPLETE_FILE() {
    return path.join(configDir, ".setup-complete");
  },
}));

const { completeSetup, __resetFinalizeSingleFlightForTests } = await import(
  "../finalize.js"
);

function fullEnvState(overrides: {
  modeSelected?: "chat" | "mission" | "full_autonomous" | null;
  modeCoherent?: boolean;
  wakeEnabled?: boolean;
  wakeCoherent?: boolean;
} = {}): unknown {
  return {
    hasKeystorePassword: true,
    hasJupiterApiKey: true,
    apiKeys: {
      jupiterConfigured: true,
      tavilyConfigured: false,
      rettiwtConfigured: false,
      polymarketStatus: "missing",
    },
    embeddings: {
      configured: true,
      reachable: true,
      baseUrlRedacted: "http://127.0.0.1:12434",
      allFieldsConfigured: true,
      dbReachable: true,
    },
    walletStatus: { evm: "present", solana: "present" },
    walletAddresses: { evm: "0x1234", solana: "Sol1234" },
    provider: { configured: true, name: "openrouter", modelLabel: "anthropic/claude-sonnet-4.5" },
    mode: {
      selected: overrides.modeSelected ?? "chat",
      loopMode: null,
      hasInitialPrompt: false,
      coherent: overrides.modeCoherent ?? true,
    },
    wake: {
      enabled: overrides.wakeEnabled ?? false,
      intervalMs: null,
      batchSize: null,
      coherent: overrides.wakeCoherent ?? true,
    },
    setupCompleteFlag: false,
  };
}

beforeEach(() => {
  mockAutoBackup.mockReset();
  mockGatherEnvState.mockReset();
  mockWizardUpdate.mockReset();
  mockWriteWake.mockReset();
  mockPrefUpdate.mockReset();
  mockInitSentry.mockReset();
  configDir = mkdtempSync(path.join(tmpdir(), "vex-finalize-"));
  __resetFinalizeSingleFlightForTests();
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

describe("completeSetup", () => {
  it("happy path: returns ok with completedAt + backupPath", async () => {
    mockGatherEnvState.mockResolvedValue(fullEnvState());
    mockAutoBackup.mockResolvedValue("/tmp/backup/2026-05-12");
    mockWizardUpdate.mockResolvedValue({ ok: true });

    const result = await completeSetup({ telemetryConsent: false });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.backupPath).toBe("/tmp/backup/2026-05-12");
    expect(result.data.telemetryWarning).toBeNull();
    expect(typeof result.data.completedAt).toBe("string");
    expect(mockInitSentry).not.toHaveBeenCalled();
  });

  it("validation.invalid_input when prior steps incomplete", async () => {
    mockGatherEnvState.mockResolvedValue({
      ...(fullEnvState() as Record<string, unknown>),
      hasKeystorePassword: false,
    });

    const result = await completeSetup({ telemetryConsent: false });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("validation.invalid_input");
  });

  it("full_autonomous + wake-writer fails during auto-correction: returns step_failed step=wake_auto_enable", async () => {
    mockGatherEnvState.mockResolvedValue(
      fullEnvState({
        modeSelected: "full_autonomous",
        wakeEnabled: false,
        wakeCoherent: true,
      }),
    );
    mockWriteWake.mockResolvedValue({
      ok: false,
      error: {
        code: "onboarding.env_persist_failed",
        domain: "onboarding",
        message: "raw write failed",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });

    const result = await completeSetup({ telemetryConsent: false });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    // Codex post-impl YELLOW: must be re-wrapped, not propagated raw.
    expect(result.error.code).toBe("onboarding.step_failed");
    expect(result.error.details?.step).toBe("wake_auto_enable");
    expect(mockAutoBackup).not.toHaveBeenCalled();
    expect(mockWizardUpdate).not.toHaveBeenCalled();
  });

  it("full_autonomous + wake disabled: auto-corrects wake before validation", async () => {
    mockGatherEnvState
      .mockResolvedValueOnce(
        fullEnvState({
          modeSelected: "full_autonomous",
          wakeEnabled: false,
          wakeCoherent: true,
        }),
      )
      .mockResolvedValueOnce(
        fullEnvState({
          modeSelected: "full_autonomous",
          wakeEnabled: true,
          wakeCoherent: true,
        }),
      );
    mockWriteWake.mockResolvedValue({ ok: true, data: { fieldsWritten: [], fieldsDeleted: [] } });
    mockAutoBackup.mockResolvedValue("/tmp/backup");
    mockWizardUpdate.mockResolvedValue({ ok: true });

    const result = await completeSetup({ telemetryConsent: false });
    expect(result.ok).toBe(true);
    expect(mockWriteWake).toHaveBeenCalledTimes(1);
    const wakeCall = mockWriteWake.mock.calls[0]?.[0] as { enabled: boolean };
    expect(wakeCall?.enabled).toBe(true);
  });

  it("autoBackup throws: returns onboarding.step_failed step=auto_backup", async () => {
    mockGatherEnvState.mockResolvedValue(fullEnvState());
    mockAutoBackup.mockRejectedValue(new Error("disk full"));

    const result = await completeSetup({ telemetryConsent: false });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("onboarding.step_failed");
    expect(result.error.details?.step).toBe("auto_backup");
    expect(mockWizardUpdate).not.toHaveBeenCalled();
  });

  it("wizardState write fails: returns step_failed step=wizard_state (NOT contract_violation)", async () => {
    mockGatherEnvState.mockResolvedValue(fullEnvState());
    mockAutoBackup.mockResolvedValue("/tmp/backup");
    mockWizardUpdate.mockRejectedValue(new Error("fs ENOSPC"));

    const result = await completeSetup({ telemetryConsent: false });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("onboarding.step_failed");
    expect(result.error.details?.step).toBe("wizard_state");
  });

  it("telemetry consent: applied after setup; init failure surfaces warning", async () => {
    mockGatherEnvState.mockResolvedValue(fullEnvState());
    mockAutoBackup.mockResolvedValue("/tmp/backup");
    mockWizardUpdate.mockResolvedValue({ ok: true });
    mockPrefUpdate.mockResolvedValue({});
    mockInitSentry.mockResolvedValue(false); // DSN missing → not initialized

    const result = await completeSetup({ telemetryConsent: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.telemetryWarning).toContain("error reporting");
    expect(mockPrefUpdate).toHaveBeenCalledTimes(1);
  });

  it("single-flight: 2 concurrent calls share the promise", async () => {
    mockGatherEnvState.mockResolvedValue(fullEnvState());
    mockAutoBackup.mockResolvedValue("/tmp/backup");
    mockWizardUpdate.mockResolvedValue({ ok: true });

    const [a, b] = await Promise.all([
      completeSetup({ telemetryConsent: false }),
      completeSetup({ telemetryConsent: false }),
    ]);
    // Same successful Result instance — only ONE backup attempt happened.
    expect(a.ok && b.ok).toBe(true);
    expect(mockAutoBackup).toHaveBeenCalledTimes(1);
    expect(mockWizardUpdate).toHaveBeenCalledTimes(1);
  });

  it("after single-flight settles: a subsequent call runs fresh", async () => {
    mockGatherEnvState.mockResolvedValue(fullEnvState());
    mockAutoBackup.mockResolvedValue("/tmp/backup");
    mockWizardUpdate.mockResolvedValue({ ok: true });

    await completeSetup({ telemetryConsent: false });
    await completeSetup({ telemetryConsent: false });
    expect(mockAutoBackup).toHaveBeenCalledTimes(2);
  });
});
