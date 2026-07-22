/**
 * UPDATER PREVIEW — diagnostic toast viewer (owner request 2026-07-22,
 * sibling of the SetupTour): `VITE_VEX_UPDATER_PREVIEW=1` replaces the
 * live update layer with this local previewer so the bottom-right
 * `UpdateToast` can be seen in EVERY state without a real update feed.
 *
 * A small mono picker docks to the LEFT of the toast slot; each key
 * feeds `UpdateToast` a schema-valid mock status. Action handlers walk
 * the mock through realistic transitions locally ("Update now" →
 * downloading → downloaded, "Cancel" → available, "Try again" from a
 * block re-enters its step) — no IPC is ever called, main is never
 * touched, and release builds are made without the flag so this
 * component is unreachable in production.
 */

import { useState, type JSX } from "react";
import type { UpdateStatus } from "@shared/schemas/updater.js";
import {
  isToastKind,
  UpdateToast,
  type ToastableUpdateStatus,
} from "./UpdateToast.js";

export const UPDATER_PREVIEW_ENABLED =
  import.meta.env.VITE_VEX_UPDATER_PREVIEW === "1";

const CURRENT = "0.1.4";
const LATEST = "0.2.0";

/** Named fallback so lookups never need a non-null index assertion. */
const AVAILABLE_STATUS: UpdateStatus = {
  kind: "available",
  currentVersion: CURRENT,
  latestVersion: LATEST,
  severity: "normal",
  summary: "Chronos Gate — the rebuilt setup experience.",
};

const MOCKS: ReadonlyArray<{
  readonly key: string;
  readonly status: UpdateStatus;
}> = [
  { key: "available", status: AVAILABLE_STATUS },
  {
    key: "available·critical",
    status: {
      kind: "available",
      currentVersion: CURRENT,
      latestVersion: LATEST,
      severity: "critical",
      summary: "Security fix for approval gating.",
    },
  },
  {
    key: "downloading",
    status: {
      kind: "downloading",
      currentVersion: CURRENT,
      latestVersion: LATEST,
      percent: 42,
    },
  },
  {
    key: "downloaded",
    status: { kind: "downloaded", currentVersion: CURRENT, latestVersion: LATEST },
  },
  {
    key: "blocked·download",
    status: {
      kind: "blockedByOperation",
      currentVersion: CURRENT,
      latestVersion: LATEST,
      reason: "Docker setup is still running. Try again when it finishes.",
      blockedAction: "download",
      severity: "normal",
      wasDownloaded: false,
    },
  },
  {
    key: "blocked·install",
    status: {
      kind: "blockedByOperation",
      currentVersion: CURRENT,
      latestVersion: LATEST,
      reason: "A mission is still running. Finish or stop it, then restart.",
      blockedAction: "install",
      severity: "normal",
      wasDownloaded: true,
    },
  },
  {
    key: "error",
    status: {
      kind: "error",
      currentVersion: CURRENT,
      message: "The update could not be downloaded. Check your connection and try again.",
      retryable: true,
    },
  },
];

function mockFor(key: string): UpdateStatus {
  return MOCKS.find((m) => m.key === key)?.status ?? AVAILABLE_STATUS;
}

export function UpdaterPreview(): JSX.Element {
  const [activeKey, setActiveKey] = useState<string>("available");
  const [status, setStatus] = useState<UpdateStatus>(mockFor("available"));

  const pick = (key: string): void => {
    setActiveKey(key);
    setStatus(mockFor(key));
  };

  const toastable: ToastableUpdateStatus | null = isToastKind(status)
    ? status
    : null;

  return (
    <>
      <div
        data-vex-updater-preview
        className="fixed bottom-4 right-[21.5rem] z-[70] flex flex-col gap-1 rounded-lg border border-white/[0.16] bg-[rgba(8,11,24,0.85)] p-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[rgba(243,244,247,0.85)]"
      >
        <span className="px-1 text-[9px] text-[rgba(243,244,247,0.55)]">
          Updater preview
        </span>
        {MOCKS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => pick(m.key)}
            className={
              m.key === activeKey
                ? "rounded bg-white/[0.14] px-2 py-1 text-left text-[var(--color-text-primary)]"
                : "rounded px-2 py-1 text-left hover:bg-white/[0.08]"
            }
          >
            {m.key}
          </button>
        ))}
      </div>
      {toastable !== null ? (
        <UpdateToast
          status={toastable}
          busy={false}
          onLater={() => pick("available")}
          onUpdateNow={() =>
            setStatus({
              kind: "downloading",
              currentVersion: CURRENT,
              latestVersion: LATEST,
              percent: 42,
            })
          }
          onCancel={() => pick("available")}
          onRestart={() =>
            setStatus({
              kind: "downloaded",
              currentVersion: CURRENT,
              latestVersion: LATEST,
            })
          }
          onTryAgain={() =>
            setStatus(
              status.kind === "blockedByOperation" &&
                status.blockedAction === "install"
                ? mockFor("downloaded")
                : mockFor("downloading"),
            )
          }
          onReleaseNotes={() => undefined}
          onDismissError={() => pick("available")}
        />
      ) : null}
    </>
  );
}
