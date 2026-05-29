/**
 * codex-002 boundary gates for the Jupiter Price API V3 response schema.
 *
 * Price data is not directly signed, but downstream valuation/portfolio math
 * consumes `usdPrice` and `decimals` as real numbers, so the schema firms those
 * invariants (present + finite number) while accepting forward-compatible extra
 * fields and the empty `{}` response (a missing mint is a domain `found:false`,
 * not a malformed shape).
 */

import { describe, expect, it } from "vitest";
import { jupiterPriceResponseSchema } from "../jupiter-prices/schemas.js";

const MINT = "So11111111111111111111111111111111111111112";

function validEntry(): Record<string, unknown> {
  return {
    createdAt: "2024-06-05T08:55:25.527Z",
    liquidity: 621679197.67,
    usdPrice: 147.48,
    blockId: 348004023,
    decimals: 9,
    priceChange24h: 1.29,
  };
}

function validResponse(): Record<string, unknown> {
  return { [MINT]: validEntry() };
}

describe("jupiterPriceResponseSchema", () => {
  it("accepts a valid price response, including unknown forward-compat fields", () => {
    const r = jupiterPriceResponseSchema.safeParse({
      [MINT]: { ...validEntry(), someFutureField: { x: 1 } },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data[MINT]?.usdPrice).toBe(147.48);
  });

  it("accepts an empty object (no mint priced — service maps to found:false)", () => {
    expect(jupiterPriceResponseSchema.safeParse({}).success).toBe(true);
  });

  it("accepts nullable blockId / priceChange24h", () => {
    expect(
      jupiterPriceResponseSchema.safeParse({
        [MINT]: { ...validEntry(), blockId: null, priceChange24h: null },
      }).success,
    ).toBe(true);
  });

  it("rejects a missing usdPrice", () => {
    const { usdPrice: _omit, ...rest } = validEntry();
    expect(jupiterPriceResponseSchema.safeParse({ [MINT]: rest }).success).toBe(false);
  });

  it("rejects a non-numeric usdPrice", () => {
    expect(
      jupiterPriceResponseSchema.safeParse({ [MINT]: { ...validEntry(), usdPrice: "147.48" } })
        .success,
    ).toBe(false);
  });

  it("rejects a non-finite usdPrice", () => {
    expect(
      jupiterPriceResponseSchema.safeParse({
        [MINT]: { ...validEntry(), usdPrice: Number.POSITIVE_INFINITY },
      }).success,
    ).toBe(false);
  });

  it("rejects a missing decimals", () => {
    const { decimals: _omit, ...rest } = validEntry();
    expect(jupiterPriceResponseSchema.safeParse({ [MINT]: rest }).success).toBe(false);
  });

  it("rejects a non-numeric decimals", () => {
    expect(
      jupiterPriceResponseSchema.safeParse({ [MINT]: { ...validEntry(), decimals: "9" } }).success,
    ).toBe(false);
  });

  it("rejects an entry that is not an object", () => {
    expect(jupiterPriceResponseSchema.safeParse({ [MINT]: "147.48" }).success).toBe(false);
  });

  it("rejects a present-but-malformed entry while a sibling is valid", () => {
    expect(
      jupiterPriceResponseSchema.safeParse({
        ...validResponse(),
        BAD: { ...validEntry(), usdPrice: null },
      }).success,
    ).toBe(false);
  });
});
