/**
 * Pendle redeem identity hash — deterministic, venue-bound, and NEVER colliding
 * with a swap or bridge identity (G2#3). The term-lock is NOT part of the
 * identity (it lives in safetyDetail).
 */

import { describe, it, expect } from "vitest";

import {
  computePrequoteMatchHash,
  type RedeemMatchInput,
  type SwapMatchInput,
} from "@vex-agent/tools/protocols/prequote/identity/hash.js";

const REDEEM: RedeemMatchInput = {
  kind: "redeem",
  sessionId: "s1",
  provider: "pendle",
  chainId: 1,
  walletAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
  ptAddress: "0x1a69154f6f6247e4457332860fb173251a36e03f",
  ytAddress: "0x8a9e90fe18e9d243f804022224fbd8380d6b76f6",
  amount: "100",
  receiver: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
};

describe("redeem identity hash", () => {
  it("is deterministic and case-insensitive on addresses / amount", () => {
    const a = computePrequoteMatchHash(REDEEM);
    const b = computePrequoteMatchHash({
      ...REDEEM,
      walletAddress: REDEEM.walletAddress.toUpperCase(),
      ptAddress: REDEEM.ptAddress.toUpperCase(),
      amount: "100.0",
    });
    expect(a).toBe(b);
  });

  it("changes when the PT, YT, amount, receiver, wallet, or provider changes", () => {
    const base = computePrequoteMatchHash(REDEEM);
    expect(computePrequoteMatchHash({ ...REDEEM, ptAddress: "0x0000000000000000000000000000000000000001" })).not.toBe(base);
    expect(computePrequoteMatchHash({ ...REDEEM, ytAddress: "0x0000000000000000000000000000000000000002" })).not.toBe(base);
    expect(computePrequoteMatchHash({ ...REDEEM, amount: "101" })).not.toBe(base);
    expect(computePrequoteMatchHash({ ...REDEEM, receiver: "0x0000000000000000000000000000000000000003" })).not.toBe(base);
    expect(computePrequoteMatchHash({ ...REDEEM, provider: "notpendle" })).not.toBe(base);
  });

  it("NEVER collides with a swap identity over the same tokens/amount", () => {
    const swap: SwapMatchInput = {
      kind: "swap",
      sessionId: "s1",
      family: "eip155",
      provider: "pendle",
      chainId: 1,
      walletAddress: REDEEM.walletAddress,
      tokenIn: REDEEM.ptAddress,
      tokenOut: REDEEM.ytAddress,
      amount: "100",
      recipient: REDEEM.receiver,
      approveExact: false,
      slippageBps: "",
    };
    expect(computePrequoteMatchHash(REDEEM)).not.toBe(computePrequoteMatchHash(swap));
  });
});
