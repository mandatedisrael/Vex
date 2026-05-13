import { describe, it, expect } from "vitest";
import { parseInstrumentKey } from "../../../vex-agent/sync/instrument-key.js";

describe("parseInstrumentKey", () => {
  it("solana spot: solana:{mint}", () => {
    const r = parseInstrumentKey("solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(r.kind).toBe("spot");
    expect(r.chain).toBe("solana");
    expect(r.tokenAddress).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  it("solana prediction: solana:predict:{marketId}:{side}", () => {
    const r = parseInstrumentKey("solana:predict:abc123:yes");
    expect(r.kind).toBe("prediction");
    expect(r.chain).toBe("solana");
    expect(r.marketId).toBe("abc123");
    expect(r.side).toBe("yes");
  });

  it("polymarket prediction: polymarket:{conditionId}:{outcome}", () => {
    const r = parseInstrumentKey("polymarket:0xabc:YES");
    expect(r.kind).toBe("prediction");
    expect(r.chain).toBe("polygon");
    expect(r.marketId).toBe("0xabc");
    expect(r.side).toBe("YES");
  });

  it("KyberSwap EVM spot: ethereum:{addr}", () => {
    const r = parseInstrumentKey("ethereum:0xWETH");
    expect(r.kind).toBe("spot");
    expect(r.chain).toBe("ethereum");
    expect(r.tokenAddress).toBe("0xWETH");
  });

  it("LP: {slug}:lp:{pool}", () => {
    const r = parseInstrumentKey("ethereum:lp:0xPool");
    expect(r.kind).toBe("lp");
    expect(r.chain).toBe("ethereum");
  });

  it("limit order: {slug}:lo:{maker}:{taker}", () => {
    const r = parseInstrumentKey("polygon:lo:0xMaker:0xTaker");
    expect(r.kind).toBe("limit_order");
    expect(r.chain).toBe("polygon");
  });

  it("unknown format", () => {
    const r = parseInstrumentKey("weird");
    expect(r.kind).toBe("unknown");
  });
});
