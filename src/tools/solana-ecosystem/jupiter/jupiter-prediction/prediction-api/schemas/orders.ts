/**
 * Jupiter Prediction `orders` response schemas (codex-002).
 */

import { z } from "zod";
import { orderSchema, paginationSchema } from "./_shared.js";

// ── Orders ─────────────────────────────────────────────────────────

export const jupiterPredictionOrderResponseSchema = orderSchema;

export const jupiterPredictionOrdersResponseSchema = z
  .object({
    data: z.array(orderSchema),
    pagination: paginationSchema,
  })
  .passthrough();

const orderStatusHistoryItemSchema = z
  .object({
    eventType: z.string(),
    status: z.string(),
    rawStatus: z.string(),
    timestamp: z.number(),
    signature: z.string(),
    externalOrderId: z.string(),
    orderId: z.string(),
  })
  .passthrough();

export const jupiterPredictionOrderStatusResponseSchema = z
  .object({
    orderPubkey: z.string(),
    status: z.string(),
    latestEventType: z.string(),
    latestSignature: z.string(),
    externalOrderId: z.string(),
    orderId: z.string(),
    history: z.array(orderStatusHistoryItemSchema),
  })
  .passthrough();
