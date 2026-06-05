/**
 * Versioned-transaction signing for the Jupiter shelves.
 */

import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { VexError, ErrorCodes } from "../../../../errors.js";

export function signVersionedTx(
  tx: VersionedTransaction,
  signers: Keypair[],
): VersionedTransaction {
  try {
    tx.sign(signers);
    return tx;
  } catch (err) {
    throw new VexError(
      ErrorCodes.SOLANA_TX_FAILED,
      `Failed to sign transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
