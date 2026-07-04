/** NOTARY exception stamp — metadata appears ONLY when it deviates from
 * the default (silence-by-default law). Tones map to the shell palette;
 * fill is reserved for danger (none here yet). On the selection beam
 * (`.vex-select-beam`) the accent/amber inks sink into the gradient, so
 * `onBeam` flips the stamp to the beam's contrast ink (white on cobalt, ink
 * on the Robinhood lime beam) via `--vex-accent-contrast`. */

import type { JSX } from "react";
import { cn } from "../../../lib/utils.js";

export function Stamp({
  tone,
  onBeam = false,
  children,
}: {
  readonly tone: "accent" | "warn";
  /** Host row is painted with the cobalt selection beam. */
  readonly onBeam?: boolean;
  readonly children: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.14em]",
        onBeam
          ? "border-[color-mix(in_oklab,var(--vex-accent-contrast)_45%,transparent)] text-[color-mix(in_oklab,var(--vex-accent-contrast)_90%,transparent)]"
          : tone === "accent"
            ? "border-[color-mix(in_oklab,var(--vex-accent)_40%,transparent)] text-[var(--vex-accent-text)]"
            : "border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] text-warning",
      )}
    >
      {children}
    </span>
  );
}
