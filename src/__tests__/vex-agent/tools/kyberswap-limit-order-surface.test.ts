/**
 * Façade-surface guard for the KyberSwap limit-order structural split (A-031).
 *
 * `src/vex-agent/tools/protocols/kyberswap/handlers/limit-order.ts` was split
 * into per-operation modules under `./limit-order/` (helpers, read, create,
 * cancel, fill) while the original path stays a compatibility façade that
 * assembles the per-operation handlers into the SAME `LIMIT_ORDER_HANDLERS`
 * Record with the SAME key names. This test pins the EXACT public runtime
 * surface so a later edit cannot silently drop, rename, or add a handler key.
 * The behavior of each handler is covered by `kyberswap-handlers.test.ts`; here
 * we only assert presence + runtime typeof of each handler value + the exact
 * export-key set of the façade module + the exact `LIMIT_ORDER_HANDLERS` key
 * set.
 */

import { describe, it, expect } from "vitest";

import * as limitOrderFacade from "../../../vex-agent/tools/protocols/kyberswap/handlers/limit-order.js";

// Type-only import must compile against the façade re-export. The façade
// exports only the `LIMIT_ORDER_HANDLERS` value; we pin its runtime shape and
// rely on `tsc --noEmit` to reject signature drift.
import { LIMIT_ORDER_HANDLERS } from "../../../vex-agent/tools/protocols/kyberswap/handlers/limit-order.js";

describe("kyberswap limit-order façade — public surface", () => {
  it("module exports EXACTLY the expected runtime keys — no more, no less", () => {
    const keys = Object.keys(limitOrderFacade).sort();
    expect(keys).toEqual(["LIMIT_ORDER_HANDLERS"].sort());
  });

  it("LIMIT_ORDER_HANDLERS is the named re-export, identity-equal to the namespace import", () => {
    expect(typeof LIMIT_ORDER_HANDLERS).toBe("object");
    expect(LIMIT_ORDER_HANDLERS).not.toBeNull();
    expect(limitOrderFacade.LIMIT_ORDER_HANDLERS).toBe(LIMIT_ORDER_HANDLERS);
  });

  it("LIMIT_ORDER_HANDLERS exposes EXACTLY the expected handler keys — no more, no less", () => {
    const keys = Object.keys(LIMIT_ORDER_HANDLERS).sort();
    expect(keys).toEqual(
      [
        "kyberswap.limitOrder.list",
        "kyberswap.limitOrder.activeMakingAmount",
        "kyberswap.limitOrder.create",
        "kyberswap.limitOrder.cancel",
        "kyberswap.limitOrder.hardCancel",
        "kyberswap.limitOrder.pairs",
        "kyberswap.limitOrder.takerOrders",
        "kyberswap.limitOrder.fill",
        "kyberswap.limitOrder.batchFill",
        "kyberswap.limitOrder.cancelAll",
      ].sort(),
    );
  });

  it("every LIMIT_ORDER_HANDLERS value is a handler function", () => {
    for (const [name, handler] of Object.entries(LIMIT_ORDER_HANDLERS)) {
      expect(typeof handler, `handler for ${name}`).toBe("function");
    }
  });
});
