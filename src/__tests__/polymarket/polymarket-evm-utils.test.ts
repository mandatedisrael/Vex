import { describe, it, expect, vi } from "vitest";
import { approveUsdce, validatePolySpender } from "@tools/polymarket/evm-utils.js";
import { CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE } from "@tools/polymarket/constants.js";
import { ErrorCodes, VexError } from "../../errors.js";

describe("validatePolySpender", () => {
  it("accepts CTF_EXCHANGE", () => {
    expect(() => validatePolySpender(CTF_EXCHANGE)).not.toThrow();
  });

  it("accepts NEG_RISK_CTF_EXCHANGE", () => {
    expect(() => validatePolySpender(NEG_RISK_CTF_EXCHANGE)).not.toThrow();
  });

  it("accepts case variations", () => {
    expect(() => validatePolySpender(CTF_EXCHANGE.toLowerCase() as `0x${string}`)).not.toThrow();
  });

  it("throws for unknown address", () => {
    expect(() => validatePolySpender("0x0000000000000000000000000000000000000001")).toThrow(VexError);
    expect(() => validatePolySpender("0x0000000000000000000000000000000000000001")).toThrow(/not a known Polymarket contract/);
  });
});

describe("approveUsdce receipt status", () => {
  const token = "0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b" as `0x${string}`;
  const owner = "0x1111111111111111111111111111111111111111" as `0x${string}`;
  const hash = `0x${"ab".repeat(32)}` as `0x${string}`;

  it("does not send the follow-up approval after a reverted reset", async () => {
    const publicClient = {
      readContract: vi.fn().mockResolvedValue(1n),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "reverted" }),
    };
    const walletClient = { account: { address: owner }, writeContract: vi.fn().mockResolvedValue(hash) };

    await expect(
      approveUsdce(publicClient as never, walletClient as never, token, CTF_EXCHANGE, 100n, true),
    ).rejects.toMatchObject({ code: ErrorCodes.APPROVAL_FAILED });
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
  });
});
