/**
 * Jupiter Prediction `markets` response schemas (codex-002).
 */

import { z } from "zod";
import { marketSchema, paginationSchema } from "./_shared.js";

// ── Markets ────────────────────────────────────────────────────────

export const jupiterPredictionMarketResponseSchema = marketSchema;

export const jupiterPredictionEventMarketsResponseSchema = z
  .object({
    data: z.array(marketSchema),
    pagination: paginationSchema,
  })
  .passthrough();
