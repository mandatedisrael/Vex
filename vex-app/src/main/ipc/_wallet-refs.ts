/**
 * Server-side wallet-id → {id,address} resolution for per-session wallet
 * selection (puzzle 5 phase 5C). The renderer sends only inventory IDs; main
 * resolves the on-chain address from the engine config inventory (no DB, no
 * keys) so a renderer-supplied address is never trusted.
 */

import { getWalletById } from "@vex-lib/wallet.js";
import type { VexError } from "@shared/ipc/result.js";

export type WalletRef = { id: string; address: string };

/**
 * Resolve a wallet ID for a family.
 *   - null/empty id → null (unselected);
 *   - known id → { id, address };
 *   - unknown id → "invalid" (caller fails closed, writes nothing).
 */
export function resolveWalletRef(
  family: "evm" | "solana",
  walletId: string | null | undefined,
): WalletRef | null | "invalid" {
  if (!walletId) return null;
  const entry = getWalletById(family, walletId);
  return entry ? { id: entry.id, address: entry.address } : "invalid";
}

export function invalidWalletSelectionError(correlationId: string): VexError {
  return {
    code: "wallets.invalid_selection",
    domain: "wallets",
    message: "Selected wallet is not in the inventory.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}
