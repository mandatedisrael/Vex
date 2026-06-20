/**
 * Khalani concise token/chain projectors (P0-4).
 *
 * Khalani read tools ship heavy upstream payloads the model never acts on:
 * `chains.list` returns a full `KhalaniChain[]` with `rpcUrls`/`blockExplorers`,
 * `tokens.{top,search,balances}` and `tokens.autocomplete` return full
 * `KhalaniToken` rows carrying a `logoURI` plus an open `extensions[key:unknown]`
 * passthrough bag. On the hot pre-mutation path (`tokens.search` — the canonical
 * cross-chain contract resolver) and on `chains.list`/`autocomplete` this is the
 * biggest byte sink in the Khalani bundle and dilutes the contract/price signal.
 *
 * These pure projectors strip that noise at the handler seam — BEFORE the result
 * is serialized — so the model sees a lean, decision-relevant row: token identity
 * plus the lifted price/balance/risk signal, and chain identity plus native-coin
 * facts. Every Khalani read tool is `mutating:false` / `actionKind:"read"` with
 * no `_tradeCapture`, so trimming both the output string and the unused `data` is
 * safe (see CC-4 / P0-4 in the tool-output eval).
 *
 * The internal rpc/explorer resolvers (`getChainRpcUrl`/`getChainExplorerUrl` in
 * `@tools/khalani/chains.js`) read `rpcUrls`/`blockExplorers` off the CACHED chain
 * REGISTRY (`getCachedKhalaniChains()`), never off this projected tool output — so
 * dropping those provider-metadata blocks here does not affect chain resolution or
 * bridging.
 *
 * Default-concise with NO verbosity knob: there is no agent use case for the
 * dropped `logoURI`, the open `extensions` bag, or the provider rpc/explorer URLs.
 *
 * Every field read is defensive: the shapes come from an external API, so missing
 * / null / wrong-typed fields are normalised rather than assumed present. Note:
 * `KhalaniTokenMeta` (the `fromTokenMeta`/`toTokenMeta` on `KhalaniOrder`) is a
 * DIFFERENT, already-minimal shape (`{symbol,decimals,logoURI?}`) — it is NOT a
 * `KhalaniToken`, so it is intentionally NOT routed through `projectToken`.
 */

import type { ChainFamily, KhalaniChain, KhalaniToken } from "@tools/khalani/types.js";

// ── Concise output shapes ────────────────────────────────────────

/**
 * Concise Khalani token row. KEEPS identity (`symbol`/`name`/`address`/`chainId`/
 * `decimals`) and lifts the three decision signals out of the open `extensions`
 * bag: USD price, the wallet balance (present on the balances path), and the
 * risk-token flag. DROPS `logoURI` and the rest of the open `extensions`
 * passthrough bag.
 */
export interface ConciseKhalaniToken {
  symbol: string;
  name: string;
  address: string;
  chainId: number;
  decimals: number;
  /** Lifted from `extensions.price.usd` (string from upstream). */
  priceUsd?: string;
  /** Lifted from `extensions.balance` (smallest-unit string; balances path). */
  balance?: string;
  /** Lifted from `extensions.isRiskToken`. */
  isRiskToken?: boolean;
}

/**
 * Concise Khalani chain row. KEEPS chain identity (`id`/`name`/`type`) and the
 * native-coin facts an agent needs to reason about amounts (`nativeSymbol`/
 * `nativeDecimals`, lifted from `nativeCurrency`). DROPS `rpcUrls`,
 * `blockExplorers`, and other heavy provider metadata — those are resolved
 * internally from the cached registry, not from this output.
 */
export interface ConciseKhalaniChain {
  id: number;
  name: string;
  type: ChainFamily;
  nativeSymbol: string | null;
  nativeDecimals: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Narrow an `unknown` to a plain record so optional nested reads are type-safe. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ── Projectors ───────────────────────────────────────────────────

/**
 * Project a raw `KhalaniToken` to a concise, decision-relevant row.
 *
 * KEEP: symbol, name, address, chainId, decimals.
 * LIFT (from the open `extensions` bag, only when present and well-typed):
 *   `extensions.price.usd` → `priceUsd`, `extensions.balance` → `balance`,
 *   `extensions.isRiskToken` → `isRiskToken`.
 * DROP: `logoURI` and the rest of the open `extensions` passthrough bag.
 *
 * Optional signals are omitted (not set to `null`) when absent so a token with no
 * price/balance/risk data stays a clean identity row.
 */
export function projectToken(t: KhalaniToken): ConciseKhalaniToken {
  const out: ConciseKhalaniToken = {
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    chainId: t.chainId,
    decimals: t.decimals,
  };

  // `extensions` is an open bag from an external API — narrow every read.
  const ext: unknown = t.extensions;
  if (isRecord(ext)) {
    const price: unknown = ext.price;
    if (isRecord(price) && typeof price.usd === "string") {
      out.priceUsd = price.usd;
    }
    if (typeof ext.balance === "string") {
      out.balance = ext.balance;
    }
    if (typeof ext.isRiskToken === "boolean") {
      out.isRiskToken = ext.isRiskToken;
    }
  }

  return out;
}

/** Project an array of raw tokens defensively (tolerates a non-array input). */
export function projectTokens(
  tokens: readonly KhalaniToken[] | null | undefined,
): ConciseKhalaniToken[] {
  return (Array.isArray(tokens) ? tokens : []).map(projectToken);
}

/**
 * Project a raw `KhalaniChain` to a concise identity + native-coin row.
 *
 * KEEP: id, name, type, and the native-coin symbol/decimals lifted from
 * `nativeCurrency`. DROP: `rpcUrls`, `blockExplorers` (internal resolvers read
 * these from the cached registry, not from output).
 *
 * `nativeSymbol`/`nativeDecimals` normalise to `null` when `nativeCurrency` is
 * absent or malformed, so a missing native block stays explicit rather than
 * silently absent.
 */
export function projectChain(c: KhalaniChain): ConciseKhalaniChain {
  const native: unknown = c.nativeCurrency;
  const nativeSymbol = isRecord(native) && typeof native.symbol === "string" ? native.symbol : null;
  const nativeDecimals = isRecord(native) && typeof native.decimals === "number" ? native.decimals : null;
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    nativeSymbol,
    nativeDecimals,
  };
}

/** Project an array of raw chains defensively (tolerates a non-array input). */
export function projectChains(
  chains: readonly KhalaniChain[] | null | undefined,
): ConciseKhalaniChain[] {
  return (Array.isArray(chains) ? chains : []).map(projectChain);
}
