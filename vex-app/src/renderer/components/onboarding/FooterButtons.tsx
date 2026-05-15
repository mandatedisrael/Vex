/**
 * Panel footer buttons. ContinueButton replaces RecheckButton when the
 * branch is A (Docker ready) so the user has exactly one CTA to act on
 * per state. Both share the iOS-glass styling tied to
 * `--vex-onboarding-accent` so they read as a single design system.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../lib/utils.js";

interface ContinueButtonProps {
  readonly onClick: () => void;
}

export function ContinueButton({ onClick }: ContinueButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border border-white/[0.16] bg-[var(--vex-onboarding-accent)]/85 px-5 py-2.5 font-mono text-xs uppercase tracking-[0.22em] text-white backdrop-blur-md",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_8px_28px_rgba(50,117,248,0.28)]",
        "hover:bg-[var(--vex-onboarding-accent)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_12px_40px_rgba(50,117,248,0.42)]",
        "active:scale-[0.98] active:duration-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
        "transition-all duration-300 ease-out",
      )}
    >
      Continue
      <HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden />
    </button>
  );
}

interface RecheckButtonProps {
  readonly onClick: () => void;
  readonly disabled: boolean;
}

export function RecheckButton({
  onClick,
  disabled,
}: RecheckButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-white/[0.05] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)] backdrop-blur-md",
        "hover:border-white/[0.2] hover:bg-white/[0.1] hover:text-[var(--color-text-primary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "transition-colors duration-150",
      )}
    >
      <HugeiconsIcon icon={Refresh01Icon} size={12} aria-hidden />
      Recheck
    </button>
  );
}
