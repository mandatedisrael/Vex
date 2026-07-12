/**
 * Receipt confirmation guard for state-changing EVM operations.
 *
 * viem resolves `waitForTransactionReceipt` for a mined revert. Callers must
 * therefore distinguish a confirmed revert from a post-broadcast confirmation
 * failure, where the transaction may still settle and must never be retried
 * automatically.
 */

import type { Hex, PublicClient, TransactionReceipt } from "viem";

import { ErrorCodes, VexError } from "../../errors.js";

export type ReceiptWaitClient = Pick<PublicClient, "waitForTransactionReceipt">;

export interface ReceiptFailureContext {
  readonly code: string;
  readonly what: string;
  readonly hint?: string;
}

/** Wait for a successful receipt, preserving the receipt for callers that need logs. */
export async function waitForSuccessfulReceipt(
  client: ReceiptWaitClient,
  hash: Hex,
  context: ReceiptFailureContext,
): Promise<TransactionReceipt> {
  let receipt: TransactionReceipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash });
  } catch {
    throw new VexError(
      ErrorCodes.CONFIRMATION_UNKNOWN,
      `Transaction ${hash} was broadcast but its confirmation could not be determined. It may still confirm on-chain.`,
      "Do not retry automatically. Check the transaction hash on-chain before taking any further action.",
    );
  }

  if (receipt.status !== "success") {
    throw new VexError(
      context.code,
      `${context.what} ${hash} reverted on-chain (status: ${receipt.status}).`,
      context.hint,
    );
  }

  return receipt;
}
