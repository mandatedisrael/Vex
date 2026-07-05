/**
 * Pendle tolerant validators — built against the LIVE-probed shapes (fixtures).
 */

import { describe, it, expect } from "vitest";

import {
  validateConvert,
  validateMarkets,
  validatePositions,
  validateAssets,
  stripChainPrefix,
} from "@tools/pendle/validation.js";
import { PENDLE_ROUTER } from "@tools/pendle/constants.js";
import { PENDLE_LIVE_FIXTURES as F } from "./fixtures.js";

describe("stripChainPrefix", () => {
  it("splits a chainId-address id", () => {
    expect(stripChainPrefix("1-0xabc")).toBe("0xabc");
    expect(stripChainPrefix("0xdef")).toBe("0xdef");
    expect(stripChainPrefix(null)).toBeNull();
    expect(stripChainPrefix(123)).toBeNull();
  });
});

describe("validateConvert (from live probes)", () => {
  it("parses a buy (swap) response with the Router tx.to + one approval", () => {
    const r = validateConvert(F.buy);
    expect(r).not.toBeNull();
    expect(r!.action).toBe("swap");
    expect(r!.requiredApprovals).toHaveLength(1);
    expect(r!.routes[0]!.tx.to.toLowerCase()).toBe(PENDLE_ROUTER.toLowerCase());
    expect(r!.routes[0]!.contractParamInfo.method).toBe("swapExactTokenForPt");
    expect(r!.routes[0]!.tx.value).toBeNull();
  });

  it("parses a native buy: empty approvals + non-null tx.value", () => {
    const r = validateConvert(F.native);
    expect(r!.requiredApprovals).toHaveLength(0);
    expect(r!.routes[0]!.tx.value).toBe("1000000000000000000");
  });

  it("parses a redeem-py response with TWO approvals (YT + PT)", () => {
    const r = validateConvert(F.redeem);
    expect(r!.action).toBe("redeem-py");
    expect(r!.requiredApprovals).toHaveLength(2);
    expect(r!.routes[0]!.contractParamInfo.method).toBe("redeemPyToToken");
  });

  it("returns null when there are no usable routes", () => {
    expect(validateConvert({ action: "swap", routes: [] })).toBeNull();
    expect(validateConvert({ nonsense: true })).toBeNull();
    expect(validateConvert(null)).toBeNull();
  });
});

describe("validateMarkets (from live probes)", () => {
  it("normalizes a market and strips the chainId prefix from PT/YT/SY", () => {
    const markets = validateMarkets({ markets: [F.market] });
    expect(markets).toHaveLength(1);
    const m = markets[0]!;
    expect(m.address).toBe(F.market.address);
    expect(m.pt).toBe("0xb253eff1104802b97ac7e3ac9fdd73aece295a2c");
    expect(m.yt).toBe("0x04b7fa1e727d7290d6e24fa9b426d0c940283a95");
    expect(m.details.liquidity).toBeGreaterThan(0);
    expect(m.categoryIds).toContain("eth");
  });

  it("degrades a non-array root to an empty list", () => {
    expect(validateMarkets({ markets: "nope" })).toEqual([]);
    expect(validateMarkets(null)).toEqual([]);
  });
});

describe("validateAssets", () => {
  it("normalizes price.usd + price.acc and strips the id prefix", () => {
    const assets = validateAssets([
      { id: "1-0xpt", chainId: 1, address: "0xPT", symbol: "PT-X", decimals: 18, baseType: "PT", expiry: "2027-01-01T00:00:00.000Z", price: { usd: 0.99, acc: 1 }, priceUpdatedAt: "2026-07-05T00:00:00.000Z" },
      { nonsense: true },
    ]);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.address).toBe("0xPT");
    expect(assets[0]!.priceUsd).toBe(0.99);
    expect(assets[0]!.priceAcc).toBe(1);
    expect(assets[0]!.baseType).toBe("PT");
  });
});

describe("validatePositions", () => {
  it("normalizes per-chain open positions with valuation", () => {
    const out = validatePositions({
      positions: [
        {
          chainId: 1,
          openPositions: [
            { marketId: "1-0xmarket", pt: { balance: "1000000000000000000", valuation: 42 }, yt: null, lp: null },
          ],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.chainId).toBe(1);
    expect(out[0]!.openPositions[0]!.pt!.valuationUsd).toBe(42);
  });
});
