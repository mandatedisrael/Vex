/**
 * classifyEconomicSide + isEconomicallyNativeLeg — the recorded trade side and
 * native-leg bookkeeping must follow the ECONOMIC direction (which way native
 * value flows), not which tool was invoked and not a sentinel-only address
 * check. A token can be bought via `kyberswap.swap.sell` (native-in) or sold
 * via `kyberswap.swap.buy` (native-out), so the tool's `side` alone is not a
 * reliable accounting label — and a caller passing the WRAPPED-native
 * contract address directly (instead of the "native"/"eth" keyword or the
 * aggregator sentinel) is still economically spending/receiving native value.
 */

import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import {
  classifyEconomicSide,
  isEconomicallyNativeLeg,
  resolveRecordedTradeSide,
} from "@vex-agent/tools/protocols/kyberswap/handlers/swap.js";
import { getKyberWrappedNativeAddress } from "@tools/kyberswap/wrapped-native.js";
import { NATIVE_TOKEN_ADDRESS } from "@tools/kyberswap/constants.js";
import type { KyberChainSlug } from "@tools/kyberswap/types.js";

const ARBITRARY_TOKEN: Address = "0x1111111111111111111111111111111111111111";

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

describe("isEconomicallyNativeLeg", () => {
  it("is true for the aggregator sentinel address on any aggregator chain", () => {
    expect(isEconomicallyNativeLeg("ethereum", { address: NATIVE_TOKEN_ADDRESS, isNative: true })).toBe(true);
    expect(isEconomicallyNativeLeg("mantle", { address: NATIVE_TOKEN_ADDRESS, isNative: true })).toBe(true);
  });

  it("is false for an unrelated ERC-20 address", () => {
    expect(isEconomicallyNativeLeg("ethereum", { address: ARBITRARY_TOKEN, isNative: false })).toBe(false);
  });

  // ── per-chain wrapped-native address recognized even though isNative=false ──
  // (resolveTokenMetadataStrict only sets isNative for the sentinel, so a
  // caller passing the wrapped contract address directly resolves isNative:
  // false — the predicate must still classify it as economically native.)

  const WRAPPED_NATIVE_CASES: ReadonlyArray<{ chain: KyberChainSlug; symbol: string; address: Address }> = [
    { chain: "bsc", symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" },
    { chain: "polygon", symbol: "WPOL", address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270" },
    { chain: "mantle", symbol: "WMNT", address: "0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8" },
    { chain: "sonic", symbol: "wS", address: "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38" },
    { chain: "berachain", symbol: "WBERA", address: "0x6969696969696969696969696969696969696969" },
    { chain: "hyperevm", symbol: "WHYPE", address: "0x5555555555555555555555555555555555555555" },
    { chain: "etherlink", symbol: "WXTZ", address: "0xc9B53AB2679f573e480d01e0f49e2B5CFB7a3EAb" },
    { chain: "monad", symbol: "WMON", address: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" },
    { chain: "avalanche", symbol: "WAVAX", address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7" },
    { chain: "optimism", symbol: "WETH (0x4200…0006)", address: "0x4200000000000000000000000000000000000006" },
  ];

  for (const { chain, symbol, address } of WRAPPED_NATIVE_CASES) {
    it(`recognizes ${symbol} on ${chain} as economically native (isNative=false)`, () => {
      expect(isEconomicallyNativeLeg(chain, { address, isNative: false })).toBe(true);
    });

    it(`in-leg wrapped ${symbol} on ${chain} → buy`, () => {
      const tokenInIsNative = isEconomicallyNativeLeg(chain, { address, isNative: false });
      const tokenOutIsNative = isEconomicallyNativeLeg(chain, { address: ARBITRARY_TOKEN, isNative: false });
      expect(classifyEconomicSide({ tokenInIsNative, tokenOutIsNative, side: "sell" })).toBe("buy");
    });

    it(`out-leg wrapped ${symbol} on ${chain} → sell`, () => {
      const tokenInIsNative = isEconomicallyNativeLeg(chain, { address: ARBITRARY_TOKEN, isNative: false });
      const tokenOutIsNative = isEconomicallyNativeLeg(chain, { address, isNative: false });
      expect(classifyEconomicSide({ tokenInIsNative, tokenOutIsNative, side: "buy" })).toBe("sell");
    });
  }

  it("is case-insensitive on the wrapped-native address", () => {
    const upper = "0xBB4CDB9CBD36B01BD1CBAEBF2DE08D9173BC095C" as Address; // WBNB, uppercased
    expect(isEconomicallyNativeLeg("bsc", { address: upper, isNative: false })).toBe(true);
  });

  it("Mantle bridged WETH (a DIFFERENT asset from WMNT) does NOT classify as native", () => {
    // Mantle's bridged "WETH" is a distinct bridged asset from the chain's own
    // wrapped-native WMNT — same symbol as many unrelated chains' native
    // wrapper, which is exactly why classification must be address-only.
    const mantleBridgedWeth: Address = "0xdEAddEAddEAddEAddEAddEAddEAddEAddEAd1111";
    expect(isEconomicallyNativeLeg("mantle", { address: mantleBridgedWeth, isNative: false })).toBe(false);
  });

  it("throws for a chain with no registered wrapped-native (fail-closed, non-aggregator chain)", () => {
    expect(() => isEconomicallyNativeLeg("scroll", { address: ARBITRARY_TOKEN, isNative: false })).toThrow();
  });
});

describe("resolveRecordedTradeSide — native \u2194 wrapped-native disambiguation", () => {
  // Both legs are economically native here; classifyEconomicSide alone would
  // record every such trade as a buy (in-leg-first rule). The raw sentinel
  // roles must decide instead.

  const sentinelLeg = { address: NATIVE_TOKEN_ADDRESS, isNative: true } as const;

  it("sentinel \u2192 wrapped-native records as a BUY of the wrapper (bsc/WBNB)", () => {
    const wbnb = { address: getKyberWrappedNativeAddress("bsc"), isNative: false } as const;
    expect(resolveRecordedTradeSide("bsc", sentinelLeg, wbnb, "sell")).toBe("buy");
  });

  it("wrapped-native \u2192 sentinel records as a SELL of the wrapper (bsc/WBNB) — the regression", () => {
    const wbnb = { address: getKyberWrappedNativeAddress("bsc"), isNative: false } as const;
    expect(resolveRecordedTradeSide("bsc", wbnb, sentinelLeg, "buy")).toBe("sell");
  });

  it("wrapped-native \u2192 sentinel = SELL regardless of declared side (ethereum/WETH)", () => {
    const weth = { address: getKyberWrappedNativeAddress("ethereum"), isNative: false } as const;
    expect(resolveRecordedTradeSide("ethereum", weth, sentinelLeg, "sell")).toBe("sell");
    expect(resolveRecordedTradeSide("ethereum", weth, sentinelLeg, "buy")).toBe("sell");
  });

  it("wrapped-address casing does not defeat the disambiguation (polygon/WPOL)", () => {
    const wpol = { address: getKyberWrappedNativeAddress("polygon").toUpperCase().replace("0X", "0x") as Address, isNative: false } as const;
    expect(resolveRecordedTradeSide("polygon", wpol, sentinelLeg, "buy")).toBe("sell");
  });

  // Non-both-native paths must be untouched by the disambiguation.

  it("wrapped-native \u2192 arbitrary token still records as a buy-side spend of native value", () => {
    const wbnb = { address: getKyberWrappedNativeAddress("bsc"), isNative: false } as const;
    const token = { address: ARBITRARY_TOKEN, isNative: false } as const;
    expect(resolveRecordedTradeSide("bsc", wbnb, token, "sell")).toBe("buy");
  });

  it("arbitrary token \u2192 wrapped-native still records as a sell", () => {
    const wbnb = { address: getKyberWrappedNativeAddress("bsc"), isNative: false } as const;
    const token = { address: ARBITRARY_TOKEN, isNative: false } as const;
    expect(resolveRecordedTradeSide("bsc", token, wbnb, "buy")).toBe("sell");
  });

  it("token \u2192 token falls through to the declared side", () => {
    const a = { address: ARBITRARY_TOKEN, isNative: false } as const;
    const b = { address: "0x2222222222222222222222222222222222222222" as Address, isNative: false } as const;
    expect(resolveRecordedTradeSide("bsc", a, b, "buy")).toBe("buy");
    expect(resolveRecordedTradeSide("bsc", a, b, "sell")).toBe("sell");
  });
});
