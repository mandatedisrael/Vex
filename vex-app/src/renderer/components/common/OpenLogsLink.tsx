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
        "self-start font-mono text-[11px] text-[color-mix(in_oklab,var(--vex-onboarding-accent)_55%,white)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
        className,
      )}
    >
      Open logs folder
    </button>
  );
}
