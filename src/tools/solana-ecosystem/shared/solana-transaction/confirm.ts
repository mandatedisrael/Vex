/**
 * Versioned-transaction confirmation polling for the Jupiter shelves.
 */

import { Connection } from "@solana/web3.js";
import { VexError, ErrorCodes } from "../../../../errors.js";
import { solanaExplorerUrl } from "../solana-validation.js";
import { DEFAULT_CONFIRM_TIMEOUT_MS, CONFIRM_POLL_INTERVAL_MS } from "./constants.js";

export async function confirmVersionedTx(
  connection: Connection,
  signature: string,
  timeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];

    if (status) {
      if (status.err) {
        throw new VexError(
          ErrorCodes.SOLANA_TX_FAILED,
          `Transaction failed: ${JSON.stringify(status.err)}`,
          `Explorer: ${solanaExplorerUrl(signature)}`,
        );
      }

      if (
        status.confirmationStatus === "confirmed"
        || status.confirmationStatus === "finalized"
      ) {
        return;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_INTERVAL_MS));
  }

  const error = new VexError(
    ErrorCodes.SOLANA_TX_TIMEOUT,
    `Transaction confirmation timed out after ${timeoutMs}ms`,
    `Signature: ${signature}\nExplorer: ${solanaExplorerUrl(signature)}`,
  );
  error.retryable = true;
  throw error;
}
