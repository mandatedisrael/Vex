/**
 * Compatibility barrel for the Polymarket CLOB runtime validators.
 *
 * The implementation was structurally split into the nested `./validation/`
 * subdirectory (grouped by resource: orders / trades / prices / scoring /
 * batch, with shared lenient primitives in `_shared`). This barrel preserves
 * the ORIGINAL import path and re-exports the IDENTICAL set of 20 `validate*`
 * functions, so callers (e.g. `./client.ts`) are unaffected.
 *
 * codex-002 Phase 2: these gate the SHAPE of CLOB market-data, order, and
 * trade responses at the HTTP boundary (the values feed pricing, order, and
 * cancel flows). The CLOB API is LENIENT-DEFAULTING: every field falls back to
 * a safe default rather than rejecting, so a single malformed field never fails
 * the whole response. Schema failure is reserved for a root-type mismatch
 * (object expected but array/null given, or array expected but object given) —
 * the wrapper then throws the SAME plain `Error` the hand-written code threw;
 * the price/midpoint/scoring/batch validators that defaulted on a bad root keep
 * defaulting (no throw).
 *
 * The schemas are intentionally NOT the type source of truth — the wire
 * interfaces in `types.ts` remain canonical, and each exported validator keeps
 * its declared return type so `tsc` verifies the inferred schema output is
 * assignable to that interface.
 */

export {
  validateOrderBookResponse,
  validateSendOrderResponse,
  validatePaginatedOrders,
  validateOpenOrder,
  validateCancelResponse,
} from "./validation/orders.js";

export { validatePaginatedTrades } from "./validation/trades.js";

export {
  validatePriceHistoryResponse,
  validatePriceResponse,
  validateMidpointResponse,
  validateSpreadResponse,
  validateLastTradePriceResponse,
  validateTickSizeResponse,
  validateFeeRateResponse,
} from "./validation/prices.js";

export { validateOrderScoringResponse } from "./validation/scoring.js";

export {
  validateSendOrdersResponse,
  validateBatchOrderBooksResponse,
  validateBatchPricesResponse,
  validateBatchMidpointsResponse,
  validateBatchSpreadsResponse,
  validateBatchLastTradesPricesResponse,
} from "./validation/batch.js";
