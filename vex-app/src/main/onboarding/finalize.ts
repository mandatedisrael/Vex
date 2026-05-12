/**
 * Wizard finalize (M11 Step 9).
 *
 * Sequenced execution with explicit failure contract (codex v3 D10):
 *
 *   1. Validate envState — defensive; renderer is supposed to gate
 *      Review behind every prior step but a hand-crafted wizard-state
 *      file could land here without provider/wallets/etc.
 *   2. Wake-coherence enforcement at the main boundary (codex v3
 *      Y2/RED #5): full_autonomous mode forces wake on with default
 *      schedule when the operator left it disabled or with invalid
 *      values. Atomic .env mutation.
 *   3. autoBackup() (engine bridge `@vex-lib/wallet-backup`). Throws
 *      VexError(AUTO_BACKUP_FAILED) on fs failure → mapped to
 *      onboarding.step_failed step:auto_backup. backupPath is
 *      `string | null` because the engine returns null when there's
 *      nothing to back up.
 *   4. wizardState.completed = true. fs error → onboarding.step_failed
 *      step:wizard_state (NOT internal.contract_violation per codex
 *      v2 catch — fs failure is operational, not a schema bug).
 *   5. Telemetry consent flip (only if consent=true). Failure here
 *      does NOT fail finalize — setup is already done; we surface
 *      `telemetryWarning` so the renderer can prompt the operator
 *      to retry from Settings later.
 *   6. Best-effort `${SETUP_COMPLETE_FILE}` flag write. Primary skip-
 *      gate is `wizardState.completed`; the flag exists for future
 *      vex-shell skip detection. Best-effort = log + continue.
 *
 * Single-flight via module-scope promise (codex v3 fix #3): a second
 * call while finalize is in flight returns the first call's promise
 * (and so the first call's `telemetryConsent` value). Renderer disables
 * the Finalize button on submit so this is defense-in-depth, not user
 * flow. The pending slot is cleared in `finally` whether the call
 * resolves or throws.
 */

import { promises as fs } from "node:fs";
import { autoBackup } from "@vex-lib/wallet-backup.js";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import { WIZARD_STEP_IDS } from "@shared/schemas/wizard.js";
import {
  WAKE_DEFAULT_BATCH_SIZE,
  WAKE_DEFAULT_INTERVAL_MS,
} from "@shared/schemas/wake.js";
import type {
  CompleteSetupInput,
  CompleteSetupResult,
} from "@shared/schemas/finalize.js";
import { SETUP_COMPLETE_FILE } from "../paths/config-dir.js";
import { log } from "../logger/index.js";
import { preferencesStore } from "../preferences/store.js";
import { initSentryIfConsented } from "../telemetry/sentry-lifecycle.js";
import { gatherEnvState } from "./env-state.js";
import { wizardStateStore } from "./wizard-state-store.js";
import { withEnvWriteLock } from "./env-write-mutex.js";
import { writeWake } from "./wake-writer.js";
import type { EnvState } from "@shared/schemas/onboarding.js";

const PRIOR_STEPS = WIZARD_STEP_IDS.filter((id) => id !== "review");

let pending: Promise<Result<CompleteSetupResult>> | null = null;

export function completeSetup(
  input: CompleteSetupInput,
): Promise<Result<CompleteSetupResult>> {
  if (pending) return pending;
  const promise = (async () => {
    try {
      return await runFinalize(input);
    } finally {
      pending = null;
    }
  })();
  pending = promise;
  return promise;
}

interface IncompleteItem {
  readonly section: string;
  readonly reason: string;
}

function listMissingItems(envState: EnvState): IncompleteItem[] {
  const missing: IncompleteItem[] = [];
  if (!envState.hasKeystorePassword) {
    missing.push({ section: "keystore", reason: "Master password not set." });
  }
  if (envState.walletStatus.evm !== "present") {
    missing.push({ section: "wallets", reason: "EVM wallet not configured." });
  }
  if (envState.walletStatus.solana !== "present") {
    missing.push({ section: "wallets", reason: "Solana wallet not configured." });
  }
  if (!envState.apiKeys.jupiterConfigured) {
    missing.push({ section: "apiKeys", reason: "Jupiter API key required." });
  }
  if (!envState.embeddings.allFieldsConfigured) {
    missing.push({ section: "embedding", reason: "Embedding configuration incomplete." });
  }
  if (!envState.provider.configured) {
    missing.push({ section: "provider", reason: "Inference provider not configured." });
  }
  if (!envState.mode.coherent) {
    missing.push({ section: "mode", reason: "Mode selection incomplete." });
  }
  if (!envState.wake.coherent) {
    missing.push({ section: "wake", reason: "Wake configuration invalid." });
  }
  return missing;
}

