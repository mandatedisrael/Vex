/**
 * Branch A — engine + daemon running. The orchestrator's footer flips
 * the Recheck button to a Continue button so this body only needs the
 * "ready" status tile.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import type { DockerStatus } from "@shared/schemas/docker.js";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";

interface ReadyBodyProps {
  readonly status: DockerStatus | null;
}

export function ReadyBody({ status }: ReadyBodyProps): JSX.Element {
  const engine =
    status?.engine.present && status.engine.version
      ? `Engine ${status.engine.version}`
      : "Engine detected";
  const compose =
    status?.compose.present && status.compose.version
      ? `Compose ${status.compose.version}`
      : "Compose plugin present";
  const daemon = status?.daemon.running ? "Daemon up" : "Daemon idle";
  return (
    <StatusTile
      tone="success"
      icon={<HugeiconsIcon icon={CheckmarkCircle01Icon} size={20} aria-hidden />}
      title="Docker is ready"
      detail={`${engine} · ${daemon} · ${compose}`}
    />
  );
}
