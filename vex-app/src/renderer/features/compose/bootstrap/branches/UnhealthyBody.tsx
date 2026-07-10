/**
 * Branch: error.unhealthy — Compose came up but one of the containers
 * failed its health probe (e.g., Postgres started but won't accept
 * connections, or embeddings runtime didn't reach 200 OK on /health
 * within the probe budget). Usually a flake; retry resolves it.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";
import { PrimaryButton } from "../../../../components/onboarding/PrimaryButton.js";
import { OpenLogsLink } from "../../../../components/common/OpenLogsLink.js";

interface UnhealthyBodyProps {
  readonly message: string;
  readonly onRetry: () => void;
}

export function UnhealthyBody({
  message,
  onRetry,
}: UnhealthyBodyProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <StatusTile
        tone="warning"
        icon={<HugeiconsIcon icon={AlertCircleIcon} size={20} aria-hidden />}
        title="Service started but health probe failed"
        detail={message}
      />
      <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
        This usually clears after a short wait while the container
        warms up. Click Try again to re-probe the stack.
      </p>
      <PrimaryButton icon={Refresh01Icon} label="Try again" onClick={onRetry} />
      <OpenLogsLink />
    </div>
  );
}
