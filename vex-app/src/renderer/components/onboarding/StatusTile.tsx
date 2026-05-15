/**
 * Status tile primitive — the dominant visual element in each
 * BootstrapPanel branch body. Carries a tone token (success / warning /
 * info / danger / muted) that colors the border + background + leading
 * icon. Title is the accessible-name; detail is a secondary description.
 *
 * Kept in `bootstrap/` because it's specific to the BootstrapPanel
 * surface; promote to renderer-level `components/ui/` when a second
 * feature needs the same primitive.
 */

import { type ReactNode } from "react";
import { cn } from "../../lib/utils.js";

export type StatusTone = "success" | "warning" | "info" | "danger" | "muted";

interface StatusTileProps {
  readonly tone: StatusTone;
  readonly icon: ReactNode;
  readonly title: string;
  readonly detail?: string | null;
}

const toneChrome: Record<StatusTone, string> = {
  success:
    "border-[color-mix(in_oklab,var(--color-success)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_10%,transparent)] text-[var(--color-success)]",
  warning:
    "border-[color-mix(in_oklab,var(--color-warning)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)] text-[var(--color-warning)]",
  info: "border-[color-mix(in_oklab,var(--vex-onboarding-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--vex-onboarding-accent)_10%,transparent)] text-[var(--vex-onboarding-accent)]",
  danger:
    "border-[color-mix(in_oklab,var(--color-danger)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] text-[var(--color-danger)]",
  muted:
    "border-white/[0.1] bg-white/[0.04] text-[var(--color-text-secondary)]",
};

export function StatusTile({
  tone,
  icon,
  title,
  detail,
}: StatusTileProps): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        toneChrome[tone],
      )}
    >
      <span aria-hidden className="mt-0.5 shrink-0">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          {title}
        </span>
        {detail ? (
          <span className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}
