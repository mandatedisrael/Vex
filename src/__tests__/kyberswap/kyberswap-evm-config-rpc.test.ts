/**
 * DEFAULT_RPC — regression coverage for the plasma/megaeth dead-endpoint fix
 * (verified live, chainId-matched 2026-07-19).
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_RPC } from "@tools/kyberswap/evm/config.js";

describe("DEFAULT_RPC", () => {
  it("uses the live plasma RPC endpoint", () => {
    expect(DEFAULT_RPC.plasma).toBe("https://rpc.plasma.to");
  });

  it("uses the live megaeth RPC endpoint", () => {
    expect(DEFAULT_RPC.megaeth).toBe("https://mainnet.megaeth.com/rpc");
  });
});
