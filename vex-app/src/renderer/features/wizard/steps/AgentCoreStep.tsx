/**
 * Wizard Step 5 — Agent core tuning (M9; PR6 redesign — glass; V2
 * refactor: form helpers and NumericRow moved to `agent-core/` so
 * this file stays under the 400-LOC scalability ceiling).
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
import { type WizardStepId } from "@shared/schemas/wizard.js";

import { Button } from "../../../components/ui/button.js";
import {
  useStepAdvance,
  type WizardFlowMode,
} from "../../../lib/api/wizard.js";
import { useAgentCoreConfigure } from "../../../lib/api/agent-core.js";
import { WIZARD_STEP_META } from "../wizard-icons.js";
import { WizardStepPanel } from "../WizardStepPanel.js";
import { NumericRow } from "./agent-core/NumericRow.js";
import {
  buildPayload,
  INITIAL_FORM_STATE,
  pendingSummary,
  type FormState,
} from "./agent-core/form-state.js";

export interface AgentCoreStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
  readonly flowMode: WizardFlowMode;
}

export function AgentCoreStep({
  completedSteps,
  onAdvance,
  flowMode,
}: AgentCoreStepProps): JSX.Element {
  const stepAdvance = useStepAdvance();
  const configure = useAgentCoreConfigure();

  const [form, setForm] = useState<FormState>(INITIAL_FORM_STATE);
  const [showSubagent, setShowSubagent] = useState(false);
  const [serverError, setServerError] = useState<{
    message: string;
    violation?: string;
  } | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const summary = pendingSummary(form);

  const advanceToProvider = useCallback(async () => {
    setAdvanceError(null);
    const result = await stepAdvance.advance({
      flowMode,
      completedSteps,
      current: "agentCore",
      forwardNext: "provider",
      onAdvance,
    });
    if (!result.ok) setAdvanceError(result.message);
  }, [stepAdvance, flowMode, completedSteps, onAdvance]);

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

  const submitting = configure.isPending || stepAdvance.isPending;
  const meta = WIZARD_STEP_META.agentCore;

  return (
    <WizardStepPanel
      panelDataAttr={{ kind: "agentcore", value: "form" }}
      icon={meta.icon}
      title="Agent core tuning"
      description="All optional. Defaults work for most flows. Changes apply when the agent restarts (next session start)."
      formProps={{
        onSubmit: (e) => {
          void onSubmit(e);
        },
        noValidate: true,
      }}
      footer={
        <Button type="submit" disabled={submitting}>
          {submitting
            ? "Saving…"
            : flowMode === "back-edit"
              ? "Save and return to review"
              : "Save and continue"}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div
          aria-live="polite"
          className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
            Pending ·{" "}
            <strong className="text-[var(--color-text-primary)]">
              {summary.sets}
            </strong>{" "}
            set ·{" "}
            <strong className="text-[var(--color-text-primary)]">
              {summary.clears}
            </strong>{" "}
            cleared
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setForm(INITIAL_FORM_STATE)}
            disabled={submitting || (summary.sets === 0 && summary.clears === 0)}
          >
            Reset all
          </Button>
        </div>

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
          defaultLabel={String(
            AGENT_MAX_OUTPUT_TOKENS.default ?? "engine default",
          )}
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
          onToggle={(e) =>
            setShowSubagent((e.target as HTMLDetailsElement).open)
          }
          className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3"
        >
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-text-primary)]">
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
              onChange={(next) =>
                setForm({ ...form, subMaxOutputTokens: next })
              }
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
              onChange={(next) =>
                setForm({ ...form, subMaxIterations: next })
              }
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
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {clientError}
          </p>
        ) : null}

        {serverError ? (
          <div
            role="alert"
            className="rounded-md border border-[color-mix(in_oklab,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] p-3 text-sm text-[var(--color-danger)]"
          >
            <p className="font-medium">{serverError.message}</p>
            {serverError.violation === "max_output_exceeds_context" ? (
              <p className="mt-1 text-xs">
                Lower max output tokens, or raise context limit.
              </p>
            ) : null}
            {serverError.violation ===
            "subagent_max_output_exceeds_subagent_context" ? (
              <p className="mt-1 text-xs">
                Either raise the subagent context limit, or lower the
                effective subagent max output tokens (set explicitly
                via the field above).
              </p>
            ) : null}
          </div>
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
