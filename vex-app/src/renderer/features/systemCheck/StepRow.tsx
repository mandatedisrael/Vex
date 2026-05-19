/**
 * Single row in the System Check list.
 *
 * Layout (left → right): brand/glyph icon · label + detail · status badge.
 *
 * The `data-step-status` attribute remains the stable selector across
 * refactors (e2e + unit tests rely on it). `badgeLabel` decouples the
 * visible badge text from the semantic `StepStatus` so screens can
 * surface contextual wording (READY / SETUP / WARN) without losing the
 * underlying state machine value (codex round 7 SHOULD-FIX #6).
 */

import { type ReactNode } from "react";
import { cn } from "../../lib/utils.js";

export type StepStatus = "loading" | "ok" | "warn" | "fail";

interface StepRowProps {
  readonly label: string;
  readonly status: StepStatus;
  readonly detail: string | null;
  readonly icon: ReactNode;
  readonly badgeLabel?: string;
}

const defaultBadgeLabel: Record<StepStatus, string> = {
  loading: "CHECKING…",
  ok: "OK",
  warn: "WARN",
  fail: "FAIL",
};

/**
 * Per-status badge chrome — pill shape with iOS-glass depth (inset top
 * highlight + soft outer glow tinted by status color). Each variant
 * tunes border/bg/text against the same `--color-{success,warning,danger}`
 * palette so accessibility contrast stays consistent.
 */
const badgeChrome: Record<StepStatus, string> = {
  loading:
    "border-white/15 bg-white/[0.08] text-[var(--color-text-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]",
  ok: "border-[color-mix(in_oklab,var(--color-success)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_22%,transparent)] text-[var(--color-success)] shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_2px_10px_color-mix(in_oklab,var(--color-success)_30%,transparent)]",
  warn: "border-[color-mix(in_oklab,var(--color-warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_22%,transparent)] text-[var(--color-warning)] shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_2px_10px_color-mix(in_oklab,var(--color-warning)_30%,transparent)]",
  fail: "border-[color-mix(in_oklab,var(--color-danger)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-danger)_22%,transparent)] text-[var(--color-danger)] shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_2px_10px_color-mix(in_oklab,var(--color-danger)_30%,transparent)]",
};

const dotColor: Record<StepStatus, string> = {
  loading: "bg-[var(--color-text-secondary)]",
  ok: "bg-[var(--color-success)]",
  warn: "bg-[var(--color-warning)]",
  fail: "bg-[var(--color-danger)]",
};

export function StepRow({
  label,
  status,
  detail,
  icon,
  badgeLabel,
}: StepRowProps): JSX.Element {
  const labelText = badgeLabel ?? defaultBadgeLabel[status];
  return (
    <li
      className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] motion-cascade-row"
      data-step-status={status}
    >
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--color-text-primary)]"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
          {label}
        </span>
        {detail ? (
          <span className="truncate text-[11px] text-[var(--color-text-secondary)]">
            {detail}
          </span>
        ) : null}
      </div>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em]",
          badgeChrome[status]
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
            dotColor[status],
            status === "loading" ? "animate-pulse" : undefined
          )}
        />
        {labelText}
      </span>
    </li>
  );
}
