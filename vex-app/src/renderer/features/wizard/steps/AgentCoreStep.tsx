/**
 * Wizard Step 5 — Agent core tuning (M9).
 *
 * All fields optional. Three states per field:
 *   - empty input  → no change to .env (existing value preserved)
 *   - typed value  → submitted as number → set in .env
 *   - "Reset" btn  → submitted as null → REMOVED from .env (engine
 *                    reads fall back to compile-time default)
 *
 * Continue ALWAYS submits, even with no changes — the writer
 * runs effective-config validation against existing .env so a
 * user who manually corrupted their .env (e.g. AGENT_MAX > AGENT_CTX)
 * gets blocked at this step until they fix it via this form.
 *
 * Cross-field error rendering matches the shape returned by
 * agent-core-writer's `details.violation` discriminator.
 *
 * Reload disclosure: changes apply when the agent restarts (engine
 * reads loadEnvConfig once at registry build).
 */

import { useCallback, useState, type JSX } from "react";
import {
  AGENT_CONTEXT_LIMIT,
  AGENT_MAX_OUTPUT_TOKENS,
  AGENT_TEMPERATURE,
  SUBAGENT_CONTEXT_LIMIT,
  SUBAGENT_MAX_CONCURRENT,
  SUBAGENT_MAX_ITERATIONS,
  SUBAGENT_MAX_OUTPUT_TOKENS,
  SUBAGENT_TEMPERATURE,
  SUBAGENT_TIMEOUT_MS,
} from "@vex-lib/agent-config.js";
import {
  type AgentCoreConfigureInput,
} from "@shared/schemas/agent-core.js";
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
import { useAgentCoreConfigure } from "../../../lib/api/agent-core.js";
import {
  nextWizardStateFor,
  useSetWizardState,
} from "../../../lib/api/wizard.js";

export interface AgentCoreStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
}

type FieldState =
  | { kind: "unchanged" }
  | { kind: "set"; raw: string }
  | { kind: "clear" };

interface FormState {
  contextLimit: FieldState;
  maxOutputTokens: FieldState;
  temperature: FieldState;
  subMaxConcurrent: FieldState;
  subContextLimit: FieldState;
  subMaxOutputTokens: FieldState;
  subTemperature: FieldState;
  subMaxIterations: FieldState;
  subTimeoutMs: FieldState;
}

const INITIAL: FormState = {
  contextLimit: { kind: "unchanged" },
  maxOutputTokens: { kind: "unchanged" },
  temperature: { kind: "unchanged" },
  subMaxConcurrent: { kind: "unchanged" },
  subContextLimit: { kind: "unchanged" },
  subMaxOutputTokens: { kind: "unchanged" },
  subTemperature: { kind: "unchanged" },
  subMaxIterations: { kind: "unchanged" },
  subTimeoutMs: { kind: "unchanged" },
};

type FieldOutcome =
  | { ok: true; value: number | null | undefined }
  | { ok: false };

/**
 * Map a FieldState to the IPC payload value, distinguishing parse
 * failures from explicit clears. The "set" kind requires a parseable
 * number; if the user typed garbage, return ok:false so the form
 * surfaces a validation error instead of silently submitting `null`
 * (which would CLEAR the key — codex DRIFT #1).
 */
function fieldToPayload(
  state: FieldState,
  parser: (raw: string) => number | null,
): FieldOutcome {
  if (state.kind === "unchanged") return { ok: true, value: undefined };
  if (state.kind === "clear") return { ok: true, value: null };
  const parsed = parser(state.raw.trim());
  if (parsed === null) return { ok: false };
  return { ok: true, value: parsed };
}

