/**
 * Façade-surface guard for the Polymarket CLOB manifest structural split (A-036).
 *
 * `src/vex-agent/tools/protocols/polymarket/manifests/clob.ts` was split into
 * per-resource chunk modules under `./clob/` (markets / orders / account by
 * toolId prefix) while the original path stays a compatibility façade that
 * re-assembles the SAME single `CLOB_TOOLS` export.
 *
 * The original array is INTERLEAVED in its authenticated tail, and that array
 * ORDER is OBSERVABLE (the protocol catalog registers tools by iteration
 * order). This test pins the EXACT ordered `CLOB_TOOLS.map(t => t.toolId)`
 * sequence so a later edit to the chunk modules or the façade spread cannot
 * silently reorder, drop, or add a manifest. Per-tool field semantics
 * (mutating, requiresEnv, descriptions) are covered by
 * `polymarket-manifest.test.ts`; here we only pin the ordered surface.
 */

import { describe, it, expect } from "vitest";

import { CLOB_TOOLS } from "../../../../vex-agent/tools/protocols/polymarket/manifests/clob.js";

describe("polymarket CLOB manifest façade — ordered surface (A-036 split pin)", () => {
  it("CLOB_TOOLS preserves the EXACT original element order (byte-identical toolId sequence)", () => {
    expect(CLOB_TOOLS.map((t) => t.toolId)).toEqual([
      // markets head (1–15)
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
      "polymarket.clob.batchPriceHistory",
      "polymarket.clob.serverTime",
      "polymarket.clob.tickSize",
      "polymarket.clob.feeRate",
      // orders core (16–22)
      "polymarket.clob.buy",
      "polymarket.clob.sell",
      "polymarket.clob.cancel",
      "polymarket.clob.cancelAll",
      "polymarket.clob.cancelMarket",
      "polymarket.clob.orders",
      "polymarket.clob.order",
      // interleaved tail (23–28)
      "polymarket.clob.trades",
      "polymarket.clob.simplifiedMarkets",
      "polymarket.clob.rebates",
      "polymarket.clob.heartbeat",
      "polymarket.clob.cancelOrders",
      "polymarket.clob.orderScoring",
    ]);
  });

  it("CLOB_TOOLS has exactly 28 manifests", () => {
    expect(CLOB_TOOLS).toHaveLength(28);
  });
});
