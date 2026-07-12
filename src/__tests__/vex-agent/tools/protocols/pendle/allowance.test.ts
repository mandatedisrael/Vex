/**
 * Pendle exact-allowance discipline (Codex fund-safety fix): the Router's
 * allowance is SET to the exact required amount — a stale LARGER allowance is
 * reset to exact (never skipped), a smaller non-zero one is zeroed then set,
 * and only an already-exact allowance is a no-op.
 */

import { describe, it, expect, vi } from "vitest";
import { getAddress } from "viem";

import { ensurePendleAllowanceExact } from "@tools/pendle/erc20.js";
import { PENDLE_ROUTER } from "@tools/pendle/constants.js";
import { ErrorCodes } from "../../../../../errors.js";

const TOKEN = getAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
const OWNER = getAddress("0x742d35cc6634c0532925a3b844bc454e4438f44e");

function makeClients(currentAllowance: bigint) {
  const writeContract = vi.fn().mockResolvedValue("0xhash");
  const publicClient = {
    readContract: vi.fn().mockResolvedValue(currentAllowance),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
  };
  const walletClient = { account: { address: OWNER }, chain: { id: 1 }, writeContract };
  return { publicClient, walletClient, writeContract };
}

/** Extract [spender, amount] pairs of the approve calls, in order. */
function approveArgs(writeContract: ReturnType<typeof vi.fn>): Array<[string, bigint]> {
  return writeContract.mock.calls.map((c) => {
    const req = c[0] as { functionName: string; args: [string, bigint] };
    expect(req.functionName).toBe("approve");
    return req.args;
  });
}

describe("ensurePendleAllowanceExact — set-to-exact discipline", () => {
  it("no-op when the allowance already EQUALS the required amount", async () => {
    const { publicClient, walletClient, writeContract } = makeClients(100n);
    const result = await ensurePendleAllowanceExact(
      publicClient as never, walletClient as never, TOKEN, PENDLE_ROUTER, 100n,
    );
    expect(result).toBeNull();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("STALE LARGER allowance is reset to zero then set to exact (never skipped)", async () => {
    const { publicClient, walletClient, writeContract } = makeClients(999999999n);
    const result = await ensurePendleAllowanceExact(
      publicClient as never, walletClient as never, TOKEN, PENDLE_ROUTER, 100n,
    );
    expect(result).not.toBeNull();
    expect(approveArgs(writeContract)).toEqual([
      [PENDLE_ROUTER, 0n],
      [PENDLE_ROUTER, 100n],
    ]);
  });

  it("smaller non-zero allowance is zeroed then set to exact", async () => {
    const { publicClient, walletClient, writeContract } = makeClients(1n);
    await ensurePendleAllowanceExact(
      publicClient as never, walletClient as never, TOKEN, PENDLE_ROUTER, 100n,
    );
    expect(approveArgs(writeContract)).toEqual([
      [PENDLE_ROUTER, 0n],
      [PENDLE_ROUTER, 100n],
    ]);
  });

  it("zero allowance gets a single exact approval", async () => {
    const { publicClient, walletClient, writeContract } = makeClients(0n);
    await ensurePendleAllowanceExact(
      publicClient as never, walletClient as never, TOKEN, PENDLE_ROUTER, 100n,
    );
    expect(approveArgs(writeContract)).toEqual([[PENDLE_ROUTER, 100n]]);
  });

  it("refuses any spender other than the pinned Router", async () => {
    const { publicClient, walletClient } = makeClients(0n);
    try {
      await ensurePendleAllowanceExact(
        publicClient as never, walletClient as never, TOKEN,
        getAddress("0xdEAD000000000000000000000000000000000000"), 100n,
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe(ErrorCodes.INVALID_SPENDER);
    }
  });

  it("does not send the exact approval after a reverted reset", async () => {
    const { publicClient, walletClient, writeContract } = makeClients(1n);
    publicClient.waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });

    await expect(
      ensurePendleAllowanceExact(publicClient as never, walletClient as never, TOKEN, PENDLE_ROUTER, 100n),
    ).rejects.toMatchObject({ code: ErrorCodes.APPROVAL_FAILED });
    expect(writeContract).toHaveBeenCalledTimes(1);
  });
});