function parseInteger(raw: string): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatStrict(raw: string): number | null {
  if (raw.length === 0) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

type BuildResult =
  | { ok: true; input: AgentCoreConfigureInput }
  | { ok: false; invalidLabels: string[] };

const FIELD_LABELS: Record<keyof FormState, string> = {
  contextLimit: "Agent context limit",
  maxOutputTokens: "Agent max output tokens",
  temperature: "Agent temperature",
  subMaxConcurrent: "SUBAGENT_MAX_CONCURRENT",
  subContextLimit: "SUBAGENT_CONTEXT_LIMIT",
  subMaxOutputTokens: "SUBAGENT_MAX_OUTPUT_TOKENS",
  subTemperature: "SUBAGENT_TEMPERATURE",
  subMaxIterations: "SUBAGENT_MAX_ITERATIONS",
  subTimeoutMs: "SUBAGENT_TIMEOUT_MS",
};

function buildPayload(form: FormState): BuildResult {
  const invalid: string[] = [];

  const collect = <K extends keyof FormState>(
    key: K,
    parser: (raw: string) => number | null,
  ): number | null | undefined => {
    const outcome = fieldToPayload(form[key], parser);
    if (!outcome.ok) {
      invalid.push(FIELD_LABELS[key]);
      return undefined;
    }
    return outcome.value;
  };

  const ctxLimit = collect("contextLimit", parseInteger);
  const maxOut = collect("maxOutputTokens", parseInteger);
  const temp = collect("temperature", parseFloatStrict);
  const subMaxConc = collect("subMaxConcurrent", parseInteger);
  const subCtx = collect("subContextLimit", parseInteger);
  const subMaxOut = collect("subMaxOutputTokens", parseInteger);
  const subTemp = collect("subTemperature", parseFloatStrict);
  const subMaxIter = collect("subMaxIterations", parseInteger);
  const subTimeout = collect("subTimeoutMs", parseInteger);

  if (invalid.length > 0) return { ok: false, invalidLabels: invalid };

  const subagent: NonNullable<AgentCoreConfigureInput["subagent"]> = {};
  let subagentTouched = false;
  if (subMaxConc !== undefined) {
    subagent.maxConcurrent = subMaxConc as never;
    subagentTouched = true;
  }
  if (subCtx !== undefined) {
    subagent.contextLimit = subCtx as never;
    subagentTouched = true;
  }
  if (subMaxOut !== undefined) {
    subagent.maxOutputTokens = subMaxOut as never;
    subagentTouched = true;
  }
  if (subTemp !== undefined) {
    subagent.temperature = subTemp as never;
    subagentTouched = true;
  }
  if (subMaxIter !== undefined) {
    subagent.maxIterations = subMaxIter as never;
    subagentTouched = true;
  }
  if (subTimeout !== undefined) {
    subagent.timeoutMs = subTimeout as never;
    subagentTouched = true;
  }

  const input: AgentCoreConfigureInput = {
    ...(ctxLimit !== undefined ? { contextLimit: ctxLimit } : {}),
    ...(maxOut !== undefined ? { maxOutputTokens: maxOut } : {}),
    ...(temp !== undefined ? { temperature: temp } : {}),
    ...(subagentTouched ? { subagent } : {}),
  };
  return { ok: true, input };
}

function pendingSummary(form: FormState): { sets: number; clears: number } {
  let sets = 0;
  let clears = 0;
  for (const state of Object.values(form)) {
    if (state.kind === "set" && state.raw.trim().length > 0) sets += 1;
    else if (state.kind === "clear") clears += 1;
  }
  return { sets, clears };
}

interface NumericRowProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly hint?: string;
  readonly state: FieldState;
  readonly onChange: (next: FieldState) => void;
  readonly defaultLabel: string;
}

function NumericRow({
  id,
  label,
  placeholder,
  hint,
  state,
  onChange,
  defaultLabel,
}: NumericRowProps): JSX.Element {
  const value = state.kind === "set" ? state.raw : "";
  const cleared = state.kind === "clear";
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          disabled={cleared}
          onChange={(e) =>
            onChange(
              e.target.value.length === 0
                ? { kind: "unchanged" }
                : { kind: "set", raw: e.target.value },
            )
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange(state.kind === "clear" ? { kind: "unchanged" } : { kind: "clear" })
          }
        >
          {cleared ? "Undo reset" : "Reset"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {cleared
          ? `Will clear on save → ${defaultLabel}`
          : (hint ?? `Default: ${defaultLabel}`)}
      </p>
    </div>
  );
}

