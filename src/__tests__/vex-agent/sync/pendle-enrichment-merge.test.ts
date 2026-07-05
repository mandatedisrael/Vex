/**
 * Pendle enrichment merge — dedup-by-address precedence:
 *   - a Pendle-priced row WINS over an unpriced Khalani row,
 *   - a Khalani row that already has a price WINS,
 *   - a new Pendle address is added.
 */

import { describe, it, expect } from "vitest";

import { mergePendleRows } from "../../../vex-agent/sync/pendle-enrichment.js";
import type { BalanceRow } from "@vex-agent/db/repos/balances.js";

function row(address: string, priceUsd: number | null): BalanceRow {
  return {
    walletFamily: "eip155",
    walletAddress: "0xwallet",
    chainId: 1,
    tokenAddress: address,
    tokenSymbol: "PT-X",
    tokenName: null,
    balanceRaw: "1000000000000000000",
    balanceUsd: priceUsd,
    priceUsd,
    decimals: 18,
  };
}

const PT = "0x1a69154f6f6247e4457332860fb173251a36e03f";

describe("mergePendleRows", () => {
  it("Pendle-priced row replaces an unpriced Khalani row for the same token", () => {
    const merged = mergePendleRows([row(PT, null)], [row(PT, 0.99)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.priceUsd).toBe(0.99);
  });

  it("a Khalani row that already has a price is authoritative", () => {
    const merged = mergePendleRows([row(PT, 1.0)], [row(PT, 0.5)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.priceUsd).toBe(1.0);
  });

  it("adds a Pendle PT that Khalani did not report at all", () => {
    const merged = mergePendleRows([row("0xother", 1)], [row(PT, 0.99)]);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.tokenAddress.toLowerCase())).toContain(PT.toLowerCase());
  });

  it("dedupes case-insensitively on the token address", () => {
    const merged = mergePendleRows([row(PT.toUpperCase(), null)], [row(PT.toLowerCase(), 0.99)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.priceUsd).toBe(0.99);
  });
});
