/**
 * Jupiter Prediction `orderbook` / trading-status response schemas (codex-002).
 */

import { z } from "zod";

// ── Orderbook / Trading status ─────────────────────────────────────

const orderbookLevelSchema = z.tuple([z.number(), z.number()]);
const orderbookDollarLevelSchema = z.tuple([z.string(), z.number()]);

export const jupiterPredictionOrderbookResponseSchema = z
  .object({
    yes: z.array(orderbookLevelSchema),
    no: z.array(orderbookLevelSchema),
    yes_dollars: z.array(orderbookDollarLevelSchema),
    no_dollars: z.array(orderbookDollarLevelSchema),
  })
  .passthrough()
  .nullable();

export const jupiterPredictionTradingStatusResponseSchema = z
  .object({ trading_active: z.boolean() })
  .passthrough();
