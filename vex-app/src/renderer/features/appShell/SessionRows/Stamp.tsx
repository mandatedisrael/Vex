/** NOTARY exception stamp — metadata appears ONLY when it deviates from
 * the default (silence-by-default law). Tones map to the shell palette;
 * fill is reserved for danger (none here yet). */

import type { JSX } from "react";
import { cn } from "../../../lib/utils.js";

export function Stamp({
  tone,
  children,
}: {
  readonly tone: "accent" | "warn";
  readonly children: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
        tone === "accent"
          ? "border-[color-mix(in_oklab,var(--vex-accent)_40%,transparent)] text-[var(--vex-accent-text)]"
          : "border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] text-warning",
      )}
    >
      {children}
    </span>
  );
}
