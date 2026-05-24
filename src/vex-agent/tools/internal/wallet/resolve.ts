/**
 * Engine wallet resolution (puzzle 5 phase 5B). Bridges the per-session
 * `WalletResolution` + `WalletPolicy` (threaded via context) to the shared
 * inventory resolvers, and enforces mission scope.
 *
 * Two entry points, deliberately split (Codex stage-5B review):
 *   - `resolveSelectedAddress` — address-only, NEVER decrypts a key. For
 *     wallet_read / send prepare / balance display.
 *   - `resolveSigningWallet` — decrypts the key. ONLY after the approval gate
 *     and immediately before broadcast (wallet_send_confirm executors).
 *
 * Both validate the session selection (id + address snapshot, via
 * `resolveSelectedEntry`) AND the mission wallet policy. Mission policy is NOT
 * gated on `sessionKind` — it rides the explicit `WalletPolicy` so a subagent
 * (sessionKind "agent") still inherits the parent mission's allowed set.
 */

import { VexError, ErrorCodes } from "../../../../errors.js";
import type { ChainFamily } from "@tools/khalani/types.js";
import {
  loadWalletFromEntry,
  resolveSelectedEntry,
  type ChainWallet,
  type WalletResolution,
} from "@tools/wallet/multi-auth.js";
import { familyToInventory, walletAddressesEqual } from "@tools/wallet/inventory.js";
import type { WalletPolicy } from "@vex-agent/engine/types.js";

import type { ToolResult } from "../../types.js";

function assertWalletPolicy(policy: WalletPolicy, family: ChainFamily, address: string): void {
  if (policy.kind === "none") return;
  if (policy.kind === "invalid") {
    throw new VexError(
      ErrorCodes.WALLET_SCOPE_MISMATCH,
      "Mission wallet policy is invalid (contract drift — no accepted allowed wallets).",
      "Re-accept the mission contract and start a fresh run.",
    );
  }
  const inv = familyToInventory(family);
  if (!policy.allowedWallets.some((allowed) => walletAddressesEqual(inv, allowed, address))) {
    throw new VexError(
      ErrorCodes.WALLET_SCOPE_MISMATCH,
      "The selected wallet is not in the mission's allowed wallet set.",
    );
  }
}

/**
 * Resolve the selected wallet ADDRESS for a family — no key decrypt. Throws a
 * typed VexError on missing selection, removed wallet, address drift, or
 * mission-policy violation. Callers convert with `walletScopeErrorToResult`.
 */
export function resolveSelectedAddress(
  resolution: WalletResolution,
  policy: WalletPolicy,
  family: ChainFamily,
): string {
  const { entry } = resolveSelectedEntry(family, resolution);
  assertWalletPolicy(policy, family, entry.address);
  return entry.address;
}

/**
 * Resolve AND decrypt the signing wallet for a family. Same validation as
 * `resolveSelectedAddress` plus the key load. Call only after the approval gate
 * and just before broadcast.
 */
export function resolveSigningWallet(
  resolution: WalletResolution,
  policy: WalletPolicy,
  family: ChainFamily,
): ChainWallet {
  const { family: inv, entry } = resolveSelectedEntry(family, resolution);
  assertWalletPolicy(policy, family, entry.address);
  return loadWalletFromEntry(inv, entry);
}

/**
 * Convert a wallet-scope VexError into a fail-closed ToolResult. Re-throws
 * non-VexErrors (unexpected) so they surface as dispatch failures.
 */
export function walletScopeErrorToResult(err: unknown): ToolResult {
  if (err instanceof VexError) {
    return { success: false, output: err.message };
  }
  throw err;
}
