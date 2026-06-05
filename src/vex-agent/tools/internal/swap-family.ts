/**
 * Swap family classifier — shared between the Stage 8a READ-ONLY `swap_quote`
 * alias and the Stage 8b MUTATING `swap` alias router.
 *
 * One classifier, one source of truth: both aliases route by `chain` to either
 * the EVM (KyberSwap) or Solana (Jupiter) family. Extracted here so the
 * mutating router cannot drift from the read-only quote router (e.g. accept a
 * chain for execute that the quote rejected, or vice versa) — they MUST agree
 * on which family a chain maps to or the Stage-7 prequote gate's match-hash
 * would never collide between the quote and the execute.
 *
 * Pure helper: only `resolveChainSlug` (local, no network) is consulted. No
 * wallet, DB, or privileged imports.
 */

import { isAddress } from "viem";

import { resolveChainSlug } from "@tools/kyberswap/chains.js";
import { isNativeTokenInput } from "@tools/kyberswap/helpers.js";

/** Chain values that route to the Solana (Jupiter) family. Checked before EVM. */
export const SOLANA_CHAIN_VALUES: ReadonlySet<string> = new Set(["solana", "sol"]);

export type SwapFamily =
  | { readonly kind: "evm"; readonly chainSlug: string }
  | { readonly kind: "solana" }
  | { readonly kind: "unknown" };

/**
 * Decide the swap family from a `chain` arg. Solana is matched explicitly FIRST
 * (its slug is not a `KyberChainSlug`); EVM is confirmed by `resolveChainSlug`
 * (throws on unknown). Anything neither Solana nor a known EVM chain is
 * `unknown` → callers fail clearly instead of guessing.
 */
export function classifySwapFamily(chain: string): SwapFamily {
  const normalized = chain.toLowerCase().trim();
  if (SOLANA_CHAIN_VALUES.has(normalized)) return { kind: "solana" };
  try {
    return { kind: "evm", chainSlug: resolveChainSlug(normalized) };
  } catch {
    return { kind: "unknown" };
  }
}

/**
 * True when an EVM swap token input is acceptable WITHOUT DEX symbol search: a
 * contract address (`isAddress`) OR the native token (`isNativeTokenInput` —
 * the "native"/"eth" keyword or the native sentinel address). A bare symbol is
 * rejected by callers because Kyber symbol search can match the wrong contract
 * (e.g. "USDC" → axlUSDC) and seed a prequote for the wrong token; EVM symbols
 * must be resolved with `token_find` (Khalani) first.
 *
 * Shared by the EVM branches of the read-only `swap_quote` alias and the
 * mutating `swap` router so both reject a symbol identically (and stay symmetric
 * with the execute/quote handlers' `resolveTokenMetadataStrict`).
 */
export function isEvmSwapTokenInput(input: string): boolean {
  return isNativeTokenInput(input) || isAddress(input);
}
