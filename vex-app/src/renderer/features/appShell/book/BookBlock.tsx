/**
 * One BOOK panel block — a TILE (raised card) with a mono instrument header.
 * Shared chrome for MOVES / RUNTIME / SESSION / POSITION. Tonal layering, not
 * thick borders: surface-2 over the panel's surface-1, hairline edge, no
 * resting glow. One tile (POSITION) is the `hero`; the rest defer to it — the
 * prominence comes from content, never equal-weight competition.
 */

import type { JSX, ReactNode } from "react";
import { cn } from "../../../lib/utils.js";

export function BookBlock({
  title,
  trailing,
  hero = false,
  children,
}: {
  readonly title: string;
  /** Optional right-aligned header datum (e.g. a count or total). */
  readonly trailing?: ReactNode;
  /** The single dominant tile (POSITION): a slightly stronger hairline. */
  readonly hero?: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section
      className={cn(
        "rounded-lg border bg-[var(--vex-surface-2)] px-4 py-3",
        hero ? "border-[var(--vex-line-strong)]" : "border-[var(--vex-line)]",
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--vex-text-3)]">
          {title}
        </h3>
        {trailing !== undefined ? (
          <span className="font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
            {trailing}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
