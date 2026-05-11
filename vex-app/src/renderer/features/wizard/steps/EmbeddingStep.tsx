/**
 * Wizard Step 4 — Embedding configuration (M9).
 *
 * Skip-card when `envState.embeddings.allFieldsConfigured` is true.
 * Otherwise: form with the 4 EMBEDDING_* fields. URL is validated
 * against `new URL()` before submit (renderer mirrors the schema
 * refine so the user gets immediate feedback). DIM has a numeric
 * range hint.
 *
 * Error rendering is specialised by VexErrorCode:
 *   - embedding.dim_locked → warning card with the
 *     existing/target row count + "knowledge unavailable" guidance.
 *     User keeps the form filled so they can decide to step back
 *     and pick the existing dim, or cancel.
 *   - embedding.db_unavailable → retry card with hint to verify
 *     the System Check screen first.
 *   - validation.invalid_input → inline field-level error.
 *
 * Reload UX: Step 4 success card notes "Embedding settings apply on
 * the next knowledge operation" because `loadEmbeddingConfig()` is
 * called per-tool invocation in the engine (no agent restart needed
 * for embeddings).
 */

import { useCallback, useState, type JSX } from "react";
import {
  type EmbeddingConfigureInput,
} from "@shared/schemas/embedding.js";
import {
  MAX_EMBEDDING_DIM,
  MIN_EMBEDDING_DIM,
} from "@vex-lib/embedding-constants.js";
import {
  type WizardStepId,
} from "@shared/schemas/wizard.js";
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
import { useEnvState } from "../../../lib/api/onboarding.js";
import { useEmbeddingConfigure } from "../../../lib/api/embedding.js";
import {
  nextWizardStateFor,
  useSetWizardState,
} from "../../../lib/api/wizard.js";

export interface EmbeddingStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
}

interface FormState {
  baseUrl: string;
  model: string;
  dim: string;
  provider: string;
}

interface DimLockDetails {
  readonly existingRowCount: number;
  readonly targetDim: number;
}

function isValidUrlClient(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.hostname.length === 0) return false;
    if (u.username.length > 0 || u.password.length > 0) return false;
    return true;
  } catch {
    return false;
  }
}

function validateForm(state: FormState): string | null {
  if (state.baseUrl.trim().length === 0) return "Base URL is required.";
  if (!isValidUrlClient(state.baseUrl.trim())) {
    return "Base URL must be a valid http(s):// URL with a hostname and no embedded credentials.";
  }
  if (state.model.trim().length === 0) return "Model is required.";
  const dim = Number(state.dim);
  if (!Number.isInteger(dim) || dim < MIN_EMBEDDING_DIM || dim > MAX_EMBEDDING_DIM) {
    return `Dim must be an integer between ${MIN_EMBEDDING_DIM} and ${MAX_EMBEDDING_DIM}.`;
  }
  if (state.provider.trim().length === 0) return "Provider is required.";
  return null;
}

