/**
 * HoverBorderGradient — animated rotating gradient border CTA primitive.
 *
 * Adapted from the Aceternity UI snippet supplied with the intro/splash
 * redesign brief. Three Vex-specific changes vs upstream:
 *   1. Default highlight resolves to var(--intro-accent, ...) so the splash
 *      gets electric blue (#3275F8) without polluting the global indigo palette.
 *   2. No `dark:` modifiers — Vex renderer is dark-only.
 *   3. Explicit reduced-motion guard via useReducedMotion (codex review):
 *      global `animation-duration: 0.01ms` does not cancel the JS interval that
 *      rotates the gradient, so we short-circuit when the user opts out.
 *
 * CSP: motion/react sets single-property inline styles (background, transform).
 * If prod CSP blocks those, refactor to CSS @keyframes — do NOT add
 * `'unsafe-inline'` (vex-app/scripts/check-build-artifacts.mjs rejects it).
 */

import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "../../lib/utils.js";

type Direction = "TOP" | "LEFT" | "BOTTOM" | "RIGHT";

const DIRECTIONS: readonly Direction[] = ["TOP", "LEFT", "BOTTOM", "RIGHT"];

const MOVING_MAP: Record<Direction, string> = {
  TOP: "radial-gradient(20.7% 50% at 50% 0%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  LEFT: "radial-gradient(16.6% 43.1% at 0% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  BOTTOM:
    "radial-gradient(20.7% 50% at 50% 100%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
  RIGHT:
    "radial-gradient(16.2% 41.2% at 100% 50%, hsl(0, 0%, 100%) 0%, rgba(255, 255, 255, 0) 100%)",
};

const DEFAULT_HIGHLIGHT = "var(--intro-accent, var(--color-accent-primary))";

export interface HoverBorderGradientProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  readonly containerClassName?: string;
  readonly className?: string;
  /** Rotation interval in seconds when not hovered. Default 1. */
  readonly duration?: number;
  /** Reverses rotation direction order. Default true (clockwise). */
  readonly clockwise?: boolean;
  /** CSS color expression for the hover highlight glow. */
  readonly highlightColor?: string;
  readonly children: ReactNode;
}

function rotateDirection(current: Direction, clockwise: boolean): Direction {
  const i = DIRECTIONS.indexOf(current);
  const next = clockwise
    ? (i - 1 + DIRECTIONS.length) % DIRECTIONS.length
    : (i + 1) % DIRECTIONS.length;
  return DIRECTIONS[next]!;
}

export const HoverBorderGradient = forwardRef<
  HTMLButtonElement,
  HoverBorderGradientProps
>(function HoverBorderGradient(
  {
    children,
    containerClassName,
    className,
    duration = 1,
    clockwise = true,
    highlightColor = DEFAULT_HIGHLIGHT,
    onMouseEnter,
    onMouseLeave,
    ...rest
  },
  ref
) {
  const reducedMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [direction, setDirection] = useState<Direction>("TOP");

  useEffect(() => {
    if (reducedMotion || hovered) return;
    const id = window.setInterval(() => {
      setDirection((prev) => rotateDirection(prev, clockwise));
    }, duration * 1000);
    return () => window.clearInterval(id);
  }, [duration, clockwise, hovered, reducedMotion]);

  const highlight = `radial-gradient(75% 181.16% at 50% 50%, ${highlightColor} 0%, rgba(255, 255, 255, 0) 100%)`;

  return (
    <button
      ref={ref}
      type="button"
      onMouseEnter={(event) => {
        setHovered(true);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHovered(false);
        onMouseLeave?.(event);
      }}
      className={cn(
        "relative flex h-min w-fit content-center items-center justify-center gap-10 overflow-visible rounded-full border bg-white/[0.08] p-px transition duration-500 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--intro-accent,var(--color-accent-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)] disabled:pointer-events-none disabled:opacity-50",
        containerClassName
      )}
      {...rest}
    >
      <div
        className={cn(
          "z-10 w-auto rounded-[inherit] bg-[var(--color-bg-elevated)] px-4 py-2 text-[var(--color-text-primary)]",
          className
        )}
      >
        {children}
      </div>
      <motion.div
        aria-hidden
        className="absolute inset-0 z-0 flex-none overflow-hidden rounded-[inherit]"
        style={{ filter: "blur(2px)" }}
        initial={{ background: MOVING_MAP[direction] }}
        animate={{
          background: hovered
            ? [MOVING_MAP[direction], highlight]
            : MOVING_MAP[direction],
        }}
        transition={{ ease: "linear", duration }}
      />
      <div
        aria-hidden
        className="absolute inset-[1px] z-[1] flex-none rounded-[100px] bg-[var(--color-bg-primary)]"
      />
    </button>
  );
});

HoverBorderGradient.displayName = "HoverBorderGradient";
