/**
 * Schemas for `vex.onboarding.modeSet` — Wizard Step 7 (M11).
 *
 * Discriminated union by `mode`. Mission requires both an initial prompt
 * (≥ 5 chars after trim, mirrors vex-shell `mode-step.ts:54`) and an
 * explicit loop mode. Full-autonomous accepts an optional seed prompt.
 * Chat needs no extras.
 *
 * Trim is applied BEFORE min/max so a payload of `"     "` cannot bypass
 * the `min(5)` rule on mission goals (codex turn 5 catch carried into M11).
 *
 * Engine consumption is deferred to a future milestone — Phase 1 wizard
 * persists into `~/.vex/.env` so a later engine read picks the values up.
 * Only the wake portion of M11 is wired into the current MCP boot path
 * (see `src/mcp/wake-config.ts`).
 */

import { z } from "zod";

export const wizardModeValueSchema = z.enum([
  "chat",
  "mission",
  "full_autonomous",
]);
export type WizardModeValue = z.infer<typeof wizardModeValueSchema>;

export const loopModeSchema = z.enum(["off", "restricted", "full"]);
export type LoopMode = z.infer<typeof loopModeSchema>;

const trimmedNonEmpty = z.string().trim().min(1);
const missionPrompt = z.string().trim().min(5).max(5000);
const optionalPrompt = z.string().trim().max(5000);

export const modeSetInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("chat"),
    })
    .strict(),
  z
    .object({
      mode: z.literal("mission"),
      initialPrompt: missionPrompt,
      loopMode: loopModeSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("full_autonomous"),
      initialPrompt: optionalPrompt.optional(),
    })
    .strict(),
]);

export type ModeSetInput = z.infer<typeof modeSetInputSchema>;

/**
 * Canonical .env keys touched by mode-writer. Order matches the
 * deterministic write order so log lines + tests can assert the same
 * sequence regardless of which discriminator branch ran.
 */
export const MODE_ENV_KEYS = [
  "AGENT_MODE",
  "AGENT_LOOP_MODE",
  "AGENT_INITIAL_PROMPT",
] as const;
export type ModeEnvKey = (typeof MODE_ENV_KEYS)[number];

export const modeEnvKeySchema = z.enum(MODE_ENV_KEYS);

export const modeSetResultSchema = z
  .object({
    fieldsWritten: z.array(modeEnvKeySchema).readonly(),
    fieldsDeleted: z.array(modeEnvKeySchema).readonly(),
  })
  .strict();

export type ModeSetResult = z.infer<typeof modeSetResultSchema>;

/**
 * envState slice for Mode (renderer skip-card decision). All fields
 * are populated by `mode-state.ts` from the same parsed view of `.env`
 * — `selected` / `loopMode` / `initialPrompt` are only `null` when
 * the underlying value is missing OR violates the canonical contract
 * (per codex v3 NEEDS-WORK on D13: presence is too weak; require
 * coherent state).
 */
export const modeStateSchema = z
  .object({
    selected: wizardModeValueSchema.nullable(),
    loopMode: loopModeSchema.nullable(),
    hasInitialPrompt: z.boolean(),
    /**
     * `true` iff the .env values together satisfy the same shape the
     * IPC contract requires. Mission requires loopMode + initialPrompt.
     * Full-autonomous accepts initialPrompt missing. Chat needs no
     * extras. Used by the wizard skip-card.
     */
    coherent: z.boolean(),
  })
  .strict();

export type ModeState = z.infer<typeof modeStateSchema>;

// Re-export so tests + writers share the trimmed-secret token.
export const trimmedNonEmptyToken = trimmedNonEmpty;
