/**
 * Wizard Review & Finalize step (M11, Phase 2 refactor — Mode + Wake
 * removed from the wizard; PR6 redesign — onboarding glass).
 *
 * Two visual modes:
 *   - default: read-only summary tiles + Sentry consent + Finalize
 *     button, all inside a single `WizardStepPanel`.
 *   - back-edit: renders the selected sub-step DIRECTLY (its own
 *     `WizardStepPanel`) with a small editing-notice banner above. We
 *     deliberately do NOT wrap the sub-step in another Review panel —
 *     double-glass would be confusing (codex round 2 BLOCKED #3).
 *
 * Finalize sequencing lives in main (`finalize.ts::completeSetup`):
 *   validate → autoBackup → wizardState → telemetry → flag. The
 *   renderer just collects the telemetryConsent bool, disables Finalize
 *   on submit, and surfaces telemetryWarning if the consent flip failed
 *   after setup succeeded (codex v3 D11).
 */

import { useCallback, useState, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import type { Result } from "@shared/ipc/result.js";
import type { Capabilities } from "@shared/schemas/capabilities.js";
import { type WizardStepId } from "@shared/schemas/wizard.js";
import type { WalletChain } from "@shared/schemas/wallets.js";
import { Button } from "../../../../components/ui/button.js";
import { cn } from "../../../../lib/utils.js";
import { useEnvState } from "../../../../lib/api/onboarding.js";
import { useCompleteSetup } from "../../../../lib/api/finalize.js";
import { ExportPrivateKeyModal } from "../../../wallets/ExportPrivateKeyModal.js";
import { WIZARD_STEP_META } from "../../wizard-icons.js";
import { WizardStepPanel } from "../../WizardStepPanel.js";
import { AgentCoreStep } from "../AgentCoreStep.js";
import { ApiKeysStep } from "../ApiKeysStep.js";
import { EmbeddingStep } from "../EmbeddingStep.js";
import { KeystoreStep } from "../KeystoreStep.js";
import { ProviderStep } from "../ProviderStep.js";
import { WalletsStep } from "../WalletsStep.js";
import { AgentCoreCard } from "./cards/AgentCoreCard.js";
import { ApiKeysCard } from "./cards/ApiKeysCard.js";
import { EmbeddingCard } from "./cards/EmbeddingCard.js";
import { KeystoreCard } from "./cards/KeystoreCard.js";
import { ProviderCard } from "./cards/ProviderCard.js";
import { WalletsCard } from "./cards/WalletsCard.js";
import { SentryConsentCard } from "./SentryConsentCard.js";

export interface ReviewStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly mode?: "setup" | "reconfigure";
  readonly onAdvance: (next: WizardStepId) => void;
  readonly onExitReconfigure?: () => void;
}

type EditableStep = Exclude<WizardStepId, "review">;

function renderEditPanel(
  stepId: EditableStep,
  completedSteps: ReadonlyArray<WizardStepId>,
  onReturn: (next: WizardStepId) => void,
): JSX.Element {
  const props = {
    completedSteps,
    onAdvance: onReturn,
    flowMode: "back-edit" as const,
  };
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
  }
}

