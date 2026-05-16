/**
 * Horizontal wizard stepper — floating element above the glass panel,
 * replaces the persistent left-rail `ProgressSidebar`.
 *
 * Display-only in Phase 1: clicking a node does NOT navigate. The
 * wizard still has no back-navigation outside the dedicated
 * ReviewStep "edit" path (codex turn 5 answer #2). The stepper is an
 * `<ol>` with `aria-label="Wizard progress"` so assistive tech can
 * still enumerate the seven steps and the current one.
 *
 * Connectors between nodes use `aria-hidden` decorative spans; the
 * segment behind a completed step is tinted with the accent token so
 * the user gets a "progress bar" read on the horizontal axis.
 *
 * Per-step DotMatrix variants come from `STEPPER_LOADER_VARIANTS`;
 * see that module for the shape/color pairing rationale.
 */

import type { JSX } from "react";

import {
  WIZARD_STEP_IDS,
  type WizardStepId,
} from "@shared/schemas/wizard.js";

import { cn } from "../../lib/utils.js";
import { StepperNode, type StepperNodeStatus } from "./stepper/StepperNode.js";

export interface HorizontalStepperProps {
  readonly currentStepId: WizardStepId;
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly className?: string;
}

function resolveStatus(
  stepId: WizardStepId,
  currentStepId: WizardStepId,
  completedSet: ReadonlySet<WizardStepId>,
): StepperNodeStatus {
  // Active wins over completed — a back-edit flow can leave a step
  // both "active" and "completed", but the user is interacting with
  // it RIGHT NOW so the loader must render (codex review V2 #1).
  if (currentStepId === stepId) return "active";
  if (completedSet.has(stepId)) return "completed";
  return "pending";
}

export function HorizontalStepper({
  currentStepId,
  completedSteps,
  className,
}: HorizontalStepperProps): JSX.Element {
  const completedSet = new Set(completedSteps);

  return (
    <ol
      aria-label="Wizard progress"
      className={cn(
        "flex w-full max-w-[760px] items-start justify-between gap-1.5 px-1",
        className,
      )}
    >
      {WIZARD_STEP_IDS.map((id, index) => {
        const status = resolveStatus(id, currentStepId, completedSet);
        const isLast = index === WIZARD_STEP_IDS.length - 1;
        // A connector LOOKS completed when the segment is before a
        // completed-or-active node; this keeps the horizontal track
        // reading "progress so far" without flickering on back-edit.
        const nextStepCompleted =
          !isLast &&
          completedSet.has(WIZARD_STEP_IDS[index + 1] as WizardStepId);
        const segmentCompleted = status === "completed" && nextStepCompleted;

        return (
          <li
            key={id}
            className="flex min-w-0 flex-1 items-start justify-center gap-1.5"
          >
            <StepperNode stepId={id} index={index} status={status} />
            {isLast ? null : (
              <span
                aria-hidden
                className={cn(
                  "mt-4 h-px flex-1 self-start",
                  segmentCompleted
                    ? "bg-[color-mix(in_oklab,var(--vex-onboarding-accent)_55%,transparent)]"
                    : "bg-white/[0.1]",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
