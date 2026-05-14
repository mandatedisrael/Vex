/**
 * Wizard Review & Finalize step (M11, Phase 2 refactor — Mode + Wake
 * removed from the wizard).
 *
 * Two visual modes:
 *   - default: read-only summary cards + Sentry consent card +
 *     Finalize button.
 *   - back-edit: re-renders one prior step with `flowMode="back-edit"`
 *     so the operator can fix a typo without resetting the wizard.
 *     Persisted `currentStepId` stays at "review" — the prior step's
 *     Save & Continue handler routes back here via `onAdvance("review")`
 *     instead of writing wizard state forward.
 *
 * Finalize sequencing lives in main (`finalize.ts::completeSetup`):
 *   validate → autoBackup → wizardState → telemetry → flag. The
 *   renderer just collects the telemetryConsent bool, disables Finalize
 *   on submit, and surfaces telemetryWarning if the consent flip failed
 *   after setup succeeded (codex v3 D11).
 */

import { useCallback, useState, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { Capabilities } from "@shared/schemas/capabilities.js";
import { type WizardStepId } from "@shared/schemas/wizard.js";
import type { WalletChain } from "@shared/schemas/wallets.js";
import { Button } from "../../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card.js";
import { useEnvState } from "../../../../lib/api/onboarding.js";
import { useCompleteSetup } from "../../../../lib/api/finalize.js";
import { ExportPrivateKeyModal } from "../../../wallets/ExportPrivateKeyModal.js";
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
  const props = { completedSteps, onAdvance: onReturn, flowMode: "back-edit" as const };
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

  if (editingStep !== null) {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Editing <strong>{editingStep}</strong> — your changes save and
            return you to Review.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditingStep(null)}
          >
            Cancel
          </Button>
        </div>
        {renderEditPanel(editingStep, completedSteps, onReturnFromEdit)}
      </div>
    );
  }

  if (envQuery.isLoading || env === null) {
    return (
      <Card className="w-full max-w-2xl" data-vex-wizard-review="loading">
        <CardHeader>
          <CardTitle>Review your setup</CardTitle>
          <CardDescription>Gathering current configuration…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const submitting = completeSetup.isPending;
  const editDisabled = submitting;

  return (
    <Card className="w-full max-w-2xl" data-vex-wizard-review="form">
      <CardHeader>
        <CardTitle>
          {isReconfigure ? "Edit infrastructure" : "Review your setup"}
        </CardTitle>
        <CardDescription>
          {isReconfigure
            ? "Review current infrastructure settings and edit only the section you need."
            : "Confirm everything below, choose whether to share anonymous error reports, and finalize. Vex will back up your wallets before marking setup complete."}
        </CardDescription>
      </CardHeader>
      <CardContent>
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
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          ) : null}
          {warning ? (
            <p
              className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
              role="status"
            >
              {warning}
            </p>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            {isReconfigure ? (
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
            )}
          </div>
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
      </CardContent>
      {exportingChain !== null ? (
        <ExportPrivateKeyModal
          chain={exportingChain}
          walletAddress={env.walletAddresses?.[exportingChain] ?? ""}
          onClose={() => setExportingChain(null)}
        />
      ) : null}
    </Card>
  );
}
