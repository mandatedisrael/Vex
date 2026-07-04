/**
 * Wizard shell (M7, Phase 2 refactor — Mode + Wake steps removed; PR6
 * redesign — onboarding glass; V2 redesign — sidebar removed, full-
 * bleed background, horizontal stepper above the glass panel).
 *
 * Layout (Countersign/NOTARY rebrand — photo background and glass
 * removed; the wizard is a working page of the same signed document):
 *   - Near-black `--vex-onboarding-bg` canvas, no backdrop image.
 *   - Top-left chip: hallmark + "VEX" wordmark + "SETUP" tag. Bottom
 *     corners carry the shared chrome (brand tetrad + app version),
 *     matching every other onboarding page.
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
 * the wizard in reconfiguration mode. Two effects own this routing: the
 * one-time init effect handles first-mount (relaunch into a completed
 * setup), and a dedicated COMPLETION WATCHER handles the in-session flip
 * after Finalize succeeds on Review (where `currentStepId` is already
 * non-null, so the init effect's guard skips it).
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type WizardStepId,
  type WizardState,
} from "@shared/schemas/wizard.js";
import { Button } from "../../components/ui/button.js";
import { DotmSquare3 } from "../../components/ui/dotm-square-3.js";
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
  "bg-[var(--vex-onboarding-bg)] text-[var(--color-text-primary)]",
);

const ERROR_PANEL_CHROME = cn(
  "w-full max-w-md overflow-hidden rounded-xl",
  "border border-white/[0.08] bg-white/[0.02]",
);

/** Hallmark chip top-left + the shared corner chrome (tetrad, version). */
function TopChrome(): JSX.Element {
  return (
    <>
      <div className="pointer-events-none absolute left-6 top-6 z-10 flex items-center gap-3">
        <img
          src="/logo_clean.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-9 w-9 object-contain opacity-90"
        />
        <div className="flex flex-col leading-tight">
          <span className="font-display text-sm font-extrabold uppercase tracking-[0.3em] text-[var(--color-text-primary)]">
            VEX
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
            Setup
          </span>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-7 left-10 z-10 flex flex-col gap-1.5">
        {/* Static backed-by line — quiet monochrome partner marks; no theme
         * toggle here (the wizard is single-theme onboarding). */}
        <span className="flex items-center gap-2 opacity-60">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
            Backed by
          </span>
          <img
            src="/logo/virtuals.svg"
            alt="Virtuals"
            className="h-3.5 w-3.5"
          />
          <img
            src="/logo/robinhood.svg"
            alt="Robinhood"
            className="h-3.5 w-3.5"
          />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-[var(--color-text-muted)] opacity-60">
          Models Reason · Runtimes Enforce · Chains Prove
        </span>
      </div>
      <span className="pointer-events-none absolute bottom-7 right-10 z-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)] opacity-60">
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

  // Completion watcher. The init effect above owns first-mount routing
  // and early-returns once `currentStepId !== null`, so it never re-runs
  // the completed-routing after the wizard is mounted. When Finalize
  // succeeds the wizardState query refetches with `completed: true` while
  // the user is still parked on Review (`currentStepId === "review"`);
  // this effect performs the SAME completed-routing as the init effect so
  // the shell actually flips to the app shell. It guards on
  // `currentStepId !== null` (the init effect owns first-mount; this
  // avoids a relaunch double-fire) and on `persisted.completed` (only
  // fires after a real completion). Reconfigure mode is skipped so a
  // settings-editor reviewing infrastructure is not bounced out of Review.
  useEffect(() => {
    if (persisted === null || currentStepId === null || !persisted.completed) {
      return;
    }
    if (wizardEntryMode === "reconfigure") return;
    let cancelled = false;
    const route = async (): Promise<void> => {
      const status = await window.vex.secrets.status();
      if (cancelled) return;
      const vaultConfigured = status.ok ? status.data.vaultConfigured : false;
      const unlocked = status.ok ? status.data.unlocked : false;

      if (vaultConfigured && !unlocked) {
        openUnlock("appShell");
        return;
      }
      if (!vaultConfigured) {
        setCurrentStepId("keystore");
        return;
      }
      setCurrentView("appShell");
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
        <TopChrome />
        <div
          className={cn(ERROR_PANEL_CHROME, "relative z-10 flex flex-col gap-4 p-6")}
        >
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-lg font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
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
        <TopChrome />
        {/* Brand loading language — DotMatrix, never a generic pulse bar.
            The loader root carries role="status" aria-live itself. */}
        <div className="relative z-10 flex flex-col items-center">
          <DotmSquare3
            size={24}
            dotSize={3}
            colorPreset="grad-cobalt"
            ariaLabel="Loading wizard progress…"
          />
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
