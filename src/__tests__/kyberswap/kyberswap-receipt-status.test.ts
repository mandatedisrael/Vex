import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import { ErrorCodes } from "../../errors.js";
import { META_AGGREGATION_ROUTER_V2 } from "@tools/kyberswap/constants.js";
import {
  ensureKyberAllowance,
  sendKyberTransaction,
  sendKyberTransactionWithReceipt,
} from "@tools/kyberswap/evm/erc20.js";

const TOKEN = "0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b" as Address;
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const HASH = `0x${"cd".repeat(32)}` as Hex;

function clients(allowance: bigint, status: "success" | "reverted") {
  return {
    publicClient: {
      readContract: vi.fn().mockResolvedValue(allowance),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status, logs: [] }),
    },
    walletClient: {
      account: { address: OWNER },
      chain: { id: 1 },
      writeContract: vi.fn().mockResolvedValue(HASH),
      sendTransaction: vi.fn().mockResolvedValue(HASH),
    },
  };
}

describe("Kyber receipt status", () => {
  it("does not send the follow-up approve after a reverted reset", async () => {
    const { publicClient, walletClient } = clients(1n, "reverted");
    await expect(
      ensureKyberAllowance(publicClient as never, walletClient as never, TOKEN, META_AGGREGATION_ROUTER_V2, 100n, true),
    ).rejects.toMatchObject({ code: ErrorCodes.APPROVAL_FAILED });
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sendKyberTransaction", (client: never, wallet: never) => sendKyberTransaction(client, wallet, { to: META_AGGREGATION_ROUTER_V2, data: "0x" })],
    ["sendKyberTransactionWithReceipt", (client: never, wallet: never) => sendKyberTransactionWithReceipt(client, wallet, { to: META_AGGREGATION_ROUTER_V2, data: "0x" })],
  ])("%s rejects a mined reverted transaction", async (_name, send) => {
    const { publicClient, walletClient } = clients(0n, "reverted");
    await expect(send(publicClient as never, walletClient as never)).rejects.toMatchObject({ code: ErrorCodes.SWAP_FAILED });
  });
});
