/**
 * Pendle API-independent redeem fallback — redeemPyToSy calldata builder.
 */

import { describe, it, expect } from "vitest";
import { decodeFunctionData, getAddress } from "viem";

import { buildRedeemPyToSyPlan } from "@vex-agent/tools/protocols/pendle/redeem-fallback.js";
import { PENDLE_ROUTER, PENDLE_ROUTER_REDEEM_ABI } from "@tools/pendle/constants.js";
import { ErrorCodes } from "../../../../../errors.js";

const RECEIVER = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
const YT = "0x8a9e90fe18e9d243f804022224fbd8380d6b76f6";

describe("buildRedeemPyToSyPlan", () => {
  it("targets the pinned Router and encodes redeemPyToSy(receiver, YT, netPyIn, minSyOut)", () => {
    const plan = buildRedeemPyToSyPlan({ receiver: RECEIVER, yt: YT, netPyIn: 1_000_000n, slippage: 0.005 });
    expect(plan.to).toBe(PENDLE_ROUTER);
    const decoded = decodeFunctionData({ abi: PENDLE_ROUTER_REDEEM_ABI, data: plan.data });
    expect(decoded.functionName).toBe("redeemPyToSy");
    expect(decoded.args[0]).toBe(getAddress(RECEIVER));
    expect(decoded.args[1]).toBe(getAddress(YT));
    expect(decoded.args[2]).toBe(1_000_000n);
    // minSyOut floored at netPyIn * (1 - 0.5%) = 995000.
    expect(decoded.args[3]).toBe(995_000n);
  });

  it("refuses a non-positive amount", () => {
    try {
      buildRedeemPyToSyPlan({ receiver: RECEIVER, yt: YT, netPyIn: 0n });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCodes.INVALID_AMOUNT);
    }
  });

  it("refuses a tiny amount that would floor minSyOut to zero", () => {
    try {
      buildRedeemPyToSyPlan({ receiver: RECEIVER, yt: YT, netPyIn: 1n, slippage: 0.99 });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCodes.PENDLE_UNSAFE_TX);
    }
  });
});
