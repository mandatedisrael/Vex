/**
 * Pendle quote extraction — verdict matrices (impact / liquidity / expiry) and
 * the typed term-lock emission for a buy.
 */

import { describe, it, expect } from "vitest";

import { extractPendleQuote } from "@vex-agent/tools/protocols/prequote/safety/extract.js";

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
const PARAMS = { amountIn: "100", slippageBps: 50 };

function data(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "swap",
    direction: "buy",
    chainId: 1,
    tokenIn: { address: "0xaaa" },
    tokenOut: { address: "0xbbb" },
    pt: "0xbbb",
    yt: "0xccc",
    market: "0xddd",
    receiver: "0xeee",
    expiry: FUTURE,
    liquidityUsd: 3_000_000,
    priceImpact: -0.0002,
    ...over,
  };
}

describe("extractPendleQuote — verdicts", () => {
  it("healthy buy (deep liquidity, tiny impact, future expiry) → pass + termLock", () => {
    const e = extractPendleQuote(PARAMS, data())!;
    expect(e.verdict).toBe("pass");
    expect(e.direction).toBe("buy");
    expect((e.safetyDetail.termLock as { maturityIso: string }).maturityIso).toBe(new Date(FUTURE).toISOString());
  });

  it("buy into an EXPIRED market → fail (the only hard block)", () => {
    const e = extractPendleQuote(PARAMS, data({ expiry: PAST }))!;
    expect(e.verdict).toBe("fail");
    expect(e.safetyDetail.termLock).toBeUndefined();
  });

  it("buy with thin liquidity → unknown (never a silent pass)", () => {
    const e = extractPendleQuote(PARAMS, data({ liquidityUsd: 1000 }))!;
    expect(e.verdict).toBe("unknown");
  });

  it("buy with high price impact → unknown (magnitude, sign ignored)", () => {
    const e = extractPendleQuote(PARAMS, data({ priceImpact: -0.09 }))!;
    expect(e.verdict).toBe("unknown");
    expect((e.safetyDetail.priceImpact as { high: boolean }).high).toBe(true);
  });

  it("missing liquidity + impact → unknown", () => {
    const e = extractPendleQuote(PARAMS, data({ liquidityUsd: null, priceImpact: null }))!;
    expect(e.verdict).toBe("unknown");
  });

  it("early-exit SELL has no expiry gate and no termLock", () => {
    const e = extractPendleQuote(PARAMS, data({ direction: "sell", tokenIn: { address: "0xbbb" }, tokenOut: { address: "0xaaa" } }))!;
    expect(e.verdict).toBe("pass");
    expect(e.safetyDetail.termLock).toBeUndefined();
  });

  it("redeem action surfaces action=redeem for the recorder dispatch", () => {
    const e = extractPendleQuote(PARAMS, data({ action: "redeem", direction: "redeem" }))!;
    expect(e.action).toBe("redeem");
  });

  it("returns null on a missing amount or malformed data", () => {
    expect(extractPendleQuote({}, data())).toBeNull();
    expect(extractPendleQuote(PARAMS, { nonsense: true })).toBeNull();
  });
});
