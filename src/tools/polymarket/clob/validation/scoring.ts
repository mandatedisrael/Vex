/**
 * Scoring-resource CLOB validator: order-scoring response. Defaults on a bad
 * root — never throws. Moved verbatim from the original `validation.ts`
 * god-file (codex-002 Phase 2 structural split).
 */

import { z } from "zod";
import type { OrderScoringResponse } from "../types.js";
import { isTrue } from "./_shared.js";

const orderScoringResponseSchema = z.object({ scoring: isTrue });
export function validateOrderScoringResponse(raw: unknown): OrderScoringResponse {
  const parsed = orderScoringResponseSchema.safeParse(raw);
  if (!parsed.success) return { scoring: false };
  return parsed.data;
}
