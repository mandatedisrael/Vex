/**
 * Single radio "card" for the New-session modal mode/permission grids
 * (extracted from `SessionCreator.tsx`). Purely presentational: the visible
 * card is a styled <label> wrapping a screen-reader-only native radio, so the
 * grids stay keyboard- and AT-navigable as real radio groups.
 */

import type { JSX } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "../../../lib/utils.js";

interface RadioCardProps {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly title: string;
  readonly description: string;
  readonly icon: IconSvgElement;
}

export function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  icon,
}: RadioCardProps): JSX.Element {
  return (
    <label
      className={cn(
        "flex min-h-[112px] cursor-pointer flex-col gap-2 rounded-lg border px-3 py-3 text-sm transition-colors",
        checked
          ? "border-[var(--vex-accent-border)] bg-[var(--vex-accent-fill-8)]"
          : "border-[var(--vex-line)] hover:bg-white/[0.03]",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center",
          checked ? "text-[var(--vex-accent-text)]" : "text-[var(--vex-text-3)]",
        )}
      >
        <HugeiconsIcon icon={icon} size={19} aria-hidden />
      </span>
      <span className="font-medium text-foreground">{title}</span>
      <span className="text-xs text-[var(--vex-text-2)]">
        {description}
      </span>
    </label>
  );
}
