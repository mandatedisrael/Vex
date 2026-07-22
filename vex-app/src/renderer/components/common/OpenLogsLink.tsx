import type { JSX } from "react";
import { cn } from "../../lib/utils.js";

interface OpenLogsLinkProps {
  readonly className?: string;
}

export function OpenLogsLink({ className }: OpenLogsLinkProps): JSX.Element {
  return (
    <button
      type="button"
      data-vex-open-logs
      onClick={() => {
        void window.vex.support.openLogsFolder().catch(() => undefined);
      }}
      className={cn(
        // Token-driven, not hardcoded accent: on the cobalt continuum the
        // [data-vex-gate] scope re-projects --color-primary/--color-ring to
        // paper (an accent link/ring would vanish on the plate — A2 review
        // finding); on ink scopes both resolve to the cobalt accent.
        "self-start font-mono text-[11px] text-[var(--color-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
        className,
      )}
    >
      Open logs folder
    </button>
  );
}