export function AgentCoreStep({
  completedSteps,
  onAdvance,
}: AgentCoreStepProps): JSX.Element {
  const setWizardState = useSetWizardState();
  const configure = useAgentCoreConfigure();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [showSubagent, setShowSubagent] = useState(false);
  const [serverError, setServerError] = useState<{
    message: string;
    violation?: string;
  } | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const summary = pendingSummary(form);

  const advanceToProvider = useCallback(async () => {
    setAdvanceError(null);
    const next = nextWizardStateFor({
      completedSteps,
      current: "agentCore",
      next: "provider",
    });
    const result = await setWizardState.mutateAsync(next);
    if (!result.ok) {
      setAdvanceError(result.error.message);
      return;
    }
    onAdvance("provider");
  }, [completedSteps, setWizardState, onAdvance]);

  const [clientError, setClientError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setServerError(null);
      setClientError(null);
      const built = buildPayload(form);
      if (!built.ok) {
        setClientError(
          `Invalid value for: ${built.invalidLabels.join(", ")}. ` +
            `Use the Reset button to clear a field instead of typing non-numeric input.`,
        );
        return;
      }
      const result = await configure.mutateAsync(built.input);
      if (!result.ok) {
        const violation =
          typeof result.error.details?.violation === "string"
            ? result.error.details.violation
            : undefined;
        setServerError({
          message: result.error.message,
          ...(violation !== undefined ? { violation } : {}),
        });
        return;
      }
      await advanceToProvider();
    },
    [form, configure, advanceToProvider],
  );

  const submitting = configure.isPending || setWizardState.isPending;

  return (
    <Card className="w-full max-w-2xl" data-vex-wizard-agentcore="form">
      <CardHeader>
        <CardTitle>Agent core tuning</CardTitle>
        <CardDescription>
          All optional. Defaults work for most flows. Changes apply
          when the agent restarts (next session start).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          aria-live="polite"
          className="mb-4 flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
        >
          <span>
            Pending changes: <strong>{summary.sets}</strong> set,{" "}
            <strong>{summary.clears}</strong> cleared.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setForm(INITIAL)}
            disabled={submitting || (summary.sets === 0 && summary.clears === 0)}
          >
            Reset all
          </Button>
        </div>
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          noValidate
          className="flex flex-col gap-5"
        >
          <NumericRow
            id="vex-agent-context"
            label="Agent context limit"
            placeholder={`${AGENT_CONTEXT_LIMIT.default ?? ""}`}
            hint={`Range ${AGENT_CONTEXT_LIMIT.min}–${AGENT_CONTEXT_LIMIT.max}.`}
            defaultLabel={String(AGENT_CONTEXT_LIMIT.default ?? "engine default")}
            state={form.contextLimit}
            onChange={(next) => setForm({ ...form, contextLimit: next })}
          />
          <NumericRow
            id="vex-agent-maxout"
            label="Agent max output tokens"
            placeholder={`${AGENT_MAX_OUTPUT_TOKENS.default ?? ""}`}
            hint={`Range ${AGENT_MAX_OUTPUT_TOKENS.min}–${AGENT_MAX_OUTPUT_TOKENS.max}. Must be ≤ context limit.`}
            defaultLabel={String(AGENT_MAX_OUTPUT_TOKENS.default ?? "engine default")}
            state={form.maxOutputTokens}
            onChange={(next) => setForm({ ...form, maxOutputTokens: next })}
          />
          <NumericRow
            id="vex-agent-temp"
            label="Agent temperature"
            placeholder="leave empty for provider default (~0.7)"
            hint={`Range ${AGENT_TEMPERATURE.min}–${AGENT_TEMPERATURE.max}. Empty = provider default.`}
            defaultLabel="provider default"
            state={form.temperature}
            onChange={(next) => setForm({ ...form, temperature: next })}
          />

          <details
            open={showSubagent}
            onToggle={(e) => setShowSubagent((e.target as HTMLDetailsElement).open)}
            className="rounded-md border border-border p-3"
          >
            <summary className="cursor-pointer text-sm font-medium">
              Advanced: subagent tuning
            </summary>
            <div className="mt-4 flex flex-col gap-4">
              <NumericRow
                id="vex-sub-concurrent"
                label="SUBAGENT_MAX_CONCURRENT"
                placeholder={`${SUBAGENT_MAX_CONCURRENT.default}`}
                hint={`Range ${SUBAGENT_MAX_CONCURRENT.min}–${SUBAGENT_MAX_CONCURRENT.max}.`}
                defaultLabel={String(SUBAGENT_MAX_CONCURRENT.default ?? "")}
                state={form.subMaxConcurrent}
                onChange={(next) => setForm({ ...form, subMaxConcurrent: next })}
              />
              <NumericRow
                id="vex-sub-context"
                label="SUBAGENT_CONTEXT_LIMIT"
                placeholder={`${SUBAGENT_CONTEXT_LIMIT.default}`}
                hint={`Range ${SUBAGENT_CONTEXT_LIMIT.min}–${SUBAGENT_CONTEXT_LIMIT.max}.`}
                defaultLabel={String(SUBAGENT_CONTEXT_LIMIT.default ?? "")}
                state={form.subContextLimit}
                onChange={(next) => setForm({ ...form, subContextLimit: next })}
              />
              <NumericRow
                id="vex-sub-maxout"
                label="SUBAGENT_MAX_OUTPUT_TOKENS"
                placeholder="inherits AGENT_MAX_OUTPUT_TOKENS"
                hint={`Range ${SUBAGENT_MAX_OUTPUT_TOKENS.min}–${SUBAGENT_MAX_OUTPUT_TOKENS.max}. Must be ≤ subagent context.`}
                defaultLabel="inherits agent.maxOutputTokens"
                state={form.subMaxOutputTokens}
                onChange={(next) => setForm({ ...form, subMaxOutputTokens: next })}
              />
              <NumericRow
                id="vex-sub-temp"
                label="SUBAGENT_TEMPERATURE"
                placeholder="inherits AGENT_TEMPERATURE"
                hint={`Range ${SUBAGENT_TEMPERATURE.min}–${SUBAGENT_TEMPERATURE.max}.`}
                defaultLabel="inherits agent.temperature"
                state={form.subTemperature}
                onChange={(next) => setForm({ ...form, subTemperature: next })}
              />
              <NumericRow
                id="vex-sub-iter"
                label="SUBAGENT_MAX_ITERATIONS"
                placeholder={`${SUBAGENT_MAX_ITERATIONS.default}`}
                hint={`Range ${SUBAGENT_MAX_ITERATIONS.min}–${SUBAGENT_MAX_ITERATIONS.max}.`}
                defaultLabel={String(SUBAGENT_MAX_ITERATIONS.default ?? "")}
                state={form.subMaxIterations}
                onChange={(next) => setForm({ ...form, subMaxIterations: next })}
              />
              <NumericRow
                id="vex-sub-timeout"
                label="SUBAGENT_TIMEOUT_MS"
                placeholder={`${SUBAGENT_TIMEOUT_MS.default}`}
                hint={`Range ${SUBAGENT_TIMEOUT_MS.min}–${SUBAGENT_TIMEOUT_MS.max} (5 min default).`}
                defaultLabel={String(SUBAGENT_TIMEOUT_MS.default ?? "")}
                state={form.subTimeoutMs}
                onChange={(next) => setForm({ ...form, subTimeoutMs: next })}
              />
            </div>
          </details>

          {clientError ? (
            <p className="text-sm text-destructive" role="alert">
              {clientError}
            </p>
          ) : null}

          {serverError ? (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">{serverError.message}</p>
              {serverError.violation === "max_output_exceeds_context" ? (
                <p className="mt-1 text-xs">
                  Lower max output tokens, or raise context limit.
                </p>
              ) : null}
              {serverError.violation === "subagent_max_output_exceeds_subagent_context" ? (
                <p className="mt-1 text-xs">
                  Either raise the subagent context limit, or lower the
                  effective subagent max output tokens (set explicitly
                  via the field above).
                </p>
              ) : null}
            </div>
          ) : null}

          {advanceError ? (
            <p className="text-sm text-destructive" role="alert">
              {advanceError}
            </p>
          ) : null}

          <div className="flex justify-end gap-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save and continue"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
