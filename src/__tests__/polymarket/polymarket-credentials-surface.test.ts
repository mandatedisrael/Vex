/**
 * Compatibility-façade surface test for `wallet/polymarket-credentials.ts` after
 * the structural split into `./polymarket-credentials/` modules (auth / acquire /
 * api-key / parse / derive).
 *
 * Pins the EXACT runtime export set of the façade + each export's typeof, so a
 * caller importing from the old path (`@tools/wallet/polymarket-credentials.js`,
 * re-exported by src/lib/polymarket.ts via @vex-lib, and consumed by
 * polymarket/credential-map + vex-agent polymarket-setup) sees no difference.
 * Type-only imports of the exported types must also compile against the façade.
 */

import { describe, expect, it } from "vitest";

// Type-only imports of the 3 exported types must compile against the façade.
type _Derive = import("@tools/wallet/polymarket-credentials.js").DeriveResult;
type _Acquired =
  import("@tools/wallet/polymarket-credentials.js").AcquiredPolymarketCredentials;
type _AcquireResult =
  import("@tools/wallet/polymarket-credentials.js").AcquireResult;

type CredsMod = typeof import("@tools/wallet/polymarket-credentials.js");

describe("polymarket-credentials façade surface", () => {
  it("exposes exactly the expected runtime exports with correct typeof", async () => {
    const credsMod: CredsMod = await import(
      "@tools/wallet/polymarket-credentials.js"
    );

    // The exact set of RUNTIME export keys (the 3 types are erased at runtime).
    const keys = Object.keys(credsMod).sort();
    expect(keys).toEqual([
      "acquirePolymarketCredentialsWithPassword",
      "deriveAndSavePolymarketCredentials",
    ]);

    expect(typeof credsMod.acquirePolymarketCredentialsWithPassword).toBe(
      "function",
    );
    expect(typeof credsMod.deriveAndSavePolymarketCredentials).toBe("function");

    // Keep the type-only imports referenced so they are not elided as unused.
    const _typeProbe: ReadonlyArray<_Derive | _Acquired | _AcquireResult> = [];
    void _typeProbe;
    // Import-bound: cold-transforming the heavy viem/solana module graph under
    // vitest exceeds the 10s default. Bundled at runtime, so this is test-only.
  }, 30_000);
});
