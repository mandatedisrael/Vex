/**
 * Jupiter Prediction `events` response schemas (codex-002).
 */

import { z } from "zod";
import { eventSchema, paginationSchema } from "./_shared.js";

// ── Events ─────────────────────────────────────────────────────────

export const jupiterPredictionEventSchema = eventSchema;

export const jupiterPredictionEventsResponseSchema = z
  .object({
    data: z.array(eventSchema),
    pagination: paginationSchema,
  })
  .passthrough();

export const jupiterPredictionSearchEventsResponseSchema = z
  .object({ data: z.array(eventSchema) })
  .passthrough();

export const jupiterPredictionSuggestedEventsResponseSchema = z
  .object({ data: z.array(eventSchema) })
  .passthrough();
