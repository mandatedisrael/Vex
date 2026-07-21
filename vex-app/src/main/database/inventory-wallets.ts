/**
 * Inventory wallet resolution — the GLOBAL configured wallet allow-list
 * (EVM + Solana), shared by every main-process read that aggregates across
 * "all of the user's wallets" rather than one session's scope.
 *
 * Extracted from `portfolio-db.ts`'s `resolveAddresses` (the `scope:
 * "global"` branch) so `token-history-db.ts` can resolve the SAME allow-list
 * without duplicating the config read. Addresses are returned RAW (no
 * lowercasing) — the engine stores checksum/base58 addresses verbatim, and
 * every SELECT that consumes this list joins against that raw form.
 */

import { listWallets, type WalletInventoryEntry } from "@vex-lib/wallet.js";

/** Every configured wallet entry (EVM then Solana), unfiltered. */
export function listInventoryWalletEntries(): readonly WalletInventoryEntry[] {
  return [...listWallets("evm"), ...listWallets("solana")];
}

/**
 * Deduped raw addresses across the whole configured inventory. Callers that
 * need per-entry membership checks (e.g. the WP-L2 single-wallet narrowing
 * in `portfolio-db.ts`) should use `listInventoryWalletEntries` directly
 * instead — this helper is for the common "just the address allow-list" case.
 */
export function resolveInventoryWalletAddresses(): readonly string[] {
  return [...new Set(listInventoryWalletEntries().map((entry) => entry.address))];
}
