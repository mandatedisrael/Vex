/**
 * KyberSwap limit order handlers — maker + taker operations.
 *
 * Structural split (A-031): the per-operation handlers + the shared duration
 * helper now live under `./limit-order/` (helpers, read, create, cancel, fill).
 * This file stays a compatibility façade assembling the per-operation handlers
 * into the SAME `LIMIT_ORDER_HANDLERS` Record with the SAME key names —
 * preserving the registry coupling (the spread in `kyberswap/handlers.ts`).
 */

import type { ProtocolHandler } from "../../types.js";
import {
  limitOrderList,
  limitOrderActiveMakingAmount,
  limitOrderPairs,
  limitOrderTakerOrders,
} from "./limit-order/read.js";
import { limitOrderCreate } from "./limit-order/create.js";
import {
  limitOrderCancel,
  limitOrderHardCancel,
  limitOrderCancelAll,
} from "./limit-order/cancel.js";
import { limitOrderFill, limitOrderBatchFill } from "./limit-order/fill.js";

// ── Handler map ──────────────────────────────────────────────────

export const LIMIT_ORDER_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Limit Orders (Maker) ─────────────────────────────────────────
  "kyberswap.limitOrder.list": limitOrderList,
  "kyberswap.limitOrder.activeMakingAmount": limitOrderActiveMakingAmount,
  "kyberswap.limitOrder.create": limitOrderCreate,
  "kyberswap.limitOrder.cancel": limitOrderCancel,
  "kyberswap.limitOrder.hardCancel": limitOrderHardCancel,
  // ── Limit Orders (Taker) ─────────────────────────────────────────
  "kyberswap.limitOrder.pairs": limitOrderPairs,
  "kyberswap.limitOrder.takerOrders": limitOrderTakerOrders,
  "kyberswap.limitOrder.fill": limitOrderFill,
  "kyberswap.limitOrder.batchFill": limitOrderBatchFill,
  "kyberswap.limitOrder.cancelAll": limitOrderCancelAll,
};