export function ReviewStep({
  completedSteps,
  mode = "setup",
  onAdvance,
  onExitReconfigure,
}: ReviewStepProps): JSX.Element {
  const envQuery = useEnvState();
  const isReconfigure = mode === "reconfigure";
  const capabilitiesQuery = useQuery({
    queryKey: ["capabilities"] as const,
    queryFn: () => window.vex.capabilities.get(),
    enabled: !isReconfigure,
    staleTime: 60_000,
  });
  const completeSetup = useCompleteSetup();

  const [editingStep, setEditingStep] = useState<EditableStep | null>(null);
  const [telemetryConsent, setTelemetryConsent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  /**
   * Export-private-key target chain. Non-null while the modal is open.
   * Gated to `mode === "reconfigure"` via `WalletsCard.onExport` being
   * absent when in setup mode.
   */
  const [exportingChain, setExportingChain] = useState<WalletChain | null>(
    null,
  );

  const env = envQuery.data?.ok === true ? envQuery.data.data : null;
  const caps =
    capabilitiesQuery.data?.ok === true
      ? (capabilitiesQuery.data as Result<Capabilities> & { ok: true }).data
      : null;
  const telemetryAvailable = !isReconfigure && (caps?.telemetryAvailable ?? false);

  const onReturnFromEdit = useCallback(
    (_next: WizardStepId) => {
      setEditingStep(null);
    },
    [],
  );

  const onFinalize = useCallback(async () => {
    setServerError(null);
    setWarning(null);
    const result = await completeSetup.mutateAsync({
      telemetryConsent: telemetryAvailable && telemetryConsent,
    });
    if (!result.ok) {
      setServerError(result.error.message);
      return;
    }
    if (result.data.telemetryWarning) {
      setWarning(result.data.telemetryWarning);
    }
    // wizardState invalidation in useCompleteSetup triggers WizardShell
    // to flip to the appShell view; no explicit nav needed here.
  }, [completeSetup, telemetryAvailable, telemetryConsent]);

  // ── back-edit branch: render the chosen sub-step directly, with a
  //     small editing-notice banner above. The sub-step owns its own
  //     `WizardStepPanel`; we deliberately do NOT wrap it again here
  //     (codex round 2 BLOCKED #3 — single panel only).
  if (editingStep !== null) {
    const editingMeta = WIZARD_STEP_META[editingStep];
    return (
      <div className="flex w-full flex-col gap-3">
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-xl",
            "border border-white/[0.1] bg-white/[0.04] px-4 py-2.5",
            "backdrop-blur-md text-xs text-[var(--color-text-secondary)]",
          )}
          data-vex-wizard-review-editing={editingStep}
        >
          <span className="font-mono uppercase tracking-[0.18em]">
            Editing · {editingMeta.label}
          </span>
          <button
            type="button"
            onClick={() => setEditingStep(null)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md",
              "border border-white/[0.1] bg-white/[0.04] px-2 py-1",
              "font-mono text-[10px] uppercase tracking-[0.18em]",
              "text-[var(--color-text-secondary)]",
              "hover:border-white/[0.2] hover:text-[var(--color-text-primary)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
            )}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={11} aria-hidden />
            Return to review
          </button>
        </div>
        {renderEditPanel(editingStep, completedSteps, onReturnFromEdit)}
      </div>
    );
  }

  const reviewMeta = WIZARD_STEP_META.review;

  if (envQuery.isLoading || env === null) {
    return (
      <WizardStepPanel
        panelDataAttr={{ kind: "review", value: "loading" }}
        icon={reviewMeta.icon}
        title="Review your setup"
        description="Gathering current configuration…"
        footer={null}
      >
        <div role="status" aria-live="polite" className="flex items-center gap-2">
          <div
            aria-hidden
            className="h-1 w-32 overflow-hidden rounded-full bg-white/[0.07]"
          >
            <div className="h-full w-1/3 animate-pulse bg-[var(--vex-onboarding-accent)]" />
          </div>
          <span className="sr-only">Loading review…</span>
        </div>
      </WizardStepPanel>
    );
  }

  const submitting = completeSetup.isPending;
  const editDisabled = submitting;

  return (
    <WizardStepPanel
      panelDataAttr={{ kind: "review", value: "form" }}
      icon={reviewMeta.icon}
      title={isReconfigure ? "Edit infrastructure" : "Review your setup"}
      description={
        isReconfigure
          ? "Review current infrastructure settings and edit only the section you need."
          : "Confirm everything below, choose whether to share anonymous error reports, and finalize. Vex will back up your wallets before marking setup complete."
      }
      footer={
        isReconfigure ? (
          <Button
            type="button"
            onClick={onExitReconfigure}
            data-vex-wizard-review-exit
          >
            Back to sessions
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => {
              void onFinalize();
            }}
            disabled={submitting}
            data-vex-wizard-review-finalize
          >
            {submitting ? "Finalizing…" : "Finalize setup"}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <KeystoreCard
          envState={env}
          onEdit={() => setEditingStep("keystore")}
          editDisabled={editDisabled}
        />
        <WalletsCard
          envState={env}
          onEdit={() => setEditingStep("wallets")}
          editDisabled={editDisabled}
          mode={mode}
          {...(isReconfigure
            ? { onExport: (chain: WalletChain) => setExportingChain(chain) }
            : {})}
        />
        <ApiKeysCard
          envState={env}
          onEdit={() => setEditingStep("apiKeys")}
          editDisabled={editDisabled}
        />
        <EmbeddingCard
          envState={env}
          onEdit={() => setEditingStep("embedding")}
          editDisabled={editDisabled}
        />
        <AgentCoreCard
          onEdit={() => setEditingStep("agentCore")}
          editDisabled={editDisabled}
        />
        <ProviderCard
          envState={env}
          onEdit={() => setEditingStep("provider")}
          editDisabled={editDisabled}
        />
        {isReconfigure ? null : (
          <SentryConsentCard
            telemetryAvailable={telemetryAvailable}
            checked={telemetryConsent}
            onChange={setTelemetryConsent}
            disabled={submitting}
          />
        )}

        {serverError ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {serverError}
          </p>
        ) : null}
        {warning ? (
          <p
            className="rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)] px-3 py-2 text-sm text-[var(--color-warning)]"
            role="status"
          >
            {warning}
          </p>
        ) : null}
      </div>

      {/*
        Onward navigation note: after a successful finalize, useCompleteSetup
        invalidates wizardState; WizardShell then reads `completed: true`
        and switches the view to the Phase 2 appShell. We don't call
        `onAdvance` here because there is no next step — the wizard ends.
      */}
      <span className="sr-only" data-vex-onadvance-stub>
        {typeof onAdvance === "function" ? "" : ""}
      </span>

      {exportingChain !== null ? (
        <ExportPrivateKeyModal
          chain={exportingChain}
          walletAddress={env.walletAddresses?.[exportingChain] ?? ""}
          onClose={() => setExportingChain(null)}
        />
      ) : null}
    </WizardStepPanel>
  );
}
