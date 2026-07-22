/**
 * Single probe row on the System Check card (cobalt continuum).
 *
 * Layout (left → right): glyph · label + mono detail · status word.
 * While a probe is loading the status cell shows the inline VexLoader
 * ring (paper tone — the pre-shell loader idiom) beside the pinned
 * "CHECKING…" text; once resolved it prints a colored mono WORD — no
 * stamp box, no press animation (state is color + words).
 *
 * The `data-step-status` attribute remains the stable selector across
 * refactors (e2e + unit tests rely on it). `badgeLabel` decouples the
 * visible word from the semantic `StepStatus` so screens can surface
 * contextual wording (READY / SETUP) without losing the underlying
 * state machine value. Word texts are pinned by tests:
 * CHECKING… / OK / WARN / FAIL.
 *
 * Note: the detail line is the only `text-[11px]` element in the row —
 * a test pins that invariant to detect a missing detail span.
 */

import { type ReactNode } from "react";

import { VexLoader } from "../../components/ui/vex-loader.js";
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

/** Status word ink — colored word grammar, no boxes, no fills. */
const wordInk: Record<Exclude<StepStatus, "loading">, string> = {
  ok: "text-[var(--color-success)]",
  warn: "text-[var(--color-warning)]",
  fail: "text-[var(--color-danger)]",
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
      className="flex items-center gap-3 border-t border-white/[0.10] py-4 first:border-t-0"
      data-step-status={status}
    >
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center text-[rgba(243,244,247,0.78)]"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
          {label}
        </span>
        {detail ? (
          <span className="truncate font-mono text-[11px] text-[rgba(243,244,247,0.58)]">
            {detail}
          </span>
        ) : null}
      </div>
      {status === "loading" ? (
        <span className="flex shrink-0 items-center gap-2">
          <VexLoader size={16} stroke={2} tone="paper" label="Checking" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgba(243,244,247,0.78)]">
            {labelText}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            "shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.18em]",
            wordInk[status],
          )}
        >
          {labelText}
        </span>
      )}
    </li>
  );
}
