import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import { ErrorCodes } from "../../../errors.js";
import { ensureUniswapAllowanceExact } from "@tools/uniswap/erc20.js";
import { sendUniswapTransaction } from "@tools/uniswap/execute.js";

const TOKEN = "0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b" as Address;
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hex;

function clients(allowance: bigint, status: "success" | "reverted") {
  return {
    publicClient: {
      readContract: vi.fn().mockResolvedValue(allowance),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status }),
    },
    walletClient: {
      account: { address: OWNER },
      chain: { id: 4663 },
      writeContract: vi.fn().mockResolvedValue(HASH),
      sendTransaction: vi.fn().mockResolvedValue(HASH),
    },
  };
}

describe("Uniswap receipt status", () => {
  it("does not send the follow-up approve after a reverted allowance reset", async () => {
    const { publicClient, walletClient } = clients(1n, "reverted");
    await expect(
      ensureUniswapAllowanceExact(publicClient as never, walletClient as never, TOKEN, ROUTER, 100n),
    ).rejects.toMatchObject({ code: ErrorCodes.APPROVAL_FAILED });
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
  });

  it("fails a mined-but-reverted swap instead of returning its hash", async () => {
    const { publicClient, walletClient } = clients(0n, "reverted");
    await expect(
      sendUniswapTransaction(publicClient as never, walletClient as never, {
        to: ROUTER,
        data: "0x",
        value: 0n,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.SWAP_FAILED });
  });
});
