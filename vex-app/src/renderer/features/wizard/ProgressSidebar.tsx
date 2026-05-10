/**
 * Wizard progress sidebar — fixed-width left rail rendering all 9
 * steps with their completion status. Display-only in Phase 1: no
 * back-navigation, no clickable jump (codex turn 5 answer #2 — Phase
 * 1 has no back-nav, ordering lives in the canonical step list, not
 * in user interaction).
 */

import type { JSX } from "react";
import {
  WIZARD_STEP_IDS,
  type WizardStepId,
} from "@shared/schemas/wizard.js";
import { cn } from "../../lib/utils.js";

const STEP_LABELS: Record<WizardStepId, string> = {
  keystore: "Master password",
  wallets: "Wallets",
  apiKeys: "API keys",
  embedding: "Embedding",
  agentCore: "Agent core",
  provider: "Provider",
  mode: "Mode",
  wake: "Wake",
  review: "Review",
};

export interface ProgressSidebarProps {
  readonly currentStepId: WizardStepId;
  readonly completedSteps: ReadonlyArray<WizardStepId>;
}

export function ProgressSidebar({
  currentStepId,
  completedSteps,
}: ProgressSidebarProps): JSX.Element {
  const completedSet = new Set(completedSteps);
  return (
    <aside
      className="flex h-full w-[280px] shrink-0 flex-col gap-6 border-r border-border bg-card/30 p-6"
      aria-label="Wizard progress"
    >
      <header className="flex flex-col gap-1">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Setup
        </p>
        <h1 className="text-lg font-semibold text-foreground">Vex wallet</h1>
      </header>
      <ol className="flex flex-col gap-1">
        {WIZARD_STEP_IDS.map((id, idx) => {
          const isCompleted = completedSet.has(id);
          const isActive = currentStepId === id;
          const status: "completed" | "active" | "pending" = isCompleted
            ? "completed"
            : isActive
              ? "active"
              : "pending";
          return (
            <li
              key={id}
              data-vex-wizard-step={id}
              data-status={status}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                status === "active" &&
                  "bg-primary/10 text-foreground ring-1 ring-primary/40",
                status === "completed" && "text-muted-foreground",
                status === "pending" && "text-muted-foreground/60"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  status === "completed" &&
                    "bg-success/20 text-success",
                  status === "active" && "bg-primary text-primary-foreground",
                  status === "pending" &&
                    "border border-border bg-transparent text-muted-foreground"
                )}
              >
                {status === "completed" ? "✓" : idx + 1}
              </span>
              <span className="flex-1 truncate">{STEP_LABELS[id]}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
