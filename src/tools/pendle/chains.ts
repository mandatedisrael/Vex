/**
 * Pendle chain resolution — Ethereum mainnet ONLY in this wave.
 *
 * A tiny, network-free resolver so the prequote gate/recorder and the handlers
 * agree on the chain id WITHOUT coupling Pendle to another venue's registry.
 */

import { PENDLE_CHAIN_ID } from "./constants.js";

const ETHEREUM_ALIASES = new Set(["ethereum", "eth", "mainnet", "ethereum-mainnet", "1"]);

/** Resolve a chain param/alias to the Pendle chain id (1), or undefined. */
export function resolvePendleChainId(input: string): number | undefined {
  const normalized = input.trim().toLowerCase();
  if (normalized === "") return undefined;
  if (ETHEREUM_ALIASES.has(normalized)) return PENDLE_CHAIN_ID;
  return Number(normalized) === PENDLE_CHAIN_ID ? PENDLE_CHAIN_ID : undefined;
}

/** Canonical chain slug used in trade-capture (drives selective balance sync to chain 1). */
export const PENDLE_CHAIN_SLUG = "ethereum";
