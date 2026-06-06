/**
 * Jupiter Prediction `positions` response schemas (codex-002).
 */

import { z } from "zod";
import { paginationSchema, positionSchema } from "./_shared.js";

// ── Positions ──────────────────────────────────────────────────────

export const jupiterPredictionPositionResponseSchema = positionSchema;

export const jupiterPredictionPositionsResponseSchema = z
  .object({
    data: z.array(positionSchema),
    pagination: paginationSchema,
  })
  .passthrough();
