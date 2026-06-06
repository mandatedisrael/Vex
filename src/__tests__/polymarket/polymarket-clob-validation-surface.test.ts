/**
 * Compatibility-barrel surface test for `tools/polymarket/clob/validation.ts`
 * after the structural split into the nested `./validation/` subdirectory
 * (orders / trades / prices / scoring / batch, with shared lenient primitives
 * in `_shared`).
 *
 * Pins the EXACT runtime export set of the barrel (the 20 `validate*`
 * functions) plus each export's `typeof`, so a caller importing from the old
 * path (`@tools/polymarket/clob/validation.js`, consumed by `./client.ts`)
 * sees no difference. Behavior equivalence is covered separately by
 * `polymarket-clob-validation-equivalence.test.ts`.
 */

import { describe, expect, it } from "vitest";

type ValidationMod = typeof import("@tools/polymarket/clob/validation.js");

describe("polymarket clob validation barrel surface", () => {
  it("exposes exactly the expected 20 runtime exports with correct typeof", async () => {
    const mod: ValidationMod = await import("@tools/polymarket/clob/validation.js");

    const keys = Object.keys(mod).sort();
    expect(keys).toEqual([
      "validateBatchLastTradesPricesResponse",
      "validateBatchMidpointsResponse",
      "validateBatchOrderBooksResponse",
      "validateBatchPricesResponse",
      "validateBatchSpreadsResponse",
      "validateCancelResponse",
      "validateFeeRateResponse",
      "validateLastTradePriceResponse",
      "validateMidpointResponse",
      "validateOpenOrder",
      "validateOrderBookResponse",
      "validateOrderScoringResponse",
      "validatePaginatedOrders",
      "validatePaginatedTrades",
      "validatePriceHistoryResponse",
      "validatePriceResponse",
      "validateSendOrderResponse",
      "validateSendOrdersResponse",
      "validateSpreadResponse",
      "validateTickSizeResponse",
    ]);

    for (const key of keys) {
      expect(typeof mod[key as keyof ValidationMod]).toBe("function");
    }
  });
});
