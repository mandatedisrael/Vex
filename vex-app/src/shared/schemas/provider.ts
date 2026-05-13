/**
 * Schemas for `vex.onboarding.providerPersist` — Wizard Step 6 (M10).
 *
 * Single IPC that does verify-then-persist atomically (codex turn 2
 * RED #1): handler tests the OpenRouter key+model via a 1-shot chat
 * completion, then writes 3 .env keys (OPENROUTER_API_KEY +
 * AGENT_MODEL + AGENT_PROVIDER=openrouter) via the batch writer
 * `appendMultipleToDotenvFile`. If verify fails, no persist happens.
 *
 * Input validation:
 *   - `.trim().min(1).max(200)` for apiKey + model (codex turn 1 RED #4
 *     — whitespace-only bypass on plain `.min(1)`).
 *   - `provider` literal "openrouter" only.
 *
 * Output:
 *   - `fieldsWritten` in canonical order (matches engine resolution
 *     precedence in `src/vex-agent/inference/registry.ts:41-108` —
 *     explicit AGENT_PROVIDER overrides fallback).
 *   - `verifiedLatencyMs` from the verify step, surfaced in the
 *     success card.
 */

import { z } from "zod";

export const providerNameSchema = z.enum(["openrouter"]);
export type ProviderName = z.infer<typeof providerNameSchema>;

const trimmedSecret = z.string().trim().min(1).max(200);

export const providerPersistInputSchema = z
  .object({
    provider: z.literal("openrouter"),
    apiKey: trimmedSecret,
    model: trimmedSecret,
  })
  .strict();

export type ProviderPersistInput = z.infer<typeof providerPersistInputSchema>;

/**
 * Canonical .env keys written by `providerPersist` (M10). Order
 * matches the deterministic write order in `provider-writer.ts`.
 * Engine resolution precedence (`registry.ts:41-108`):
 *   1. Explicit `AGENT_PROVIDER` value
 *   2. `OPENROUTER_API_KEY` + `AGENT_MODEL` present → openrouter
 * Writing all 3 keys ensures GUI's wizard choice is unambiguous even
 * when stale `AGENT_PROVIDER` lines exist from prior CLI use or manual
 * edits.
 */
export const PROVIDER_PERSIST_CANONICAL_ORDER = [
  "OPENROUTER_API_KEY",
  "AGENT_MODEL",
  "AGENT_PROVIDER",
] as const;

export const providerPersistFieldNameSchema = z.enum(
  PROVIDER_PERSIST_CANONICAL_ORDER,
);

export const providerPersistResultSchema = z
  .object({
    fieldsWritten: z.array(providerPersistFieldNameSchema).readonly(),
    verifiedLatencyMs: z.number().int().nonnegative(),
  })
  .strict();

export type ProviderPersistResult = z.infer<typeof providerPersistResultSchema>;