export function EmbeddingStep({
  completedSteps,
  onAdvance,
}: EmbeddingStepProps): JSX.Element {
  const envQuery = useEnvState();
  const setWizardState = useSetWizardState();
  const configure = useEmbeddingConfigure();

  const [form, setForm] = useState<FormState>({
    baseUrl: "",
    model: "",
    dim: "",
    provider: "",
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<{
    code: string;
    message: string;
    details?: DimLockDetails;
  } | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [showOverride, setShowOverride] = useState(false);

  const embeddingsState =
    envQuery.data?.ok === true ? envQuery.data.data.embeddings : null;
  const allConfigured = embeddingsState?.allFieldsConfigured ?? false;

  const advanceToAgentCore = useCallback(async () => {
    setAdvanceError(null);
    const next = nextWizardStateFor({
      completedSteps,
      current: "embedding",
      next: "agentCore",
    });
    const result = await setWizardState.mutateAsync(next);
    if (!result.ok) {
      setAdvanceError(result.error.message);
      return;
    }
    onAdvance("agentCore");
  }, [completedSteps, setWizardState, onAdvance]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setValidationError(null);
      setServerError(null);
      const validation = validateForm(form);
      if (validation !== null) {
        setValidationError(validation);
        return;
      }
      const input: EmbeddingConfigureInput = {
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        dim: Number(form.dim),
        provider: form.provider.trim(),
      };
      const result = await configure.mutateAsync(input);
      if (!result.ok) {
        const details = result.error.details as DimLockDetails | undefined;
        setServerError({
          code: result.error.code,
          message: result.error.message,
          ...(details && typeof details.existingRowCount === "number"
            ? { details }
            : {}),
        });
        return;
      }
      await advanceToAgentCore();
    },
    [form, configure, advanceToAgentCore],
  );

  if (allConfigured && !showOverride) {
    return (
      <Card className="w-full max-w-2xl" data-vex-wizard-embedding="skip">
        <CardHeader>
          <CardTitle>Embedding configuration is set</CardTitle>
          <CardDescription>
            {embeddingsState?.baseUrlRedacted ? (
              <>Vex is using <code>{embeddingsState.baseUrlRedacted}</code>{" "}
              {embeddingsState.reachable ? "(reachable)" : "(unreachable — verify your services)"}.</>
            ) : (
              "All embedding fields are configured."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {advanceError ? (
            <p className="text-sm text-destructive" role="alert">
              {advanceError}
            </p>
          ) : null}
          <div className="flex justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => setShowOverride(true)}
              disabled={setWizardState.isPending}
            >
              Override
            </Button>
            <Button
              onClick={() => {
                void advanceToAgentCore();
              }}
              disabled={setWizardState.isPending}
            >
              {setWizardState.isPending ? "Continuing…" : "Continue"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isDimLocked = serverError?.code === "embedding.dim_locked";
  const isDbDown = serverError?.code === "embedding.db_unavailable";

  return (
    <Card className="w-full max-w-2xl" data-vex-wizard-embedding="form">
      <CardHeader>
        <CardTitle>Embedding configuration</CardTitle>
        <CardDescription>
          Vex needs an OpenAI-compatible embedding endpoint to power
          knowledge recall. Defaults target Docker Model Runner; point
          this at your own OpenAI / Ollama / local server if you prefer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isDimLocked && serverError?.details ? (
          <div
            role="alert"
            data-vex-embedding-warning="dim-locked"
            className="mb-5 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-foreground"
          >
            <strong className="block font-semibold">Dim change blocked.</strong>
            <p className="mt-1">
              {serverError.details.existingRowCount} existing knowledge
              entries use a different embedding dimension. Changing to
              dim={serverError.details.targetDim} would make them
              unavailable.
            </p>
            <p className="mt-2 text-xs">
              Safe path: export your knowledge first, wipe
              <code className="mx-1">knowledge_entries</code>, then change
              dim and re-import. (Phase 2 GUI for this.)
            </p>
          </div>
        ) : null}
        {isDbDown ? (
          <div
            role="alert"
            data-vex-embedding-warning="db-unavailable"
            className="mb-5 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-200"
          >
            <strong className="block font-semibold">Database unavailable.</strong>
            <p className="mt-1">{serverError?.message}</p>
            <p className="mt-2 text-xs">
              Verify Docker services are running, then retry.
            </p>
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          noValidate
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="vex-embed-baseurl">Base URL</Label>
            <Input
              id="vex-embed-baseurl"
              type="url"
              placeholder="http://127.0.0.1:12434/engines/llama.cpp/v1"
              autoComplete="off"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="vex-embed-model">Model</Label>
            <Input
              id="vex-embed-model"
              type="text"
              placeholder="ai/embeddinggemma:300M-Q8_0"
              autoComplete="off"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="vex-embed-dim">Dim</Label>
              <Input
                id="vex-embed-dim"
                type="number"
                inputMode="numeric"
                min={MIN_EMBEDDING_DIM}
                max={MAX_EMBEDDING_DIM}
                placeholder="768"
                value={form.dim}
                onChange={(e) => setForm({ ...form, dim: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                {MIN_EMBEDDING_DIM}–{MAX_EMBEDDING_DIM}. Common: 384, 768, 1024, 1536.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="vex-embed-provider">Provider tag</Label>
              <Input
                id="vex-embed-provider"
                type="text"
                placeholder="local"
                autoComplete="off"
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
              />
            </div>
          </div>

          {validationError ? (
            <p className="text-sm text-destructive" role="alert">
              {validationError}
            </p>
          ) : null}
          {!isDimLocked && !isDbDown && serverError?.message ? (
            <p className="text-sm text-destructive" role="alert">
              {serverError.message}
            </p>
          ) : null}
          {advanceError ? (
            <p className="text-sm text-destructive" role="alert">
              {advanceError}
            </p>
          ) : null}

          <div className="flex justify-end gap-3">
            <Button
              type="submit"
              disabled={configure.isPending || setWizardState.isPending}
            >
              {configure.isPending
                ? "Saving…"
                : setWizardState.isPending
                  ? "Continuing…"
                  : "Save and continue"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
