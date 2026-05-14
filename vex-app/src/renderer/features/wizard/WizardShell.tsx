/**
 * Wizard shell (M7, Phase 2 refactor — Mode + Wake steps removed).
 *
 * Phase 1 has no back-navigation (Explore agent 1 finding §1) and no
 * cross-step needs; the active step lives in local React state, not
 * Zustand (codex turn 5 answer #5). Persistent recovery — surviving
 * a crash mid-wizard — flows through `wizard-state.json` and the
 * TanStack Query cache: on mount we read the persisted state and
 * initialise the local step from it.
 *
 * If `completed === true` (Review finalised on a previous launch) we
 * flip the view to `appShell` immediately unless the app shell opened
 * the wizard in reconfiguration mode.
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  type WizardStepId,
  type WizardState,
} from "@shared/schemas/wizard.js";
import { Button } from "../../components/ui/button.js";
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
import { ProviderStep } from "./steps/ProviderStep.js";
import { ReviewStep } from "./steps/review/ReviewStep.js";
import { WalletsStep } from "./steps/WalletsStep.js";

function renderStep(
  stepId: WizardStepId,
  completedSteps: ReadonlyArray<WizardStepId>,
  onAdvance: (next: WizardStepId) => void,
  reviewMode: "setup" | "reconfigure",
  onExitReconfigure: () => void
): JSX.Element {
  // M11: every wizard step receives `flowMode="first-pass"` from the
  // shell. ReviewStep itself dispatches edited steps with
  // `flowMode="back-edit"` (local nav, no persisted state advance).
  const props = { completedSteps, onAdvance, flowMode: "first-pass" as const };
  switch (stepId) {
    case "keystore":
      return <KeystoreStep {...props} />;
    case "wallets":
      return <WalletsStep {...props} />;
    case "apiKeys":
      return <ApiKeysStep {...props} />;
    case "embedding":
      return <EmbeddingStep {...props} />;
    case "agentCore":
      return <AgentCoreStep {...props} />;
    case "provider":
      return <ProviderStep {...props} />;
    case "review":
      return (
        <ReviewStep
          completedSteps={completedSteps}
          mode={reviewMode}
          onAdvance={onAdvance}
          onExitReconfigure={onExitReconfigure}
        />
      );
  }
}

export function WizardShell(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const openUnlock = useUiStore((s) => s.openUnlock);
  const wizardEntryMode = useUiStore((s) => s.wizardEntryMode);
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
    let cancelled = false;
    const route = async (): Promise<void> => {
      const status = await window.vex.secrets.status();
      if (cancelled) return;
      const vaultConfigured = status.ok ? status.data.vaultConfigured : false;
      const unlocked = status.ok ? status.data.unlocked : false;

      if (persisted.completed) {
        if (wizardEntryMode === "reconfigure") {
          setCurrentStepId("review");
          return;
        }
        if (vaultConfigured && !unlocked) {
          openUnlock("appShell");
          return;
        }
        if (!vaultConfigured) {
          setCurrentStepId("keystore");
          return;
        }
        setCurrentView("appShell");
        return;
      }

      if (
        persisted.currentStepId !== "keystore" &&
        vaultConfigured &&
        !unlocked
      ) {
        openUnlock("wizard");
        return;
      }
      setCurrentStepId(persisted.currentStepId);
    };
    void route();
    return () => {
      cancelled = true;
    };
  }, [persisted, currentStepId, setCurrentView, wizardEntryMode, openUnlock]);

  const onAdvance = useCallback((next: WizardStepId) => {
    setCurrentStepId(next);
  }, []);
  const onExitReconfigure = useCallback(() => {
    setCurrentView("appShell");
  }, [setCurrentView]);
  const reviewMode =
    persisted?.completed === true && wizardEntryMode === "reconfigure"
      ? "reconfigure"
      : "setup";

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
              Most setup-state failures are transient — retry once, then
              restart Vex if the problem persists.
            </p>
            <Button
              type="button"
              onClick={() => {
                void wizardStateQuery.refetch();
              }}
              disabled={wizardStateQuery.isFetching}
              data-vex-wizard-retry
            >
              {wizardStateQuery.isFetching ? "Retrying…" : "Retry"}
            </Button>
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
              onAdvance,
              reviewMode,
              onExitReconfigure
            )}
          </motion.div>
        </AnimatePresence>
      </section>
    </main>
  );
}
