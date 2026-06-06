/**
 * Façade-surface guard for the Polymarket CLOB structural split (A-032).
 *
 * `src/vex-agent/tools/protocols/polymarket/handlers-clob.ts` was split into
 * per-concern modules under `./handlers-clob/` (helpers, markets, orders,
 * account) while the original path stays a compatibility façade that
 * re-assembles the grouped handlers into the SAME `CLOB_HANDLERS` Record with
 * the SAME key names. This test pins the EXACT public runtime surface so a
 * later edit cannot silently drop, rename, or add a handler key. The behavior
 * of each handler is covered by `polymarket-handlers.test.ts`; here we only
 * assert presence + runtime typeof of each handler value + the exact export-key
 * set of the façade module + the exact `CLOB_HANDLERS` key set (all 28).
 */

import { describe, it, expect } from "vitest";

import * as clobFacade from "../../../vex-agent/tools/protocols/polymarket/handlers-clob.js";

// Type-only import must compile against the façade re-export. The façade
// exports only the `CLOB_HANDLERS` value; we pin its runtime shape and rely on
// `tsc --noEmit` to reject signature drift.
import { CLOB_HANDLERS } from "../../../vex-agent/tools/protocols/polymarket/handlers-clob.js";

describe("polymarket clob façade — public surface", () => {
  it("module exports EXACTLY the expected runtime keys — no more, no less", () => {
    const keys = Object.keys(clobFacade).sort();
    expect(keys).toEqual(["CLOB_HANDLERS"].sort());
  });

  it("CLOB_HANDLERS is the named re-export, identity-equal to the namespace import", () => {
    expect(typeof CLOB_HANDLERS).toBe("object");
    expect(CLOB_HANDLERS).not.toBeNull();
    expect(clobFacade.CLOB_HANDLERS).toBe(CLOB_HANDLERS);
  });

  it("CLOB_HANDLERS exposes EXACTLY the 28 expected handler keys — no more, no less", () => {
    const keys = Object.keys(CLOB_HANDLERS).sort();
    expect(keys).toEqual(
      [
        // markets (public market-data)
        "polymarket.clob.orderbook",
        "polymarket.clob.orderbooks",
        "polymarket.clob.price",
        "polymarket.clob.prices",
        "polymarket.clob.midpoint",
        "polymarket.clob.midpoints",
        "polymarket.clob.spread",
        "polymarket.clob.spreads",
        "polymarket.clob.lastTrade",
        "polymarket.clob.lastTrades",
        "polymarket.clob.priceHistory",
        "polymarket.clob.tickSize",
        "polymarket.clob.feeRate",
        "polymarket.clob.serverTime",
        "polymarket.clob.simplifiedMarkets",
        "polymarket.clob.batchPriceHistory",
        // orders (order/trading)
        "polymarket.clob.buy",
        "polymarket.clob.sell",
        "polymarket.clob.cancel",
        "polymarket.clob.cancelOrders",
        "polymarket.clob.cancelAll",
        "polymarket.clob.cancelMarket",
        "polymarket.clob.orders",
        "polymarket.clob.order",
        // account (authenticated account)
        "polymarket.clob.trades",
        "polymarket.clob.rebates",
        "polymarket.clob.heartbeat",
        "polymarket.clob.orderScoring",
      ].sort(),
    );
  });

  it("CLOB_HANDLERS has exactly 28 keys", () => {
    expect(Object.keys(CLOB_HANDLERS)).toHaveLength(28);
  });

  it("every CLOB_HANDLERS value is a handler function", () => {
    for (const [name, handler] of Object.entries(CLOB_HANDLERS)) {
      expect(typeof handler, `handler for ${name}`).toBe("function");
    }
  });
});
