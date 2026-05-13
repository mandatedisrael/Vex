/**
 * Wizard Step 6 — Provider configuration (M10).
 *
 * OpenRouter inline flow. Single "Verify and save" action does
 * verify-then-persist atomically (codex turn 2 RED #1):
 *
 *   1. Renderer reads apiKey from uncontrolled DOM ref + model from
 *      regular React state.
 *   2. Clears `apiKeyRef.current.value = ""` SYNCHRONOUSLY before
 *      the await (skill §14 — never park secrets in observer state).
 *   3. Calls `providerPersist({apiKey, model, provider:"openrouter"})`.
 *      Main process verifies via OpenRouter SDK (16-token chat
 *      completion, hard 15s timeout) BEFORE writing the 3 .env keys
 *      (OPENROUTER_API_KEY + AGENT_MODEL + AGENT_PROVIDER=openrouter
 *      via atomic batch writer).
 *   4. On success → advance to the Review step (Phase 2: Mode + Wake
 *      are session-config, not wizard steps).
 *   5. On error → render specialised UI copy per VexErrorCode (fixed
 *      strings; SDK raw messages NEVER surfaced — codex turn 3
 *      YELLOW).
 *
 * Skip-card branch: when `envState.provider.configured` is true the
 * user sees the current provider + modelLabel summary + Continue
 * button. "Reconfigure" reveals the form. Effective provider is
 * resolved in main per engine precedence.
 *
 * AGENT_MODEL is NOT a secret — model ids are public catalogue
 * entries — so it stays in React state. The OPENROUTER_API_KEY input
 * is the ONLY secret in this step.
 */

import {
  useCallback,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  type ProviderPersistInput,
} from "@shared/schemas/provider.js";
import {
  type WizardStepId,
} from "@shared/schemas/wizard.js";
import type { VexErrorCode } from "@shared/ipc/result.js";
import { Button } from "../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import { PasswordField } from "../../../components/common/PasswordField.js";
import { useEnvState } from "../../../lib/api/onboarding.js";
import {
  persistProvider,
  useInvalidateEnvStateAfterProviderWrite,
} from "../../../lib/api/provider.js";
import {
  useStepAdvance,
  type WizardFlowMode,
} from "../../../lib/api/wizard.js";

export interface ProviderStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
  readonly flowMode: WizardFlowMode;
}

const VERIFY_AND_SAVE_MIN_DELAY_MS = 0;

interface ServerError {
  readonly code: VexErrorCode | string;
  readonly correlationId: string | null;
}

const PROVIDER_ERROR_UI: Record<string, { title: string; body: string }> = {
  "provider.invalid_api_key": {
    title: "API key rejected",
    body:
      "OpenRouter rejected the API key. Verify the key in your OpenRouter dashboard and try again.",
  },
  "provider.insufficient_credits": {
    title: "Insufficient credits",
    body:
      "Your OpenRouter account has insufficient credits. Add funds in the OpenRouter dashboard, then retry.",
  },
  "provider.model_unsupported": {
    title: "Model not found",
    body:
      "OpenRouter couldn't find that model id. Verify the model in the OpenRouter models catalogue and try again.",
  },
  "provider.unavailable": {
    title: "OpenRouter unavailable",
    body:
      "Couldn't reach OpenRouter (network error, rate limit, or service outage). Check your connection and retry. If this persists, try again in a few minutes.",
  },
  "provider.test_failed": {
    title: "Verification failed",
    body:
      "Verification failed. Try again, or check the OpenRouter dashboard for service issues.",
  },
  "onboarding.env_persist_failed": {
    title: "Couldn't save provider settings",
    body:
      "Credentials verified, but couldn't save to disk. Check disk space and permissions, then retry.",
  },
  "validation.invalid_input": {
    title: "Invalid input",
    body:
      "API key and model id must be non-empty after trimming whitespace, and shorter than 200 characters.",
  },
};

function uiCopyFor(code: string): { title: string; body: string } {
  return (
    PROVIDER_ERROR_UI[code] ?? {
      title: "Something went wrong",
      body:
        "Verification or save failed for an unexpected reason. Please retry.",
    }
  );
}

