/**
 * classifyEconomicSide — the recorded trade side must follow the ECONOMIC
 * direction (which way native flows), not which tool was invoked. A token can
 * be bought via `uniswap.swap.sell` (native-in) or sold via `uniswap.swap.buy`
 * (native-out), so the tool's `side` is not a reliable accounting label.
 *
 * A native leg is either the `eth`/`native` sentinel (`isNative`) OR the chain's
 * wrapped-native (WETH) ERC-20 address passed directly — the manifest documents
 * `tokenIn` as "CONTRACT ADDRESS or native ETH", so a WETH-funded buy arrives as
 * a plain ERC-20 leg with `isNative:false`. Both must classify identically.
 */

import { describe, it, expect } from "vitest";
import { classifyEconomicSide } from "@vex-agent/tools/protocols/uniswap/handlers/swap.js";

const WETH = "0x4200000000000000000000000000000000000006";
const TOKEN = "0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b";
const OTHER = "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31";

describe("classifyEconomicSide", () => {
  // ── native → token is always a BUY, regardless of the tool invoked ──────────

  it("native → token = buy via the buy-tool", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: WETH, isNative: true },
        tokenOut: { address: TOKEN, isNative: false },
        wrappedNative: WETH,
        side: "buy",
      }),
    ).toBe("buy");
  });

  it("native → token = buy even when routed via the sell-tool (the bug)", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: WETH, isNative: true },
        tokenOut: { address: TOKEN, isNative: false },
        wrappedNative: WETH,
        side: "sell",
      }),
    ).toBe("buy");
  });

  // ── token → native is always a SELL, regardless of the tool invoked ─────────

  it("token → native = sell via the sell-tool", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: TOKEN, isNative: false },
        tokenOut: { address: WETH, isNative: true },
        wrappedNative: WETH,
        side: "sell",
      }),
    ).toBe("sell");
  });

  it("token → native = sell even when routed via the buy-tool", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: TOKEN, isNative: false },
        tokenOut: { address: WETH, isNative: true },
        wrappedNative: WETH,
        side: "buy",
      }),
    ).toBe("sell");
  });

  // ── token ↔ token has no native anchor: fall back to the tool's side ────────

  it("token → token falls back to the tool side (buy)", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: OTHER, isNative: false },
        tokenOut: { address: TOKEN, isNative: false },
        wrappedNative: WETH,
        side: "buy",
      }),
    ).toBe("buy");
  });

  it("token → token falls back to the tool side (sell)", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: OTHER, isNative: false },
        tokenOut: { address: TOKEN, isNative: false },
        wrappedNative: WETH,
        side: "sell",
      }),
    ).toBe("sell");
  });

  // ── wrapped-native (WETH) ERC-20 address, NOT the sentinel (isNative:false) ──
  // Regression: a WETH-funded spend passed as the contract address must classify
  // by economic direction, not fall back to the tool `side`. Case differences in
  // the address must not defeat the match.

  it("WETH-address in = buy even with isNative:false, routed via the sell-tool", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: WETH.toUpperCase(), isNative: false },
        tokenOut: { address: TOKEN, isNative: false },
        wrappedNative: WETH,
        side: "sell",
      }),
    ).toBe("buy");
  });

  it("WETH-address out = sell even with isNative:false, routed via the buy-tool", () => {
    expect(
      classifyEconomicSide({
        tokenIn: { address: TOKEN, isNative: false },
        tokenOut: { address: WETH.toUpperCase(), isNative: false },
        wrappedNative: WETH,
        side: "buy",
      }),
    ).toBe("sell");
  });
});
