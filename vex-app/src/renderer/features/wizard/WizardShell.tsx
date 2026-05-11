/**
 * Wizard shell (M7) — sidebar + active-step panel layout for the
 * Phase 1 setup ceremony.
 *
 * Phase 1 has no back-navigation (Explore agent 1 finding §1) and no
 * cross-step needs; the active step lives in local React state, not
 * Zustand (codex turn 5 answer #5). Persistent recovery — surviving
 * a crash mid-wizard — flows through `wizard-state.json` and the
 * TanStack Query cache: on mount we read the persisted state and
 * initialise the local step from it.
 *
 * If `completed === true` (Step 9 / Review finalised on a previous
 * launch) we flip the view to `placeholder` immediately. The wizard
 * never re-renders for a finished install.
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  type WizardStepId,
  type WizardState,
} from "@shared/schemas/wizard.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { useUiStore } from "../../stores/uiStore.js";
import { useWizardState } from "../../lib/api/wizard.js";
import { ProgressSidebar } from "./ProgressSidebar.js";
import { AgentCoreStep } from "./steps/AgentCoreStep.js";
import { ApiKeysStep } from "./steps/ApiKeysStep.js";
import { EmbeddingStep } from "./steps/EmbeddingStep.js";
import { KeystoreStep } from "./steps/KeystoreStep.js";
import { WalletsStep } from "./steps/WalletsStep.js";
import { PlaceholderStep } from "./steps/PlaceholderStep.js";

type StepMilestone = "M10" | "M11";

const PLACEHOLDER_MILESTONE: Record<
  Exclude<WizardStepId, "keystore" | "wallets" | "apiKeys" | "embedding" | "agentCore">,
  StepMilestone
> = {
  provider: "M10",
  mode: "M11",
  wake: "M11",
  review: "M11",
};

function renderStep(
  stepId: WizardStepId,
  completedSteps: ReadonlyArray<WizardStepId>,
  onAdvance: (next: WizardStepId) => void
): JSX.Element {
  if (stepId === "keystore") {
    return (
      <KeystoreStep completedSteps={completedSteps} onAdvance={onAdvance} />
    );
  }
  if (stepId === "wallets") {
    return (
      <WalletsStep completedSteps={completedSteps} onAdvance={onAdvance} />
    );
  }
  if (stepId === "apiKeys") {
    return (
      <ApiKeysStep completedSteps={completedSteps} onAdvance={onAdvance} />
    );
  }
  if (stepId === "embedding") {
    return (
      <EmbeddingStep completedSteps={completedSteps} onAdvance={onAdvance} />
    );
  }
  if (stepId === "agentCore") {
    return (
      <AgentCoreStep completedSteps={completedSteps} onAdvance={onAdvance} />
    );
  }
  return (
    <PlaceholderStep stepId={stepId} milestone={PLACEHOLDER_MILESTONE[stepId]} />
  );
}

export function WizardShell(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const wizardStateQuery = useWizardState();

  const persisted: WizardState | null =
    wizardStateQuery.data?.ok === true ? wizardStateQuery.data.data : null;
  const queryError =
    wizardStateQuery.isError ||
    (wizardStateQuery.data && wizardStateQuery.data.ok === false);

  const [currentStepId, setCurrentStepId] = useState<WizardStepId | null>(null);

  // Initialise local step from persisted state on first resolution.
  // We deliberately don't bind to persisted on every change — once the
  // wizard is mounted, the local step is the source of truth (the
  // user's `Save and Continue` advances both local and persisted).
  useEffect(() => {
    if (persisted === null || currentStepId !== null) return;
    if (persisted.completed) {
      setCurrentView("placeholder");
      return;
    }
    setCurrentStepId(persisted.currentStepId);
  }, [persisted, currentStepId, setCurrentView]);

  const onAdvance = useCallback((next: WizardStepId) => {
    setCurrentStepId(next);
  }, []);

  if (queryError) {
    const message =
      wizardStateQuery.data?.ok === false
        ? wizardStateQuery.data.error.message
        : "Could not load wizard state.";
    return (
      <main
        className="flex min-h-screen flex-col items-center justify-center bg-background p-8 text-foreground"
        data-vex-screen="wizard"
      >
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Setup unavailable</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{message}</p>
            <p className="text-xs text-muted-foreground">
              Restart Vex — the wizard recovers its progress from local
              state on the next launch.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (currentStepId === null) {
    return (
      <main
        className="flex min-h-screen flex-col items-center justify-center bg-background p-8 text-foreground"
        data-vex-screen="wizard"
      >
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center gap-3"
        >
          <div
            aria-hidden
            className="h-1 w-32 overflow-hidden rounded-full bg-popover"
          >
            <div className="h-full w-1/3 animate-pulse bg-primary" />
          </div>
          <span className="sr-only">Loading wizard progress…</span>
        </div>
      </main>
    );
  }

  return (
    <main
      className="grid min-h-screen grid-cols-[280px_1fr] bg-background text-foreground"
      data-vex-screen="wizard"
    >
      <ProgressSidebar
        currentStepId={currentStepId}
        completedSteps={persisted?.completedSteps ?? []}
      />
      <section className="flex items-start justify-center overflow-y-auto p-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentStepId}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="w-full max-w-2xl"
          >
            {renderStep(
              currentStepId,
              persisted?.completedSteps ?? [],
              onAdvance
            )}
          </motion.div>
        </AnimatePresence>
      </section>
    </main>
  );
}
