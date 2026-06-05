/**
 * Versioned-transaction deserialization for the Jupiter shelves.
 */

import { VersionedTransaction } from "@solana/web3.js";
import { VexError, ErrorCodes } from "../../../../errors.js";

export function deserializeVersionedTx(input: Uint8Array | string): VersionedTransaction {
  try {
    const bytes = typeof input === "string" ? Buffer.from(input, "base64") : input;
    return VersionedTransaction.deserialize(bytes);
  } catch (err) {
    throw new VexError(
      ErrorCodes.SOLANA_TX_FAILED,
      `Failed to deserialize transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
