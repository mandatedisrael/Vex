/**
 * Uniswap chain resolution — string chain input → verified Uniswap deployment.
 *
 * ONE resolver, used everywhere a chain string must map to a Uniswap chain id:
 * the swap-family classifier + venue router (alias routing), the quote/execute
 * handlers, and the prequote execute-gate identity builder. Because record-time
 * and gate-time must agree on the chain id (or the match-hash never collides),
 * this single function is the source of truth.
 *
 * De-kyber-coupling (LOCKED Wave-2 correction #4): the OLD EVM identity builder
 * resolved chains ONLY through KyberSwap's slug map, which THROWS for Robinhood
 * Chain (4663) — so a uniswap-on-4663 prequote could never be gated. Here the
 * LOCAL chain registry (`tools/evm-chains`) provides 4663, and KyberSwap's slug
 * map is used ONLY as a pure string→id utility for the overlap chains (no
 * network, no venue authority). The deployment registry is the sole authority on
 * whether Uniswap actually supports a chain.
 */

import { resolveChainSlug, slugToChainId } from "@tools/kyberswap/chains.js";
import { resolveLocalChainId } from "@tools/evm-chains/registry.js";
import {
  getUniswapDeployment,
  isUniswapChain,
  type UniswapDeployment,
} from "./deployments.js";

/**
 * Resolve a chain alias / name / numeric id string to a Uniswap chain id, or
 * `undefined` when Uniswap has no verified deployment for it. Network-free and
 * deterministic (safe on the fail-closed gate path).
 */
export function resolveUniswapChainId(input: string): number | undefined {
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0) return undefined;

  // 1. Numeric chain id.
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric > 0 && isUniswapChain(numeric)) return numeric;

  // 2. Local registry (Robinhood Chain 4663 + future local chains).
  const localId = resolveLocalChainId(normalized);
  if (localId !== undefined && isUniswapChain(localId)) return localId;

  // 3. KyberSwap slug map — pure string→id utility for the overlap chains.
  try {
    const kyberId = slugToChainId(resolveChainSlug(normalized));
    if (isUniswapChain(kyberId)) return kyberId;
  } catch {
    // Not a KyberSwap slug — fall through.
  }
  return undefined;
}

/** Resolve a chain input to its Uniswap deployment, or `undefined`. */
export function resolveUniswapDeployment(input: string): UniswapDeployment | undefined {
  const chainId = resolveUniswapChainId(input);
  return chainId === undefined ? undefined : getUniswapDeployment(chainId);
}
