/**
 * Canonical chain hint resolution.
 *
 * _tradeCapture.chain returns varied formats: "solana", "polygon",
 * "ethereum", "base", stringified chainId. This normalizes to { family, chainIds }
 * for selective balance sync.
 */

import { resolveChainId, getCachedKhalaniChains } from "@tools/khalani/chains.js";
import type { ChainFamily } from "@tools/khalani/types.js";
import logger from "@utils/logger.js";

export interface ChainResolution {
  family: ChainFamily;
  /** Empty array = all chains for this family (no filter). */
  chainIds: number[];
}

const SOLANA_HINTS = new Set(["solana", "sol"]);

/**
 * Resolve a chain hint from _tradeCapture.chain to { family, chainIds }.
 * Falls back to full refresh (no filter) if resolution fails.
 */
export async function resolveChainHint(hint: string): Promise<ChainResolution> {
  const normalized = hint.toLowerCase().trim();

  // Solana is special — not an EVM chain
  if (SOLANA_HINTS.has(normalized)) {
    return { family: "solana", chainIds: [] };
  }

  // Try to resolve as Khalani chain (handles slugs, aliases, numeric IDs)
  try {
    const chains = await getCachedKhalaniChains();
    const chainId = resolveChainId(normalized, chains);
    const chain = chains.find(c => c.id === chainId);
    const family: ChainFamily = chain?.type === "solana" ? "solana" : "eip155";
    return { family, chainIds: [chainId] };
  } catch {
    logger.debug("sync.chains.resolve_failed", { hint: normalized, fallback: "eip155_all" });
    // Fallback: assume EVM, full refresh (no chainId filter)
    return { family: "eip155", chainIds: [] };
  }
}
