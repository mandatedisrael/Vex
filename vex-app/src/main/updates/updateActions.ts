/**
 * Business actions behind the `vex.updater.*` IPC surface (M13).
 *
 * Two-step UX: `startUpdateNow` consents to DOWNLOAD only; `restartAndInstallNow`
 * is the SEPARATE explicit restart action. `update-downloaded` (in
 * configureUpdater) never auto-restarts. Every action returns a redacted
 * `Result`; the renderer never receives installer paths/URLs/tokens.
 */

import { shell } from "electron";
import electronUpdater from "electron-updater";
import { err, ok, type Result } from "@shared/ipc/result.js";
import type {
  ReleaseNotesOpened,
  UpdateCancelled,
  UpdateRestarting,
  UpdateStarted,
  UpdateStatus,
} from "@shared/schemas/updater.js";
import { log } from "../logger/index.js";
import { preferencesStore } from "../preferences/store.js";
import { setSilentCheckActive } from "./auto-check-state.js";
import { errorStatus, publicUpdateError } from "./sanitize.js";
import {
  canRestartForUpdate,
  isUpdateRestartInProgress,
  prepareForUpdateRestart,
} from "./safeRestart.js";
import { currentVersion, getCurrentStatus, setStatus } from "./statusCache.js";

const { autoUpdater, CancellationToken } = electronUpdater;

let downloadInFlight: InstanceType<typeof CancellationToken> | null = null;

// TODO(release-track): replace with the real release-notes URL once hosting
// lands. Built in main; the renderer never constructs updater URLs.
const RELEASE_NOTES_URL = "https://vex.example/releases";

export async function getStatus(): Promise<Result<UpdateStatus>> {
  return ok(getCurrentStatus());
}

export async function checkNow(
  correlationId: string,
): Promise<Result<UpdateStatus>> {
  try {
    // `checkForUpdates()` resolves null when no feed/update; the autoUpdater
    // events fired during the check have already updated the status cache.
    await autoUpdater.checkForUpdates();
    void preferencesStore
      .update({ updater: { lastCheckedAt: new Date().toISOString() } })
      .catch((cause) =>
        log.warn("[updates] failed to persist updater.lastCheckedAt", cause),
      );
    return ok(getCurrentStatus());
  } catch (error) {
    log.warn(`[updates] checkForUpdates failed correlationId=${correlationId}`);
    setStatus(errorStatus(error, currentVersion()));
    return err(publicUpdateError("update.check_failed", correlationId));
  }
}

/**
 * Ambient (auto) check used by the start/focus scheduler. Unlike `checkNow` it
 * NEVER surfaces an error: a failure (e.g. no feed configured yet) is swallowed
 * (logged), and the updater `error` event is suppressed for its duration via
 * the silent-check flag. The update-available / not-available events still
 * drive the status cache, so a REAL update still raises the banner. Returns
 * true when a check completed, false on failure.
 */
export async function silentCheck(): Promise<boolean> {
  const priorStatus = getCurrentStatus();
  setSilentCheckActive(true);
  try {
    await autoUpdater.checkForUpdates();
    void preferencesStore
      .update({ updater: { lastCheckedAt: new Date().toISOString() } })
      .catch((cause) =>
        log.warn("[updates] failed to persist updater.lastCheckedAt", cause),
      );
    return true;
  } catch {
    log.info("[updates] ambient auto-check failed (swallowed)");
    // The `checking-for-update` event already flipped status to `checking`,
    // and the suppressed `error` left it there. Restore the prior quiet status
    // so future ambient checks aren't disabled (checking is non-quiet) — but
    // only if still `checking`, to avoid clobbering a real available/current
    // event that may have arrived first.
    if (getCurrentStatus().kind === "checking") {
      setStatus(priorStatus);
    }
    return false;
  } finally {
    setSilentCheckActive(false);
  }
}

