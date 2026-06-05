/**
 * Façade-surface guard for the KyberSwap zap structural split (A-030).
 *
 * `src/vex-agent/tools/protocols/kyberswap/handlers/zap.ts` was split into
 * per-operation modules under `./zap/` (helpers, in, out, migrate, list) while
 * the original path stays a compatibility façade that assembles the
 * per-operation handlers into the SAME `ZAP_HANDLERS` Record with the SAME key
 * names. This test pins the EXACT public runtime surface so a later edit cannot
 * silently drop, rename, or add a handler key. The behavior of each handler is
 * covered by `kyberswap-handlers.test.ts`; here we only assert presence +
 * runtime typeof of each handler value + the exact export-key set of the façade
 * module + the exact `ZAP_HANDLERS` key set.
 */

import { describe, it, expect } from "vitest";

import * as zapFacade from "../../../vex-agent/tools/protocols/kyberswap/handlers/zap.js";

// Type-only import must compile against the façade re-export. The façade
// exports only the `ZAP_HANDLERS` value; we pin its runtime shape and rely on
// `tsc --noEmit` to reject signature drift.
import { ZAP_HANDLERS } from "../../../vex-agent/tools/protocols/kyberswap/handlers/zap.js";

describe("kyberswap zap façade — public surface", () => {
  it("module exports EXACTLY the expected runtime keys — no more, no less", () => {
    const keys = Object.keys(zapFacade).sort();
    expect(keys).toEqual(["ZAP_HANDLERS"].sort());
  });

  it("ZAP_HANDLERS is the named re-export, identity-equal to the namespace import", () => {
    expect(typeof ZAP_HANDLERS).toBe("object");
    expect(ZAP_HANDLERS).not.toBeNull();
    expect(zapFacade.ZAP_HANDLERS).toBe(ZAP_HANDLERS);
  });

  it("ZAP_HANDLERS exposes EXACTLY the expected handler keys — no more, no less", () => {
    const keys = Object.keys(ZAP_HANDLERS).sort();
    expect(keys).toEqual(
      [
        "kyberswap.zap.in",
        "kyberswap.zap.out",
        "kyberswap.zap.migrate",
        "kyberswap.zap.list",
      ].sort(),
    );
  });

  it("every ZAP_HANDLERS value is a handler function", () => {
    for (const [name, handler] of Object.entries(ZAP_HANDLERS)) {
      expect(typeof handler, `handler for ${name}`).toBe("function");
    }
  });
});
