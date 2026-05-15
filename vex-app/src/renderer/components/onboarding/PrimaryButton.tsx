/**
 * Primary CTA button used by branch bodies (Start Docker, Download
 * installer, Try Start Docker Desktop). Two variants:
 *   - "primary"  — full-width, solid accent blue, the recommended path
 *   - "ghost"    — subordinate, frosted glass, smaller weight
 *
 * Continue + Recheck buttons live in BootstrapPanel.tsx itself (single
 * use, footer-only); this primitive is only for body-level actions.
 */

import type { ComponentProps, ElementType } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "../../lib/utils.js";

type HugeiconIcon = ComponentProps<typeof HugeiconsIcon>["icon"];

interface PrimaryButtonProps {
  readonly icon: HugeiconIcon;
  readonly label: string;
  readonly disabled?: boolean;
  readonly variant?: "primary" | "ghost";
  readonly onClick: () => void;
}

export function PrimaryButton({
  icon,
  label,
  disabled,
  variant = "primary",
  onClick,
}: PrimaryButtonProps): JSX.Element {
  if (variant === "ghost") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center gap-2 self-start rounded-xl border border-white/[0.12] bg-white/[0.05] px-4 py-2.5 font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-text-primary)] backdrop-blur-md",
          "hover:border-white/[0.2] hover:bg-white/[0.1]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
          "active:scale-[0.98] transition-all duration-150",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        <HugeiconsIcon icon={icon} size={14} aria-hidden />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.16] bg-[var(--vex-onboarding-accent)]/85 px-4 py-3 font-mono text-sm uppercase tracking-[0.22em] text-white backdrop-blur-md",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_40px_rgba(50,117,248,0.28)]",
        "hover:bg-[var(--vex-onboarding-accent)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_14px_50px_rgba(50,117,248,0.42)]",
        "active:scale-[0.98] active:duration-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "transition-all duration-300 ease-out",
      )}
    >
      <HugeiconsIcon icon={icon} size={16} aria-hidden />
      {label}
    </button>
  );
}