export function ProviderStep({
  completedSteps,
  onAdvance,
  flowMode,
}: ProviderStepProps): JSX.Element {
  const envQuery = useEnvState();
  const stepAdvance = useStepAdvance();
  const invalidateEnvState = useInvalidateEnvStateAfterProviderWrite();

  const [model, setModel] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [successLatencyMs, setSuccessLatencyMs] = useState<number | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  const apiKeyRef = useRef<HTMLInputElement | null>(null);

  const providerState =
    envQuery.data?.ok === true ? envQuery.data.data.provider : null;
  const configured = providerState?.configured ?? false;
  const effectiveName = providerState?.name ?? null;
  const effectiveModel = providerState?.modelLabel ?? null;

  const advanceToReview = useCallback(async () => {
    setClientError(null);
    const result = await stepAdvance.advance({
      flowMode,
      completedSteps,
      current: "provider",
      forwardNext: "review",
      onAdvance,
    });
    if (!result.ok) setClientError(result.message);
  }, [stepAdvance, flowMode, completedSteps, onAdvance]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setClientError(null);
      setServerError(null);
      setSuccessLatencyMs(null);

      const apiKeyRaw = apiKeyRef.current?.value ?? "";
      const apiKey = apiKeyRaw.trim();
      const modelTrim = model.trim();

      if (apiKey.length === 0) {
        setClientError("Enter your OpenRouter API key.");
        return;
      }
      if (modelTrim.length === 0) {
        setClientError(
          "Enter the OpenRouter model id (e.g. anthropic/claude-sonnet-4.5).",
        );
        return;
      }
      if (apiKey.length > 200 || modelTrim.length > 200) {
        setClientError(
          "API key and model id must each be shorter than 200 characters.",
        );
        return;
      }

      // Snapshot, clear ref SYNCHRONOUSLY before await (skill §14).
      const payload: ProviderPersistInput = {
        provider: "openrouter",
        apiKey,
        model: modelTrim,
      };
      if (apiKeyRef.current) {
        apiKeyRef.current.value = "";
      }
      setSubmitting(true);
      try {
        if (VERIFY_AND_SAVE_MIN_DELAY_MS > 0) {
          await new Promise((r) => setTimeout(r, VERIFY_AND_SAVE_MIN_DELAY_MS));
        }
        const result = await persistProvider(payload);
        if (!result.ok) {
          setServerError({
            code: result.error.code,
            correlationId: result.error.correlationId ?? null,
          });
          return;
        }
        invalidateEnvState();
        setSuccessLatencyMs(result.data.verifiedLatencyMs);
        await advanceToReview();
      } finally {
        setSubmitting(false);
      }
    },
    [advanceToReview, invalidateEnvState, model],
  );

  // ── Skip card ────────────────────────────────────────────────────
  if (configured && !showOverride) {
    return (
      <Card
        className="w-full max-w-2xl"
        data-vex-wizard-provider="skip"
      >
        <CardHeader>
          <CardTitle>Provider is configured</CardTitle>
          <CardDescription>
            {effectiveName === "openrouter"
              ? "OpenRouter is active. Settings apply on next agent restart."
              : "A provider is configured."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {effectiveModel ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <span className="text-muted-foreground">Model:</span>{" "}
              <code className="font-mono">{effectiveModel}</code>
            </div>
          ) : null}
          {clientError ? (
            <p className="text-sm text-destructive" role="alert">
              {clientError}
            </p>
          ) : null}
          <div className="flex justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => setShowOverride(true)}
              disabled={stepAdvance.isPending}
            >
              Reconfigure
            </Button>
            <Button
              onClick={() => {
                void advanceToReview();
              }}
              disabled={stepAdvance.isPending}
            >
              {stepAdvance.isPending
                ? "Continuing…"
                : flowMode === "back-edit"
                  ? "Return to review"
                  : "Continue"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────
  return (
    <Card className="w-full max-w-2xl" data-vex-wizard-provider="form">
      <CardHeader>
        <CardTitle>Inference provider</CardTitle>
        <CardDescription>
          Vex needs an OpenRouter key and model id before starting the
          agent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          noValidate
          className="flex flex-col gap-5"
          data-vex-wizard-provider-form="openrouter"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="vex-provider-key">OpenRouter API key</Label>
            <PasswordField
              id="vex-provider-key"
              ref={apiKeyRef}
              placeholder="sk-or-..."
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Create or copy your key at{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                openrouter.ai/keys
              </a>
              . Stored on this machine in your local config and sent only
              to OpenRouter when you invoke the agent.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="vex-provider-model">Model id</Label>
            <Input
              id="vex-provider-model"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="anthropic/claude-sonnet-4.5"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Browse model ids at{" "}
              <a
                href="https://openrouter.ai/models"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                openrouter.ai/models
              </a>
              .
            </p>
          </div>

          {clientError ? (
            <p className="text-sm text-destructive" role="alert">
              {clientError}
            </p>
          ) : null}

          {serverError ? (
            <div
              role="alert"
              data-vex-provider-error={String(serverError.code)}
              className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-foreground"
            >
              <strong className="block font-semibold">
                {uiCopyFor(String(serverError.code)).title}
              </strong>
              <p className="mt-1">
                {uiCopyFor(String(serverError.code)).body}
              </p>
              {serverError.correlationId ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Correlation id:{" "}
                  <code className="font-mono">
                    {serverError.correlationId}
                  </code>
                </p>
              ) : null}
            </div>
          ) : null}

          {successLatencyMs !== null ? (
            <div
              role="status"
              data-vex-provider-success="true"
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200"
            >
              OpenRouter verified ({successLatencyMs}ms). Settings apply on
              next agent restart.
            </div>
          ) : null}

          <div className="flex justify-end gap-3">
            <Button
              type="submit"
              disabled={submitting || stepAdvance.isPending}
            >
              {submitting
                ? "Verifying..."
                : stepAdvance.isPending
                  ? "Continuing..."
                  : flowMode === "back-edit"
                    ? "Verify and return to review"
                    : "Verify and save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
