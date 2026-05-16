/**
 * AgentCoreStep form-state helpers — extracted from
 * `AgentCoreStep.tsx` to keep the screen file under the 400-LOC
 * scalability ceiling (V2 refactor).
 *
 * The form models each tunable field as a discriminated union:
 *
 *   - `{ kind: "unchanged" }` — no edit; .env keeps its current value
 *   - `{ kind: "set", raw: string }` — submitted as a parsed number
 *   - `{ kind: "clear" }` — submitted as `null`, REMOVED from .env
 *     (engine falls back to its compile-time default)
 *
 * The distinction matters: a parse failure must NOT silently turn
 * into a `null` (which would CLEAR the key — codex DRIFT #1).
 * `fieldToPayload` returns `ok: false` on parse failure so the
 * caller surfaces a validation error instead of submitting.
 *
 * Pure module — no React imports, fully unit-testable, no JSX.
 */

import type { AgentCoreConfigureInput } from "@shared/schemas/agent-core.js";

export type FieldState =
  | { readonly kind: "unchanged" }
  | { readonly kind: "set"; readonly raw: string }
  | { readonly kind: "clear" };

export interface FormState {
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

export const INITIAL_FORM_STATE: FormState = {
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

export function parseInteger(raw: string): number | null {
  if (!/^-?\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseFloatStrict(raw: string): number | null {
  if (raw.length === 0) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export type BuildResult =
  | { ok: true; input: AgentCoreConfigureInput }
  | { ok: false; invalidLabels: string[] };

export const FIELD_LABELS: Record<keyof FormState, string> = {
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

export function buildPayload(form: FormState): BuildResult {
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

export function pendingSummary(form: FormState): {
  sets: number;
  clears: number;
} {
  let sets = 0;
  let clears = 0;
  for (const state of Object.values(form)) {
    if (state.kind === "set" && state.raw.trim().length > 0) sets += 1;
    else if (state.kind === "clear") clears += 1;
  }
  return { sets, clears };
}
