/**
 * Branch B — engine installed, daemon stopped. Platform-branched copy:
 *
 *   Linux:  the main-process `useDockerStart()` only attempts the
 *           user-mode Docker Desktop unit (`systemctl --user start
 *           docker-desktop`), it never runs `sudo systemctl start
 *           docker`. So the prominent path on Linux is the sudo command,
 *           with "Try Start Docker Desktop" as a subordinate ghost
 *           button for users running user-mode Docker Desktop.
 *
 *   macOS / Windows:  the standard launch flow — Vex calls the system
 *                     "open" handler which boots Docker Desktop.
 *
 *   unknown platform: generic fallback copy, no docs link.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";
import { PrimaryButton } from "../../../../components/onboarding/PrimaryButton.js";
import { DocsLink } from "../../../../components/onboarding/DocsLink.js";
import { OpenLogsLink } from "../../../../components/common/OpenLogsLink.js";
import {
  DOCKER_DESKTOP_MAC_URL,
  DOCKER_DESKTOP_WIN_URL,
  DOCKER_ENGINE_LINUX_URL,
} from "../constants.js";

interface DaemonStoppedBodyProps {
  readonly platform: string | null;
  readonly starting: boolean;
  readonly startMessage: string | null;
  readonly onStart: () => void;
}

export function DaemonStoppedBody({
  platform,
  starting,
  startMessage,
  onStart,
}: DaemonStoppedBodyProps): JSX.Element {
  if (platform === "linux") {
    return (
      <div className="flex flex-col gap-4">
        <StatusTile
          tone="warning"
          icon={<HugeiconsIcon icon={PauseIcon} size={20} aria-hidden />}
          title="Docker daemon is not running"
          detail="On Linux the Docker daemon is a system service and requires sudo to start."
        />

        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-secondary)]">
            Run this in a terminal:
          </p>
          <pre className="overflow-auto rounded-lg border border-white/[0.08] bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-[var(--color-text-primary)]">
            <code>sudo systemctl start docker</code>
          </pre>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Then click Recheck below.
          </p>
        </div>

        <PrimaryButton
          icon={PlayIcon}
          label={starting ? "Starting…" : "Try Start Docker Desktop"}
          variant="ghost"
          disabled={starting}
          onClick={onStart}
        />
        {startMessage ? (
          <p className="text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
            {startMessage}
          </p>
        ) : null}

        <DocsLink href={DOCKER_ENGINE_LINUX_URL} label="View Docker Engine docs" />
        <OpenLogsLink />
      </div>
    );
  }

  const docsUrl =
    platform === "darwin"
      ? DOCKER_DESKTOP_MAC_URL
      : platform === "win32"
        ? DOCKER_DESKTOP_WIN_URL
        : null;
  const isDesktopPlatform = platform === "darwin" || platform === "win32";
  const tileTitle = isDesktopPlatform
    ? "Docker installed, daemon stopped"
    : "Docker daemon is not running";
  const tileDetail = isDesktopPlatform
    ? "macOS may need ~30 seconds before the daemon answers."
    : "Start Docker from your system tools, then click Recheck below.";

  return (
    <div className="flex flex-col gap-4">
      <StatusTile
        tone="warning"
        icon={<HugeiconsIcon icon={PauseIcon} size={20} aria-hidden />}
        title={tileTitle}
        detail={tileDetail}
      />

      {isDesktopPlatform ? (
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-xs leading-relaxed text-[var(--color-text-secondary)]">
          <li>Click Start Docker (launches Docker Desktop).</li>
          <li>Wait ~30s for the daemon to answer.</li>
          <li>Click Recheck below.</li>
        </ol>
      ) : null}

      <PrimaryButton
        icon={PlayIcon}
        label={starting ? "Starting…" : "Start Docker"}
        disabled={starting}
        onClick={onStart}
      />
      {startMessage ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
          {startMessage}
        </p>
      ) : null}

      {docsUrl ? <DocsLink href={docsUrl} label="View Docker Desktop docs" /> : null}
      <OpenLogsLink />
    </div>
  );
}