export async function startUpdateNow(
  correlationId: string,
): Promise<Result<UpdateStarted>> {
  // Idempotent: a download already running is a successful start.
  if (downloadInFlight !== null) return ok({ started: true });

  const status = getCurrentStatus();
  if (status.kind !== "available") {
    return err(
      publicUpdateError(
        "update.apply_failed",
        correlationId,
        "No update is available to download.",
      ),
    );
  }

  const gate = await canRestartForUpdate();
  if (!gate.ok) {
    setStatus({
      kind: "blockedByOperation",
      currentVersion: currentVersion(),
      latestVersion: status.latestVersion,
      reason: gate.message,
    });
    return err(
      publicUpdateError("update.apply_failed", correlationId, gate.message),
    );
  }

  try {
    const token = new CancellationToken();
    downloadInFlight = token;
    setStatus({
      kind: "downloading",
      currentVersion: currentVersion(),
      latestVersion: status.latestVersion,
      percent: 0,
    });
    // Fire-and-forget: the IPC ack is non-blocking; progress + completion
    // arrive via the autoUpdater event stream. The token ref keeps the
    // operation cancellable and alive; both settle paths clear it so a later
    // check -> download (e.g. a newer version after the user defers a restart)
    // is not blocked by a permanently-stuck in-flight token.
    void autoUpdater
      .downloadUpdate(token)
      .then(() => {
        if (downloadInFlight === token) downloadInFlight = null;
      })
      .catch((error: unknown) => {
        if (downloadInFlight === token) {
          downloadInFlight = null;
          log.warn(
            `[updates] downloadUpdate failed correlationId=${correlationId}`,
          );
          setStatus(errorStatus(error, currentVersion()));
        }
      });
    return ok({ started: true });
  } catch (error) {
    downloadInFlight = null;
    setStatus(errorStatus(error, currentVersion()));
    return err(publicUpdateError("update.download_failed", correlationId));
  }
}

export async function cancelDownload(): Promise<Result<UpdateCancelled>> {
  downloadInFlight?.cancel();
  downloadInFlight = null;
  const status = getCurrentStatus();
  if (status.kind === "downloading") {
    setStatus({
      kind: "available",
      currentVersion: currentVersion(),
      latestVersion: status.latestVersion,
      severity: "normal",
    });
  }
  return ok({ cancelled: true });
}

export async function restartAndInstallNow(
  correlationId: string,
): Promise<Result<UpdateRestarting>> {
  // Idempotent under double-click / hostile renderer: a restart already
  // underway (or `installing`) is a successful no-op.
  if (isUpdateRestartInProgress()) return ok({ restarting: true });

  const status = getCurrentStatus();
  if (status.kind === "installing") return ok({ restarting: true });
  if (status.kind !== "downloaded") {
    return err(
      publicUpdateError(
        "update.apply_failed",
        correlationId,
        "No downloaded update is ready to install.",
      ),
    );
  }

  const gate = await canRestartForUpdate();
  if (!gate.ok) {
    setStatus({
      kind: "blockedByOperation",
      currentVersion: currentVersion(),
      latestVersion: status.latestVersion,
      reason: gate.message,
    });
    return err(
      publicUpdateError("update.apply_failed", correlationId, gate.message),
    );
  }

  setStatus({
    kind: "installing",
    currentVersion: currentVersion(),
    latestVersion: status.latestVersion,
  });
  prepareForUpdateRestart();
  // Windows: true => silent installer after explicit Vex UI consent; second
  // arg re-runs the app after install where supported.
  autoUpdater.quitAndInstall(process.platform === "win32", true);
  return ok({ restarting: true });
}

export async function openReleaseNotes(
  correlationId: string,
): Promise<Result<ReleaseNotesOpened>> {
  try {
    await shell.openExternal(RELEASE_NOTES_URL);
    return ok({ opened: true });
  } catch {
    log.warn(`[updates] openExternal failed correlationId=${correlationId}`);
    return err(
      publicUpdateError(
        "update.check_failed",
        correlationId,
        "Couldn't open the release notes page.",
      ),
    );
  }
}

/** Test-only: reset module state. */
export function __resetUpdateActionsForTests(): void {
  downloadInFlight = null;
}
