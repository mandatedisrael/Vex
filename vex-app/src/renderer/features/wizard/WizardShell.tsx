/**
 * Wizard shell (M7, Phase 2 refactor — Mode + Wake steps removed; PR6
 * redesign — onboarding glass; V2 redesign — sidebar removed, full-
 * bleed background, horizontal stepper above the glass panel).
 *
 * Layout:
 *   - `onboarding2.png` covers the whole viewport (no sidebar split).
 *   - A right-side gradient overlay deepens the dark area for content
 *     legibility, matching the four sibling onboarding screens.
 *   - Top-left chip: brand mark + "VEX" wordmark + "SETUP" tag.
 *     Top-right chip: app version. Both float over the background.
 *   - Centered column hosts `HorizontalStepper` above `WizardStepPanel`.
 *     Each step's unique DotMatrix loader lives inside the active
 *     stepper node (`stepper/stepper-loader-variants.ts`).
 *   - "Your data stays yours" link + step counter live inside the
 *     panel footer (rendered by `WizardStepPanel` itself).
 *
 * Per-step chrome lives in `WizardStepPanel`; each step now returns a
 * `WizardStepPanel` (or, for ReviewStep back-edit, a sub-step's panel
 * with a small editing notice banner above). `AnimatePresence` stays
 * on this shell — the panel itself is a plain `<div>` so transitions
 * are not double-wrapped.
 *
 * Phase 1 has no back-navigation (Explore agent 1 finding §1) and no
 * cross-step needs; the active step lives in local React state, not
 * Zustand (codex turn 5 answer #5). Persistent recovery — surviving a
 * crash mid-wizard — flows through `wizard-state.json` and the
 * TanStack Query cache.
 *
 * If `completed === true` (Review finalised on a previous launch) we
 * flip the view to `appShell` immediately unless the app shell opened
 * the wizard in reconfiguration mode.
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type WizardStepId,
  type WizardState,
} from "@shared/schemas/wizard.js";
import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/utils.js";
import { useUiStore } from "../../stores/uiStore.js";
import { useWizardState } from "../../lib/api/wizard.js";
import { HorizontalStepper } from "./HorizontalStepper.js";
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
  onExitReconfigure: () => void,
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

const SHELL_CHROME = cn(
  "relative flex h-screen w-screen overflow-hidden",
  "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]",
);

const ERROR_PANEL_CHROME = cn(
  "w-full max-w-md overflow-hidden rounded-3xl",
  "border border-white/[0.12] bg-white/[0.05] backdrop-blur-2xl",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(0,0,0,0.2),0_18px_60px_rgba(0,0,0,0.45)]",
);

function ShellBackdrop(): JSX.Element {
  return (
    <>
      <img
        src="/onboarding2.png"
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[rgba(5,8,22,0.6)]"
      />
    </>
  );
}

function TopChrome(): JSX.Element {
  return (
    <>
      <div className="pointer-events-none absolute left-6 top-6 z-10 flex items-center gap-3">
        <img
          src="/logo_clean.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-9 w-9 object-contain drop-shadow-[0_2px_8px_rgba(50,117,248,0.35)]"
        />
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-sm font-semibold tracking-[0.3em] text-[var(--color-text-primary)]">
            VEX
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
            Setup
          </span>
        </div>
      </div>
      <span className="pointer-events-none absolute right-6 top-6 z-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
        v{__VEX_APP_VERSION__}
      </span>
    </>
  );
}

export function WizardShell(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const openUnlock = useUiStore((s) => s.openUnlock);
  const wizardEntryMode = useUiStore((s) => s.wizardEntryMode);
  const wizardStateQuery = useWizardState();
  const reducedMotion = useReducedMotion();

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
        data-vex-onboarding="true"
        data-vex-screen="wizard"
        className={cn(SHELL_CHROME, "items-center justify-center p-8")}
      >
        <ShellBackdrop />
        <TopChrome />
        <div
          className={cn(ERROR_PANEL_CHROME, "relative z-10 flex flex-col gap-4 p-6")}
        >
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Setup unavailable
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)]">{message}</p>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Most setup-state failures are transient — retry once, then
            restart Vex if the problem persists.
          </p>
          <div className="flex justify-end">
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
          </div>
        </div>
      </main>
    );
  }

  if (currentStepId === null) {
    return (
      <main
        data-vex-onboarding="true"
        data-vex-screen="wizard"
        className={cn(SHELL_CHROME, "items-center justify-center p-8")}
      >
        <ShellBackdrop />
        <TopChrome />
        <div
          role="status"
          aria-live="polite"
          className="relative z-10 flex flex-col items-center gap-3"
        >
          <div
            aria-hidden
            className="h-1 w-32 overflow-hidden rounded-full bg-white/[0.07]"
          >
            <div className="h-full w-1/3 animate-pulse bg-[var(--vex-onboarding-accent)]" />
          </div>
          <span className="sr-only">Loading wizard progress…</span>
        </div>
      </main>
    );
  }

  return (
    <main
      data-vex-onboarding="true"
      data-vex-screen="wizard"
      className={cn(SHELL_CHROME, "flex-col items-center px-6 pt-24 pb-8")}
    >
      <ShellBackdrop />
      <TopChrome />

      {/*
        `m-auto` keeps the column vertically centered when the active
        step content is short. `min-h-0` + the panel's own
        `max-h-[calc(100vh-13rem)]` (13rem = pt-24 + stepper + gap-6 +
        pb-8) let the glass panel shrink and scroll on the 1024×720
        minimum BrowserWindow size (codex final review V2 P1).
      */}
      <div className="relative z-10 m-auto flex min-h-0 w-full max-w-[760px] flex-col items-center gap-6">
        <HorizontalStepper
          currentStepId={currentStepId}
          completedSteps={persisted?.completedSteps ?? []}
        />
        <div className="w-full min-h-0 max-w-[640px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentStepId}
              initial={reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: reducedMotion ? 0 : 0.2, ease: "easeOut" }}
              className="w-full"
            >
              {renderStep(
                currentStepId,
                persisted?.completedSteps ?? [],
                onAdvance,
                reviewMode,
                onExitReconfigure,
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
