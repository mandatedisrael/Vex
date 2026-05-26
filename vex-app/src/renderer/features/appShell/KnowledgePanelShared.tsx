/**
 * Shared presentational primitives for the Knowledge & Memory panel.
 *
 * Extracted from `KnowledgePanel.tsx` so each section module stays under the
 * 400-line budget. Panel-local — NOT a generic UI helper. Holds only the
 * primitives used by more than one section: the section/pill class constants,
 * the loading/error/empty states, and the date formatter.
 */

import type { JSX } from "react";

export const SECTION =
  "flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4";
export const PILL =
  "inline-flex items-center rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-secondary)]";

export function Loading({ label }: { readonly label: string }): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-[var(--color-text-secondary)]"
    >
      {label}
    </div>
  );
}

export function ErrorState({
  message,
}: {
  readonly message: string;
}): JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      {message}
    </div>
  );
}

export function Empty({ label }: { readonly label: string }): JSX.Element {
  return (
    <p className="px-1 py-2 text-xs text-[var(--color-text-muted)]">{label}</p>
  );
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
