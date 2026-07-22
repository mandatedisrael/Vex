/**
 * Branch: error.cancelled — user clicked Cancel and the IPC returned
 * `internal.cancelled`. Calm informational state, not a failure red.
 */

import { Button } from "../../../../components/ui/button.js";
import { SetupStatusCard } from "../../../../components/onboarding/SetupStatusCard.js";

interface CancelledBodyProps {
  readonly onRetry: () => void;
}

export function CancelledBody({ onRetry }: CancelledBodyProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <SetupStatusCard
        tone="muted"
        word="Cancelled"
        title="Startup cancelled."
        detail="Startup was cancelled before onboarding continued. Try again to reconcile the local stack."
      />
      <Button size="lg" className="w-full" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
