/**
 * Branch: error.port_collision — Compose detected a port already in use
 * (typical: Postgres :5432 already running on host, or a stale Vex
 * stack from a previous install holding :27432). Generic conflicts retain
 * manual guidance; inspect-authorized previous Vex containers get an explicit
 * stop-only action whose success automatically retries compose startup.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";
import { PrimaryButton } from "../../../../components/onboarding/PrimaryButton.js";
import { OpenLogsLink } from "../../../../components/common/OpenLogsLink.js";

interface PortCollisionBodyProps {
  readonly message: string;
  readonly previousInstallHoldingPorts: boolean;
  readonly stoppingPreviousInstall: boolean;
  readonly stopPreviousInstallError: string | null;
  readonly onStopPreviousInstall: () => void;
  readonly onRetry: () => void;
}

export function PortCollisionBody({
  message,
  previousInstallHoldingPorts,
  stoppingPreviousInstall,
  stopPreviousInstallError,
  onStopPreviousInstall,
  onRetry,
}: PortCollisionBodyProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <StatusTile
        tone="danger"
        icon={<HugeiconsIcon icon={Cancel01Icon} size={20} aria-hidden />}
        title="Port already in use"
        detail={message}
      />
      {previousInstallHoldingPorts ? (
        <>
          <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            Containers from a previous Vex installation are holding the ports.
            Vex will stop only the inspected containers publishing the required
            ports.
          </p>
          {stopPreviousInstallError !== null ? (
            <p className="text-xs text-[var(--color-danger)]" role="alert">
              {stopPreviousInstallError}
            </p>
          ) : null}
          <PrimaryButton
            icon={Cancel01Icon}
            label={
              stoppingPreviousInstall
                ? "Stopping previous Vex services…"
                : "Stop previous Vex services"
            }
            disabled={stoppingPreviousInstall}
            variant="danger"
            onClick={onStopPreviousInstall}
          />
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            Stop the conflicting process (another Postgres or Vex install may be
            holding the port) and click Try again. Vex needs free local ports for
            the bundled Postgres + embeddings runtime.
          </p>
          <PrimaryButton
            icon={Refresh01Icon}
            label="Try again"
            onClick={onRetry}
          />
        </>
      )}
      <OpenLogsLink />
    </div>
  );
}
