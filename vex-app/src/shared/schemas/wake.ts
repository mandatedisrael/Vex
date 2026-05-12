/**
 * Schemas for `vex.onboarding.wakeSet` — Wizard Step 8 (M11).
 *
 * Discriminated by `enabled`. When the operator turns wake off, the
 * writer DELETES the interval/batch keys in the same atomic mutation
 * that flips `AGENT_WAKE_ENABLED` to "false" — keeps `.env` consistent
 * with the runtime semantic that disabled wake has no schedule
 * (codex v2 RED on stale-key drift).
 *
 * Ranges mirror `local/vex-shell/wizard/wake-step.ts:43,56`:
 *   intervalMs ∈ [60, 60000]
 *   batchSize  ∈ [1, 100]
 *
 * Engine consumption is wired now (M11) via
 * `src/mcp/wake-config.ts`, so the toggle has real runtime effect on
 * the next MCP startup.
 */

import { z } from "zod";

const WAKE_INTERVAL_MIN = 60;
const WAKE_INTERVAL_MAX = 60_000;
const WAKE_BATCH_MIN = 1;
const WAKE_BATCH_MAX = 100;

export const WAKE_DEFAULT_INTERVAL_MS = 2000;
export const WAKE_DEFAULT_BATCH_SIZE = 10;

export const wakeSetInputSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(false),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(true),
      intervalMs: z
        .number()
        .int()
        .min(WAKE_INTERVAL_MIN)
        .max(WAKE_INTERVAL_MAX),
      batchSize: z
        .number()
        .int()
        .min(WAKE_BATCH_MIN)
        .max(WAKE_BATCH_MAX),
    })
    .strict(),
]);

export type WakeSetInput = z.infer<typeof wakeSetInputSchema>;

export const WAKE_ENV_KEYS = [
  "AGENT_WAKE_ENABLED",
  "AGENT_WAKE_INTERVAL_MS",
  "AGENT_WAKE_BATCH_SIZE",
] as const;
export type WakeEnvKey = (typeof WAKE_ENV_KEYS)[number];

export const wakeEnvKeySchema = z.enum(WAKE_ENV_KEYS);

export const wakeSetResultSchema = z
  .object({
    fieldsWritten: z.array(wakeEnvKeySchema).readonly(),
    fieldsDeleted: z.array(wakeEnvKeySchema).readonly(),
  })
  .strict();

export type WakeSetResult = z.infer<typeof wakeSetResultSchema>;

/**
 * envState slice. `coherent` is the skip-card gate: enabled=true
 * additionally requires interval + batch to parse inside the canonical
 * range; otherwise renderer pre-fills the form rather than skipping.
 */
export const wakeStateSchema = z
  .object({
    enabled: z.boolean(),
    intervalMs: z.number().int().nullable(),
    batchSize: z.number().int().nullable(),
    coherent: z.boolean(),
  })
  .strict();

export type WakeState = z.infer<typeof wakeStateSchema>;

export const WAKE_RANGES = {
  intervalMin: WAKE_INTERVAL_MIN,
  intervalMax: WAKE_INTERVAL_MAX,
  batchMin: WAKE_BATCH_MIN,
  batchMax: WAKE_BATCH_MAX,
} as const;
