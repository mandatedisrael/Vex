/**
 * Façade-surface guard for the register-handler structural split. Pins the
 * EXACT set of RUNTIME exports of `../register-handler.js` (functions only —
 * the HandlerContext / HandlerArgs interfaces erase at runtime) and asserts
 * the public type surface still compiles via type-only imports.
 *
 * Trust-boundary note: this file is the single safe IPC registration wrapper
 * with 56 importers. The split moved sender validation, error-shape
 * normalisation, and the cancel registry into sibling leaf modules; the
 * façade must keep re-exporting `getCancelController` /
 * `__resetCancelRegistryForTests` (consumed by `cancel.ts`) and the
 * `registerHandler` orchestrator unchanged.
 */

import { describe, expect, it } from "vitest";
import * as registerHandlerModule from "../register-handler.js";
// Type-only imports: these must compile or the public type surface drifted.
import type {
  HandlerContext,
  HandlerArgs,
} from "../register-handler.js";

describe("register-handler façade surface", () => {
  it("exposes exactly the documented runtime exports with correct typeof", () => {
    const expected = {
      getCancelController: "function",
      __resetCancelRegistryForTests: "function",
      registerHandler: "function",
    } as const;

    for (const [name, kind] of Object.entries(expected)) {
      expect(
        typeof (registerHandlerModule as Record<string, unknown>)[name],
      ).toBe(kind);
    }

    // Pin the EXACT set of runtime export keys (HandlerContext / HandlerArgs
    // are compile-time only, so they do not appear here).
    expect(Object.keys(registerHandlerModule).sort()).toEqual(
      Object.keys(expected).sort(),
    );
  });

  it("preserves the exported type surface (compile-time guard)", () => {
    // Referencing each exported type forces a compile error if any were
    // dropped or renamed. Values are constructed only to anchor the types.
    const ctx: HandlerContext = {
      requestId: "req",
      event: {} as HandlerContext["event"],
      signal: new AbortController().signal,
    };
    const handlerArgs: HandlerArgs<{ readonly a: number }, { readonly b: string }> = {
      channel: "vex:test:surface",
      domain: "system",
      inputSchema: {} as HandlerArgs<
        { readonly a: number },
        { readonly b: string }
      >["inputSchema"],
      handle: async () => ({ ok: true as const, data: { b: "x" } }),
    };

    expect(ctx.requestId).toBe("req");
    expect(ctx.signal.aborted).toBe(false);
    expect(handlerArgs.channel).toBe("vex:test:surface");
    expect(handlerArgs.domain).toBe("system");
  });
});
