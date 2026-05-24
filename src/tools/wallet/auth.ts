import { type Address, type Hex } from "viem";
import { VexError, ErrorCodes } from "../../errors.js";
import { getPrimaryEvmEntry, loadEvmKey } from "./inventory.js";

/**
 * Resolve the PRIMARY EVM wallet (inventory index 0) + its private key.
 *
 * Back-compat: CLI/MCP have no session, so they always get the primary entry —
 * which on a legacy install is the single wallet migrated from the old
 * `wallet.address` config field (keystore in the fixed KEYSTORE_FILE).
 */
export function requireWalletAndKeystore(): { address: Address; privateKey: Hex } {
  const entry = getPrimaryEvmEntry();
  if (!entry) {
    throw new VexError(
      ErrorCodes.WALLET_NOT_CONFIGURED,
      "No wallet configured.",
      "Run: vex wallet create --json",
    );
  }
  return loadEvmKey(entry);
}
