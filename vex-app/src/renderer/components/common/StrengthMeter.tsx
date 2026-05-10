/**
 * Visual password-strength feedback. Length-tier only — does NOT block
 * form submission (vex-shell parity hard rule = 8 char minimum, the
 * Zod schema enforces that). Per codex turn 5 answer #3 the hint is
 * factual: "8 characters minimum. 12+ recommended." We do NOT imply
 * Phase 2 KDF / encryption properties that have not shipped yet.
 *
 * Tiers:
 *   < 8 chars  → "Too short" (danger)
 *   8-11       → "OK" (warning)
 *   12-15      → "Strong" (success)
 *   ≥ 16       → "Excellent" (success, full bar)
 */

import type { JSX } from "react";
import { cn } from "../../lib/utils.js";

export interface StrengthMeterProps {
  readonly value: string;
  readonly className?: string;
  /** Stable id so callers can wire `aria-describedby` from the related input. */
  readonly id?: string;
}

interface Tier {
  readonly label: string;
  readonly fillFraction: number;
  readonly color: string;
}

function tierFor(length: number): Tier {
  if (length < 8) {
    return { label: "Too short", fillFraction: 0.15, color: "bg-destructive" };
  }
  if (length < 12) {
    return { label: "OK", fillFraction: 0.5, color: "bg-warning" };
  }
  if (length < 16) {
    return { label: "Strong", fillFraction: 0.8, color: "bg-success" };
  }
  return { label: "Excellent", fillFraction: 1, color: "bg-success" };
}

export function StrengthMeter({
  value,
  className,
  id,
}: StrengthMeterProps): JSX.Element {
  const tier = tierFor(value.length);
  const widthClass =
    tier.fillFraction === 1
      ? "w-full"
      : tier.fillFraction === 0.8
        ? "w-4/5"
        : tier.fillFraction === 0.5
          ? "w-1/2"
          : "w-[15%]";
  return (
    <div id={id} className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          8 characters minimum. 12+ recommended.
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {tier.label}
        </span>
      </div>
      <div
        aria-hidden
        className="h-1 w-full overflow-hidden rounded-full bg-popover"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-200 ease-out",
            tier.color,
            widthClass
          )}
        />
      </div>
    </div>
  );
}
