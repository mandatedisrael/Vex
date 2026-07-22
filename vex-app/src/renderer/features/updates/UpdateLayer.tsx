/**
 * Global update layer (M13) — mounted once at the app root, above the view
 * switch, so a "new update available" prompt can appear over any screen.
 *
 * Owns the live status subscription, the renderer-local per-version "Later"
 * snooze, the error-toast dismissal, and the two-step + blocked-recovery
 * action wiring; renders the bottom-right `UpdateToast`. Defensive: a no-op
 * when the updater bridge is absent (plain dev / no feed / isolated renderer
 * tests that don't stub `window.vex.updater`).
 *
 * "Later" is a renderer-local, per-version, in-memory snooze — it only hides
 * the toast for the CURRENT `latestVersion` and resets on restart; it does
 * NOT touch preferences. A newer version still surfaces because
 * `main/updates/autoCheck.ts` now runs its ambient check from `available`
 * too, so the snoozed-version comparison below naturally stops matching once
 * the feed reports a newer release.
 */

import { useEffect, useRef, useState, type JSX } from "react";
import type { UpdateStatus } from "@shared/schemas/updater.js";
import {
  openReleaseNotes,
  useCancelDownload,
  useCheckForUpdates,
  useRestartAndInstall,
  useStartUpdate,
  useUpdateStatus,
  useUpdaterLiveSync,
} from "../../lib/api/updates.js";
import { isToastKind, UpdateToast } from "./UpdateToast.js";
import { UPDATER_PREVIEW_ENABLED, UpdaterPreview } from "./UpdaterPreview.js";

export function UpdateLayer(): JSX.Element | null {
  // Diagnostic toast viewer (VITE_VEX_UPDATER_PREVIEW=1, dev builds only):
  // replaces the live layer with local mock statuses — no bridge, no IPC.
  if (UPDATER_PREVIEW_ENABLED) return <UpdaterPreview />;
  if (typeof window === "undefined" || !window.vex?.updater) return null;
  return <UpdateLayerInner />;
}

function UpdateLayerInner(): JSX.Element | null {
  useUpdaterLiveSync();
  const statusQuery = useUpdateStatus();
  const [snoozedVersion, setSnoozedVersion] = useState<string | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const previousKindRef = useRef<UpdateStatus["kind"] | null>(null);

  const checkMut = useCheckForUpdates();
  const startMut = useStartUpdate();
  const cancelMut = useCancelDownload();
  const restartMut = useRestartAndInstall();
  const busy =
    checkMut.isPending ||
    startMut.isPending ||
    cancelMut.isPending ||
    restartMut.isPending;

  const status: UpdateStatus | null = statusQuery.data?.ok
    ? statusQuery.data.data
    : null;

  useEffect(() => {
    const previousKind = previousKindRef.current;
    previousKindRef.current = status?.kind ?? null;
    // A freshly-observed error (arriving from a non-error kind) clears an
    // earlier dismissal, so a NEW failure still reaches the user even though
    // `safeUpdateErrorMessage` always returns the same redacted text (so
    // message equality can't distinguish a new failure from an old one).
    if (status?.kind === "error" && previousKind !== "error") {
      setErrorDismissed(false);
    }
  }, [status?.kind]);

  if (status === null || !isToastKind(status)) return null;
  if (status.kind === "error" && errorDismissed) return null;
  if (
    (status.kind === "available" || status.kind === "downloaded") &&
    snoozedVersion === status.latestVersion
  ) {
    return null;
  }

  const handleLater = (): void => {
    if (status.kind === "available" || status.kind === "downloaded") {
      setSnoozedVersion(status.latestVersion);
    }
  };

  const handleTryAgain = (): void => {
    if (status.kind === "error") {
      checkMut.mutate();
      return;
    }
    if (status.kind === "blockedByOperation") {
      if (status.blockedAction === "download") startMut.mutate();
      else restartMut.mutate();
    }
  };

  return (
    <UpdateToast
      status={status}
      busy={busy}
      onLater={handleLater}
      onUpdateNow={() => startMut.mutate()}
      onCancel={() => cancelMut.mutate()}
      onRestart={() => restartMut.mutate()}
      onTryAgain={handleTryAgain}
      onReleaseNotes={openReleaseNotes}
      onDismissError={() => setErrorDismissed(true)}
    />
  );
}
