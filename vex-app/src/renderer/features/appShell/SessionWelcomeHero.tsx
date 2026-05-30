/**
 * Welcome hero + trust badges (puzzle 04 phase 7 extract).
 *
 * Pure presentation: no session state, no draft state, no composer
 * coupling. Lifted from `SessionPanel.tsx` so the parent file stays
 * orchestration-only and under the 350-LOC budget.
 */

import type { JSX } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  DatabaseLightningIcon,
  Shield02Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { DotmHex3 } from "../../components/ui/dotm-hex-3.js";

interface TrustBadge {
  readonly label: string;
  readonly icon: IconSvgElement;
}

const TRUST_BADGES: ReadonlyArray<TrustBadge> = [
  { label: "Local-first", icon: DatabaseLightningIcon },
  { label: "Private by default", icon: Shield02Icon },
  { label: "You stay in control", icon: SparklesIcon },
];

export function SessionWelcomeHero(): JSX.Element {
  return (
    <>
      <div className="mb-8 flex items-center gap-3 text-[#6f91ff]">
        <DotmHex3
          size={28}
          dotSize={4}
          color="#3275f8"
          ariaLabel="Vex runtime"
          bloom
          halo={0.45}
        />
        <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#8da5ff]">
          Welcome to Vex
        </span>
      </div>

      <h1 className="max-w-[680px] text-4xl font-semibold leading-[1.08] tracking-normal text-foreground sm:text-5xl">
        Your chain. Your rules.
        <span className="block text-[#4d72ff]">I execute.</span>
      </h1>

      <p className="mt-5 max-w-[520px] text-base leading-7 text-[var(--color-text-secondary)]">
        Vex is your local crypto runtime for autonomous on-chain
        execution. You decide the goal, I handle the execution.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {TRUST_BADGES.map((badge) => (
          <span
            key={badge.label}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-white/[0.06] px-2.5 text-xs text-[var(--color-text-secondary)]"
          >
            <HugeiconsIcon
              icon={badge.icon}
              size={15}
              aria-hidden
              className="text-[#6f91ff]"
            />
            {badge.label}
          </span>
        ))}
      </div>
    </>
  );
}
