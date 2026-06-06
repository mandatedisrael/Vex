/**
 * Jupiter Prediction `trades` response schemas (codex-002).
 */

import { z } from "zod";

// ── Trades ─────────────────────────────────────────────────────────

const tradeSchema = z
  .object({
    id: z.number(),
    ownerPubkey: z.string(),
    marketId: z.string(),
    message: z.string(),
    timestamp: z.number(),
    action: z.string(),
    side: z.string(),
    eventTitle: z.string(),
    marketTitle: z.string(),
    amountUsd: z.string(),
    priceUsd: z.string(),
    eventImageUrl: z.string(),
    eventId: z.string(),
  })
  .passthrough();

export const jupiterPredictionTradesResponseSchema = z
  .object({ data: z.array(tradeSchema) })
  .passthrough();
