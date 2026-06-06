/**
 * Compatibility-surface test for `tools/polymarket/clob/client.ts` after the
 * structural split that moved the stateless HTTP shaping helpers into the
 * nested `./client/` subdirectory (`./client/http.ts`). The class, all public
 * endpoint methods, and the singleton stay in `client.ts`.
 *
 * Pins the EXACT runtime export set of the original path (the `PolyClobClient`
 * class + the `getPolyClobClient` factory) plus each export's `typeof`, so
 * callers importing from `@tools/polymarket/clob/client.js` (the clob handlers
 * and credential flows) see no difference. The `ClobAuthContext` interface is
 * type-only — it erases at runtime, so it is verified by a compile-only type
 * assertion rather than a runtime key.
 */

import { describe, expect, it } from "vitest";

type ClientMod = typeof import("@tools/polymarket/clob/client.js");
type ClobAuthContext = import("@tools/polymarket/clob/client.js").ClobAuthContext;

// Compile-only assertion that the type-only `ClobAuthContext` export still
// exists with its declared shape (erased at runtime — see surface comment).
type _AssertClobAuthContext = ClobAuthContext extends { address: string } ? true : never;
const _clobAuthContextExported: _AssertClobAuthContext = true;
void _clobAuthContextExported;

describe("polymarket clob client surface", () => {
  it("exposes exactly the expected runtime-value exports with correct typeof", async () => {
    const mod: ClientMod = await import("@tools/polymarket/clob/client.js");

    const keys = Object.keys(mod).sort();
    expect(keys).toEqual(["PolyClobClient", "getPolyClobClient"]);

    expect(typeof mod.PolyClobClient).toBe("function");
    expect(typeof mod.getPolyClobClient).toBe("function");
  }, 30_000);
});
