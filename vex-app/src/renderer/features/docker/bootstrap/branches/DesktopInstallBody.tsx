/**
 * Branch C-desktop — mac/win, engine missing. Vex offers an in-app
 * installer download via the LicenseNotice modal (the orchestrator owns
 * the modal); this body provides the numbered install steps + primary
 * Download CTA + docs link.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";
import { PrimaryButton } from "../../../../components/onboarding/PrimaryButton.js";
import { DocsLink } from "../../../../components/onboarding/DocsLink.js";
import { OpenLogsLink } from "../../../../components/common/OpenLogsLink.js";
import {
  DOCKER_DESKTOP_MAC_URL,
  DOCKER_DESKTOP_WIN_URL,
} from "../constants.js";

interface DesktopInstallBodyProps {
  readonly platform: string | null;
  readonly installing: boolean;
  readonly onInstall: () => void;
}

export function DesktopInstallBody({
  platform,
  installing,
  onInstall,
}: DesktopInstallBodyProps): JSX.Element {
  const platformLabel =
    platform === "darwin"
      ? "macOS"
      : platform === "win32"
        ? "Windows"
        : "your system";
  const docsUrl =
    platform === "darwin"
      ? DOCKER_DESKTOP_MAC_URL
      : platform === "win32"
        ? DOCKER_DESKTOP_WIN_URL
        : null;

  return (
    <div className="flex flex-col gap-4">
      <StatusTile
        tone="info"
        icon={<HugeiconsIcon icon={Download01Icon} size={20} aria-hidden />}
        title="Docker CLI not found"
        detail={`Vex needs Docker Desktop on ${platformLabel}.`}
      />

      <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
        If Docker is installed, enable Docker Desktop&apos;s CLI symlinks
        (Settings → Advanced) or reinstall Docker Desktop, then click Recheck.
      </p>

      <ol className="flex list-decimal flex-col gap-1 pl-5 text-xs leading-relaxed text-[var(--color-text-secondary)]">
        <li>Click Download installer (Vex fetches the official build for you).</li>
        <li>Run the installer with admin privileges.</li>
        <li>Launch Docker Desktop.</li>
        <li>Click Recheck below.</li>
      </ol>

      <PrimaryButton
        icon={Download01Icon}
        label={installing ? "Downloading…" : "Download installer"}
        disabled={installing}
        onClick={onInstall}
      />

      {docsUrl ? (
        <DocsLink href={docsUrl} label="View official Docker Desktop docs" />
      ) : null}
      <OpenLogsLink />
    </div>
  );
}
