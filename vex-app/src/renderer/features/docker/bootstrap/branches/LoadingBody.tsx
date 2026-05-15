/**
 * Branch: loading — Docker probe hasn't returned data yet, OR engine is
 * missing and the platform health probe is still resolving. Either way
 * we render a gray spinner-style status tile and disable the footer
 * Recheck button (handled by the orchestrator).
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { HourglassIcon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";

export function LoadingBody(): JSX.Element {
  return (
    <StatusTile
      tone="muted"
      icon={
        <HugeiconsIcon
          icon={HourglassIcon}
          size={20}
          className="animate-pulse"
          aria-hidden
        />
      }
      title="Detecting Docker…"
      detail="Probing the Docker endpoint and platform. This should take a few seconds."
    />
  );
}
