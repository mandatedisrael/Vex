/**
 * Bridge VENUE ROUTER policy — Khalani vs Relay.
 *
 * Single-ownership policy for which bridge provider a route uses, mirroring the
 * swap venue router. Khalani is primary for its supported chains; Relay is the
 * ONLY route whenever either side is a LOCAL chain (Robinhood 4663, which Khalani
 * does not cover). "Khalani lacks the route" for two non-local chains is a
 * runtime signal (the agent retries Relay per the routing guidance) — this sync
 * policy decides the alias's default target.
 *
 * Flip priority (or extend) HERE and nowhere else.
 */

import { resolveLocalChainId } from "@tools/evm-chains/registry.js";

export type BridgeVenue = "khalani" | "relay";

/** Resolve the default bridge venue for a route. Relay when either side is local (4663). */
export function resolveBridgeVenue(fromChain: string, toChain: string): BridgeVenue {
  const eitherLocal =
    resolveLocalChainId(fromChain.trim()) !== undefined ||
    resolveLocalChainId(toChain.trim()) !== undefined;
  return eitherLocal ? "relay" : "khalani";
}
