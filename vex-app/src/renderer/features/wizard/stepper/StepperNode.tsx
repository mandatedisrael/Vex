/**
 * Single node in the horizontal wizard stepper. Three visual states:
 *
 *   - pending   — index, dim label
 *   - active    — the step's unique DotMatrix
 *                 loader (per `STEPPER_LOADER_VARIANTS`)
 *   - completed — success-tinted checkmark glyph
 *
 * Active wins over completed when the current step id matches — a
 * back-edit return from review can leave a step both "active" and
 * "completed", but the user is interacting with it right now so the
 * loader must show (codex review V2 #1).
 *
 * Test/debug surface preserved from the old `ProgressSidebar`:
 *   - `data-vex-wizard-step={stepId}`
 *   - `data-status="pending|active|completed"`
 *   - `aria-current="step"` on active
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkBadge02Icon } from "@hugeicons/core-free-icons";

import { cn } from "../../../lib/utils.js";
import type { WizardStepId } from "@shared/schemas/wizard.js";
import { WIZARD_STEP_META } from "../wizard-icons.js";
import { STEPPER_LOADER_VARIANTS } from "./stepper-loader-variants.js";

export type StepperNodeStatus = "pending" | "active" | "completed";

export interface StepperNodeProps {
  readonly stepId: WizardStepId;
  readonly index: number;
  readonly status: StepperNodeStatus;
}

const NODE_BASE = cn(
  "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center",
  "transition-colors duration-200",
);

const NODE_CHROME: Record<StepperNodeStatus, string> = {
  pending: "text-[var(--color-text-muted)]",
  active: "text-[var(--color-text-primary)]",
  completed: "text-[var(--color-success)]",
};

const LABEL_CHROME: Record<StepperNodeStatus, string> = {
  pending: "text-[var(--color-text-muted)]",
  active: "text-[var(--color-text-primary)]",
  completed: "text-[var(--color-text-secondary)]",
};

export function StepperNode({
  stepId,
  index,
  status,
}: StepperNodeProps): JSX.Element {
  const meta = WIZARD_STEP_META[stepId];
  const variant = STEPPER_LOADER_VARIANTS[stepId];
  const Loader = variant.Component;

  return (
    <div
      data-vex-wizard-step={stepId}
      data-status={status}
      aria-current={status === "active" ? "step" : undefined}
      className="flex min-w-0 flex-col items-center gap-1.5"
    >
      <span className={cn(NODE_BASE, NODE_CHROME[status])}>
        {status === "active" ? (
          <Loader
            size={22}
            dotSize={2}
            colorPreset={variant.colorPreset}
            ariaLabel={`Current step: ${meta.label}`}
          />
        ) : status === "completed" ? (
          <HugeiconsIcon
            icon={CheckmarkBadge02Icon}
            size={16}
            aria-hidden
          />
        ) : (
          <span className="font-mono text-[11px] font-medium">{index + 1}</span>
        )}
      </span>
      <span
        className={cn(
          "max-w-[80px] truncate text-center font-mono text-[10px] uppercase tracking-[0.16em]",
          LABEL_CHROME[status],
          status === "active" && "font-medium",
        )}
      >
        {meta.label}
      </span>
    </div>
  );
}
