/**
 * Wizard Step 4 — Embedding configuration (M9; PR6 redesign — glass).
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
 *
 * Chrome lives in `WizardStepPanel` — `data-vex-wizard-embedding`
 * forwarded onto the panel root.
 */

import { useCallback, useState, type JSX } from "react";
import {
  type EmbeddingConfigureInput,
} from "@shared/schemas/embedding.js";
import {
  buildEmbeddingBaseUrl,
  DEFAULT_EMBED_PORT,
  EMBEDDING_DIM,
  EMBEDDING_MODEL_ALIAS,
  EMBEDDING_PROVIDER,
} from "@shared/embedding-defaults.js";
import {
  MAX_EMBEDDING_DIM,
  MIN_EMBEDDING_DIM,
} from "@vex-lib/embedding-constants.js";
import {
  type WizardStepId,
} from "@shared/schemas/wizard.js";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import { useEnvState } from "../../../lib/api/onboarding.js";
import { useEmbeddingConfigure } from "../../../lib/api/embedding.js";
import {
  useStepAdvance,
  type WizardFlowMode,
} from "../../../lib/api/wizard.js";
import { WIZARD_STEP_META } from "../wizard-icons.js";
import { WizardStepPanel } from "../WizardStepPanel.js";

export interface EmbeddingStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
  readonly flowMode: WizardFlowMode;
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

function narrowDimLockDetails(raw: unknown): DimLockDetails | null {
  // Server-side `embedding-writer.ts` puts these fields into
  // `VexError.details` on `embedding.dim_locked`. Narrow here through
  // `in` operator checks (zero `as` casts) so the renderer never
  // trusts an arbitrary unknown shape — codex review round 3/4 YELLOW.
  if (typeof raw !== "object" || raw === null) return null;
  if (!("existingRowCount" in raw) || !("targetDim" in raw)) return null;
  const existingRowCount = raw.existingRowCount;
  const targetDim = raw.targetDim;
  if (typeof existingRowCount !== "number" || typeof targetDim !== "number") {
    return null;
  }
  return { existingRowCount, targetDim };
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
  flowMode,
}: EmbeddingStepProps): JSX.Element {
  const envQuery = useEnvState();
  const stepAdvance = useStepAdvance();
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
    const result = await stepAdvance.advance({
      flowMode,
      completedSteps,
      current: "embedding",
      forwardNext: "agentCore",
      onAdvance,
    });
    if (!result.ok) setAdvanceError(result.message);
  }, [stepAdvance, flowMode, completedSteps, onAdvance]);

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
        const details = narrowDimLockDetails(result.error.details);
        setServerError({
          code: result.error.code,
          message: result.error.message,
          ...(details !== null ? { details } : {}),
        });
        return;
      }
      await advanceToAgentCore();
    },
    [form, configure, advanceToAgentCore],
  );

  const meta = WIZARD_STEP_META.embedding;

  if (allConfigured && !showOverride) {
    return (
      <WizardStepPanel
        panelDataAttr={{ kind: "embedding", value: "skip" }}
        icon={meta.icon}
        title="Embedding configuration is set"
        description={
          embeddingsState?.baseUrlRedacted ? (
            <>
              Vex is using <code>{embeddingsState.baseUrlRedacted}</code>{" "}
              (bundled EmbeddingGemma 300M, dim {EMBEDDING_DIM}){" "}
              {embeddingsState.reachable
                ? "— reachable ✓"
                : "— not reachable yet; the runtime may still be loading the model."}
            </>
          ) : (
            "Bundled EmbeddingGemma 300M is configured."
          )
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setShowOverride(true)}
              disabled={stepAdvance.isPending}
            >
              Override
            </Button>
            <Button
              onClick={() => {
                void advanceToAgentCore();
              }}
              disabled={stepAdvance.isPending}
            >
              {stepAdvance.isPending
                ? "Continuing…"
                : flowMode === "back-edit"
                  ? "Return to review"
                  : "Continue"}
            </Button>
          </>
        }
      >
        {advanceError ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {advanceError}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Override to point at a different OpenAI-compatible endpoint.
          </p>
        )}
      </WizardStepPanel>
    );
  }

  const isDimLocked = serverError?.code === "embedding.dim_locked";
  const isDbDown = serverError?.code === "embedding.db_unavailable";

  return (
    <WizardStepPanel
      panelDataAttr={{ kind: "embedding", value: "form" }}
      icon={meta.icon}
      title="Embedding configuration"
      description={
        <>
          Vex needs an OpenAI-compatible embedding endpoint to power
          knowledge recall. The bundled stack runs llama.cpp:server with
          EmbeddingGemma 300M on{" "}
          <code>127.0.0.1:{DEFAULT_EMBED_PORT}</code> — point this at
          your own OpenAI / Ollama / remote endpoint if you prefer.
        </>
      }
      formProps={{
        onSubmit: (e) => {
          void onSubmit(e);
        },
        noValidate: true,
      }}
      footer={
        <Button
          type="submit"
          disabled={configure.isPending || stepAdvance.isPending}
        >
          {configure.isPending
            ? "Saving…"
            : stepAdvance.isPending
              ? "Continuing…"
              : flowMode === "back-edit"
                ? "Save and return to review"
                : "Save and continue"}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {isDimLocked && serverError?.details ? (
          <div
            role="alert"
            data-vex-embedding-warning="dim-locked"
            className="rounded-md border border-[color-mix(in_oklab,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] p-4 text-sm text-[var(--color-danger)]"
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
            className="rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)] p-4 text-sm text-[var(--color-warning)]"
          >
            <strong className="block font-semibold">
              Database unavailable.
            </strong>
            <p className="mt-1">{serverError?.message}</p>
            <p className="mt-2 text-xs">
              Verify Docker services are running, then retry.
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="vex-embed-baseurl">Base URL</Label>
          <Input
            id="vex-embed-baseurl"
            type="url"
            placeholder={buildEmbeddingBaseUrl()}
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
            placeholder={EMBEDDING_MODEL_ALIAS}
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
              placeholder={String(EMBEDDING_DIM)}
              value={form.dim}
              onChange={(e) => setForm({ ...form, dim: e.target.value })}
            />
            <p className="text-xs text-[var(--color-text-muted)]">
              {MIN_EMBEDDING_DIM}–{MAX_EMBEDDING_DIM}. Common: 384, 768, 1024, 1536.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="vex-embed-provider">Provider tag</Label>
            <Input
              id="vex-embed-provider"
              type="text"
              placeholder={EMBEDDING_PROVIDER}
              autoComplete="off"
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
            />
          </div>
        </div>

        {validationError ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {validationError}
          </p>
        ) : null}
        {!isDimLocked && !isDbDown && serverError?.message ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {serverError.message}
          </p>
        ) : null}
        {advanceError ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {advanceError}
          </p>
        ) : null}
      </div>
    </WizardStepPanel>
  );
}
