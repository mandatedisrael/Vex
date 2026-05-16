/**
 * Branch: noop — schema is already up to date, nothing to apply. The
 * orchestrator's auto-advance effect transitions to the wizard after
 * `NOOP_AUTO_ADVANCE_MS`; this body is a confirmation flash, not
 * content the user needs to read in detail (codex plan v2).
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";

export function NoopBody(): JSX.Element {
  return (
    <StatusTile
      tone="muted"
      icon={<HugeiconsIcon icon={CheckmarkCircle01Icon} size={20} aria-hidden />}
      title="Schema already up to date"
      detail="Advancing to the setup wizard…"
    />
  );
}