function buildValidationError(missing: IncompleteItem[]): VexError {
  return {
    code: "validation.invalid_input",
    domain: "onboarding",
    message: "Setup is incomplete — finish every prior step before finalizing.",
    retryable: false,
    userActionable: true,
    redacted: true,
    details: {
      missing: missing.map((m) => ({ section: m.section, reason: m.reason })),
    },
  };
}

function buildStepFailed(
  step: "auto_backup" | "wizard_state" | "wake_auto_enable",
  message: string,
): VexError {
  return {
    code: "onboarding.step_failed",
    domain: "onboarding",
    message,
    retryable: true,
    userActionable: true,
    redacted: true,
    details: { step },
  };
}

async function ensureFullAutonomousWakeCoherent(
  envState: EnvState,
): Promise<Result<void>> {
  if (envState.mode.selected !== "full_autonomous") return ok(undefined);
  if (envState.wake.enabled === true && envState.wake.coherent) return ok(undefined);
  log.info(
    "[finalize] full_autonomous detected — enforcing wake on with defaults",
  );
  const wakeResult = await withEnvWriteLock(() =>
    writeWake({
      enabled: true,
      intervalMs: WAKE_DEFAULT_INTERVAL_MS,
      batchSize: WAKE_DEFAULT_BATCH_SIZE,
    }),
  );
  if (!wakeResult.ok) {
    // Codex post-impl: a wake-write failure during auto-correction must
    // block finalize and surface a finalize-specific step taxonomy
    // (`wake_auto_enable`), not propagate the env-persist error code
    // which would suggest the operator can re-enter the wake step.
    log.error(
      "[finalize] wake auto-enable for full_autonomous failed; aborting finalize",
    );
    return err(
      buildStepFailed(
        "wake_auto_enable",
        "Full autonomous mode requires the wake executor, but Vex couldn't " +
          "save the wake configuration. Check disk space and permissions, then retry.",
      ),
    );
  }
  return ok(undefined);
}

async function runFinalize(
  input: CompleteSetupInput,
): Promise<Result<CompleteSetupResult>> {
  // 1. Validate envState
  let envState = await gatherEnvState();

  // 2. Wake coherence enforcement BEFORE the missing-items check —
  // a fix-up here keeps the next gather honest if the operator's only
  // gap was the implicit wake-on-full-autonomous rule.
  const wakeFix = await ensureFullAutonomousWakeCoherent(envState);
  if (!wakeFix.ok) return wakeFix;
  envState = await gatherEnvState();

  const missing = listMissingItems(envState);
  if (missing.length > 0) {
    return err(buildValidationError(missing));
  }

  // 3. autoBackup
  let backupPath: string | null = null;
  try {
    backupPath = await autoBackup();
  } catch (cause) {
    log.error("[finalize] autoBackup failed", cause);
    return err(
      buildStepFailed(
        "auto_backup",
        "Auto-backup failed before finishing setup. Check disk space and permissions, then retry.",
      ),
    );
  }

  // 4. wizardState.completed = true
  try {
    await wizardStateStore.update({
      currentStepId: "review",
      completedSteps: PRIOR_STEPS,
      completed: true,
    });
  } catch (cause) {
    log.error("[finalize] wizardState write failed", cause);
    return err(
      buildStepFailed(
        "wizard_state",
        "Could not save wizard completion state. Try again — your backup is already on disk.",
      ),
    );
  }

  // 5. Telemetry consent (post-setup, never blocks finalize)
  let telemetryWarning: string | null = null;
  if (input.telemetryConsent) {
    try {
      await preferencesStore.update({
        telemetry: {
          enabled: true,
          consentedAt: new Date().toISOString(),
        },
      });
      const initialized = await initSentryIfConsented();
      if (!initialized) {
        telemetryWarning =
          "Setup is complete, but error reporting could not be activated (DSN missing in this build). You can opt in later from Settings.";
      }
    } catch (cause) {
      log.error("[finalize] telemetry consent apply failed", cause);
      telemetryWarning =
        "Setup is complete, but turning on error reporting failed. You can enable it later from Settings.";
    }
  }

  // 6. .setup-complete flag (best-effort)
  try {
    await fs.writeFile(SETUP_COMPLETE_FILE, "", { mode: 0o600 });
  } catch (cause) {
    log.warn(
      "[finalize] could not write .setup-complete flag (best-effort, non-blocking)",
      cause,
    );
  }

  const completedAt = new Date().toISOString();
  log.info(
    `[finalize] complete completedAt=${completedAt} hasBackup=${backupPath !== null} ` +
      `telemetryConsent=${input.telemetryConsent} telemetryWarning=${
        telemetryWarning !== null
      }`,
  );

  return ok({ completedAt, backupPath, telemetryWarning });
}

/** Test-only — production callers do not import this. */
export function __resetFinalizeSingleFlightForTests(): void {
  pending = null;
}
