/**
 * Schemas for `vex.onboarding.agentCoreConfigure` (M9 Step 5).
 *
 * Tri-state per field:
 *   - key absent  → no change to .env (existing value preserved)
 *   - key=number  → set/overwrite in .env
 *   - key=null    → REMOVE the key from .env (engine falls back to
 *                   compile-time default; user "Reset to default")
 *
 * Cross-field validation (maxOutputTokens ≤ contextLimit) runs in
 * the writer using the EFFECTIVE merged config — existing .env ⊕
 * submitted overrides — not just the submitted payload (codex turn 2
 * RED #4).
 *
 * The range/default constants are imported from the shared
 * `src/lib/agent-config.ts` module so engine + GUI share one
 * source of truth (no drift).
 */

import { z } from "zod";
import {
  AGENT_CONTEXT_LIMIT,
  AGENT_MAX_OUTPUT_TOKENS,
  AGENT_TEMPERATURE,
} from "@vex-lib/agent-config.js";

/** "absent | number | null" = "no change | set | clear". */
function intOrClear(min: number, max: number) {
  return z.union([z.number().int().min(min).max(max), z.null()]).optional();
}

function floatOrClear(min: number, max: number) {
  return z.union([z.number().min(min).max(max), z.null()]).optional();
}

export const agentCoreConfigureInputSchema = z
  .object({
    contextLimit: intOrClear(AGENT_CONTEXT_LIMIT.min, AGENT_CONTEXT_LIMIT.max),
    maxOutputTokens: intOrClear(AGENT_MAX_OUTPUT_TOKENS.min, AGENT_MAX_OUTPUT_TOKENS.max),
    temperature: floatOrClear(AGENT_TEMPERATURE.min, AGENT_TEMPERATURE.max),
  })
  .strict();

export type AgentCoreConfigureInput = z.infer<typeof agentCoreConfigureInputSchema>;

export const AGENT_CORE_CANONICAL_ORDER = [
  "AGENT_CONTEXT_LIMIT",
  "AGENT_MAX_OUTPUT_TOKENS",
  "AGENT_TEMPERATURE",
] as const;

export const agentCoreFieldNameSchema = z.enum(AGENT_CORE_CANONICAL_ORDER);

export const agentCoreConfigureResultSchema = z
  .object({
    fieldsWritten: z.array(agentCoreFieldNameSchema).readonly(),
    fieldsCleared: z.array(agentCoreFieldNameSchema).readonly(),
  })
  .strict();

export type AgentCoreConfigureResult = z.infer<typeof agentCoreConfigureResultSchema>;

/**
 * Discriminated detail shape attached to a cross-field-violation
 * `validation.invalid_input` error. Renderer pattern-matches on
 * `violation` to render the right copy.
 */
export const agentCoreViolationSchema = z.enum([
  "max_output_exceeds_context",
]);
export type AgentCoreViolation = z.infer<typeof agentCoreViolationSchema>;
