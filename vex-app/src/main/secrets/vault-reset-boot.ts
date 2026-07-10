import {
  app,
  dialog,
  shell,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";
import { randomUUID } from "node:crypto";
import { log } from "../logger/index.js";
import { resolveContainedLogsDir } from "../support/logs-dir.js";
import { clearVaultResetJournal } from "./vault-reset-journal.js";
import {
  runVaultResetTransaction,
  type VaultResetRecoveryResult,
} from "./vault-reset-transaction.js";

export type BootDisposition = "continueBoot" | "quitRequested";

export interface RecoveryDialogDeps {
  readonly showMessageBox: (
    options: MessageBoxOptions,
  ) => Promise<MessageBoxReturnValue>;
  readonly openLogsFolder: () => Promise<boolean>;
  readonly clearJournal: () => Promise<void>;
  readonly quit: () => void;
}

const productionDialogDeps: RecoveryDialogDeps = {
  showMessageBox: (options) => dialog.showMessageBox(options),
  openLogsFolder: async () => {
    const logsDir = await resolveContainedLogsDir();
    if (logsDir === null) return false;
    try {
      return (await shell.openPath(logsDir)) === "";
    } catch {
      return false;
    }
  },
  clearJournal: () => clearVaultResetJournal(),
  quit: () => app.quit(),
};

export async function presentVaultResetRecovery(
  initial: VaultResetRecoveryResult,
  deps: RecoveryDialogDeps = productionDialogDeps,
): Promise<BootDisposition> {
  if (initial === "no-op" || initial === "completed") return "continueBoot";
  const correlationId = randomUUID();
  let state = initial;
  let openFailed = false;
  for (;;) {
    const recoverable = state === "recoverable-request-failure";
    const buttons = recoverable
      ? ["Open logs folder", "Cancel reset and continue", "Quit and retry"]
      : ["Open logs folder", "Quit"];
    const choice = await deps.showMessageBox({
      type: "error",
      title: recoverable ? "Vault reset could not start" : "Vault reset needs attention",
      message: recoverable
        ? "Vex could not create the required safety backup."
        : "Vex stopped vault recovery because its safety checks could not be verified.",
      detail:
        (openFailed
          ? "The logs folder could not be opened automatically. "
          : "") +
        `No unsafe recovery work will continue. Correlation ID: ${correlationId}`,
      buttons,
      defaultId: buttons.length - 1,
      cancelId: buttons.length - 1,
      noLink: true,
    });
    if (choice.response === 0) {
      openFailed = !(await deps.openLogsFolder());
      log.info(
        `[vault-reset] recovery dialog action=open-logs state=${state} opened=${!openFailed} correlationId=${correlationId}`,
      );
      continue;
    }
    if (recoverable && choice.response === 1) {
      try {
        await deps.clearJournal();
        log.info(
          `[vault-reset] recovery cancelled journalClears=1 correlationId=${correlationId}`,
        );
        return "continueBoot";
      } catch {
        state = "unsafe-recovery-state";
        openFailed = false;
        log.warn(
          `[vault-reset] cancel journal clear failed state=${state} correlationId=${correlationId}`,
        );
        continue;
      }
    }
    log.warn(
      `[vault-reset] recovery quit requested state=${state} correlationId=${correlationId}`,
    );
    deps.quit();
    return "quitRequested";
  }
}

export interface EarlyBootDeps {
  readonly recover: () => Promise<VaultResetRecoveryResult>;
  readonly presentRecovery: (
    result: VaultResetRecoveryResult,
  ) => Promise<BootDisposition>;
  readonly loadEnvironment: () => void;
  readonly initializeRuntime: () => Promise<void>;
}

export async function orchestrateEarlyBoot(
  deps: EarlyBootDeps,
): Promise<BootDisposition> {
  const recovery = await deps.recover();
  const disposition = await deps.presentRecovery(recovery);
  if (disposition === "quitRequested") return disposition;
  deps.loadEnvironment();
  await deps.initializeRuntime();
  return "continueBoot";
}

export function runProductionEarlyBoot(
  loadEnvironment: () => void,
  initializeRuntime: () => Promise<void>,
): Promise<BootDisposition> {
  return orchestrateEarlyBoot({
    recover: () => runVaultResetTransaction(),
    presentRecovery: (result) => presentVaultResetRecovery(result),
    loadEnvironment,
    initializeRuntime,
  });
}
