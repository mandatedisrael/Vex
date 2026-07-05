/**
 * Relay chain resolution — string chain input → Relay numeric chain id.
 *
 * Resolves numeric ids, local-registry aliases (Robinhood 4663), KyberSwap slugs,
 * and Relay chain name/displayName, then confirms membership in Relay's live
 * /chains registry. One resolver so the relay quote + bridge + prequote identity
 * agree on the chain id.
 */

import { resolveChainSlug, slugToChainId } from "@tools/kyberswap/chains.js";
import { resolveLocalChainId } from "@tools/evm-chains/registry.js";
import { VexError, ErrorCodes } from "../../errors.js";
import type { RelayChain } from "./types.js";

/** Resolve a chain input to a Relay chain id present in `chains`, or throw. */
export function resolveRelayChainId(input: string, chains: readonly RelayChain[]): number {
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new VexError(ErrorCodes.RELAY_UNSUPPORTED_CHAIN, "Chain value cannot be empty.");
  }
  const byId = new Map(chains.map((c) => [c.id, c]));

  // 1. Numeric.
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric > 0 && byId.has(numeric)) return numeric;

  // 2. Local registry alias (e.g. "robinhood").
  const localId = resolveLocalChainId(normalized);
  if (localId !== undefined && byId.has(localId)) return localId;

  // 3. KyberSwap slug (pure string→id).
  try {
    const kyberId = slugToChainId(resolveChainSlug(normalized));
    if (byId.has(kyberId)) return kyberId;
  } catch {
    // fall through
  }

  // 4. Relay chain name / displayName.
  for (const chain of chains) {
    if (chain.name.toLowerCase() === normalized) return chain.id;
    if (chain.displayName?.toLowerCase() === normalized) return chain.id;
    if (chain.name.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalized) return chain.id;
  }

  throw new VexError(
    ErrorCodes.RELAY_UNSUPPORTED_CHAIN,
    `Relay does not support chain "${input}".`,
    "Use a chain id or a supported chain name.",
  );
}

/** Native currency sentinel Relay uses for a chain's native gas token. */
export const RELAY_NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";

/** EVM native-token sentinel (shared with kyberswap/uniswap). */
const EVM_NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/**
 * Map a token input to the Relay currency address. Native keywords ("eth" /
 * "native") and the EVM native sentinel map to Relay's zero-address native
 * currency; any other value passes through (an ERC-20 contract address). Used by
 * BOTH the relay handler and the prequote identity builder so quote↔execute
 * currencies collide.
 */
export function toRelayCurrency(input: string): string {
  const lower = input.trim().toLowerCase();
  if (lower === "eth" || lower === "native" || lower === EVM_NATIVE_SENTINEL || lower === RELAY_NATIVE_CURRENCY) {
    return RELAY_NATIVE_CURRENCY;
  }
  return input.trim();
}
