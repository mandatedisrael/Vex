/**
 * Models schemas — global model resolution contract.
 *
 * Vex uses a single global model for every session, derived from
 * `AGENT_PROVIDER` + `AGENT_MODEL` in the engine `.env` (loaded into
 * `process.env` after vault unlock). No pricing/context claims yet — a
 * future catalogue fetch could enrich the option metadata further.
 *
 * When the env vars are absent the read-only handler resolves to
 * `models: []` with `source: "unconfigured"`; it never errors. The UI
 * surfaces "Model not configured" instead of an error toast.
 */

import { z } from "zod";
import { reasoningCapabilitySchema } from "./reasoning.js";

export const modelOptionDtoSchema = z
  .object({
    providerId: z.string().min(1).max(64),
    modelId: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    /**
     * Renderer-side brand identifier used by `ModelBrandIcon` /
     * `parseModelProvider`. Mapped from `providerId`; a future OpenRouter
     * catalogue mapper could widen this.
     */
    brand: z.string().min(1).max(64),
    /**
     * Context length in tokens. `null` today — env-derived defaults don't
     * carry catalogue metadata and we deliberately avoid guessing.
     */
    contextLength: z.number().int().positive().nullable(),
    /** USD per 1M input tokens. `null` today (no catalogue fetch). */
    pricingInputPerMillion: z.number().nonnegative().nullable(),
    pricingOutputPerMillion: z.number().nonnegative().nullable(),
    /**
     * Per-model reasoning capability (S6), REQUIRED nullable — the SAME
     * D4-set-normalized shape as `SessionModelDto.reasoning`
     * (`shared/schemas/reasoning.ts`), resolved in main
     * (`main/ipc/models.ts`) via the SAME neutral resolver
     * `sessions.getModel` uses (`main/ipc/reasoning-capability-resolver.ts`)
     * — one resolver, two channels, never a second fallback chain. `null`
     * means "no selector" (non-reasoning model, unconfigured, or capability
     * data unavailable). No `supportsReasoning` boolean here: unlike
     * `SessionModelDto`, this DTO has no legacy consumer depending on that
     * coarse signal.
     */
    reasoning: reasoningCapabilitySchema.nullable(),
  })
  .strict();
export type ModelOptionDto = z.infer<typeof modelOptionDtoSchema>;

export const modelsListAvailableInputSchema = z.object({}).strict();
export type ModelsListAvailableInput = z.infer<
  typeof modelsListAvailableInputSchema
>;

/**
 * `source` tells the renderer where the list came from. Currently only
 * emits `"global_default"` (env-derived single option) or
 * `"unconfigured"` (empty list). A future catalogue fetch could add
 * provider-specific sources.
 */
export const modelsListSourceSchema = z.enum([
  "global_default",
  "unconfigured",
]);
export type ModelsListSource = z.infer<typeof modelsListSourceSchema>;

export const modelsListAvailableResultSchema = z
  .object({
    source: modelsListSourceSchema,
    models: z.array(modelOptionDtoSchema),
    fetchedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type ModelsListAvailableResult = z.infer<
  typeof modelsListAvailableResultSchema
>;
