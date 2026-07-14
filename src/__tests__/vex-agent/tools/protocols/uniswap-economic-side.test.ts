/**
 * classifyEconomicSide — the recorded trade side must follow the ECONOMIC
 * direction (which way native flows), not which tool was invoked. A token can
 * be bought via `uniswap.swap.sell` (native-in) or sold via `uniswap.swap.buy`
 * (native-out), so the tool's `side` is not a reliable accounting label.
 */

import { describe, it, expect } from "vitest";
import { classifyEconomicSide } from "@vex-agent/tools/protocols/uniswap/handlers/swap.js";

describe("classifyEconomicSide", () => {
  // ── native → token is always a BUY, regardless of the tool invoked ──────────

  it("native → token = buy via the buy-tool", () => {
    expect(classifyEconomicSide({ tokenInIsNative: true, tokenOutIsNative: false, side: "buy" })).toBe("buy");
  });

  it("native → token = buy even when routed via the sell-tool (the bug)", () => {
    expect(classifyEconomicSide({ tokenInIsNative: true, tokenOutIsNative: false, side: "sell" })).toBe("buy");
  });

  // ── token → native is always a SELL, regardless of the tool invoked ─────────

  it("token → native = sell via the sell-tool", () => {
    expect(classifyEconomicSide({ tokenInIsNative: false, tokenOutIsNative: true, side: "sell" })).toBe("sell");
  });

  it("token → native = sell even when routed via the buy-tool", () => {
    expect(classifyEconomicSide({ tokenInIsNative: false, tokenOutIsNative: true, side: "buy" })).toBe("sell");
  });

  // ── token ↔ token has no native anchor: fall back to the tool's side ────────

  it("token → token falls back to the tool side (buy)", () => {
    expect(classifyEconomicSide({ tokenInIsNative: false, tokenOutIsNative: false, side: "buy" })).toBe("buy");
  });

  it("token → token falls back to the tool side (sell)", () => {
    expect(classifyEconomicSide({ tokenInIsNative: false, tokenOutIsNative: false, side: "sell" })).toBe("sell");
  });
});
