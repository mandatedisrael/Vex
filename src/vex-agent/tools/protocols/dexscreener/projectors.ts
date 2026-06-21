/**
 * DexScreener concise pair projectors (P1-12).
 *
 * The DexScreener REST schema (`DexPair`) ships a heavy per-pair payload the
 * model never acts on when it is shopping for liquidity/price: an `info` block
 * (`imageUrl`/`websites`/`socials`), a per-window `txns` map, a per-window
 * `volume` map, a `priceChange` map, the human `url`, and a `boosts` block. On
 * the hot `tokenPairs` path (the canonical "find the deepest
 * pool for this token" resolver) this is the biggest byte sink in the
 * DexScreener bundle and dilutes the chain/dex/price/liquidity signal.
 *
 * These pure projectors strip that noise at the handler seam — BEFORE the result
 * is serialized — so the model sees a lean, decision-relevant row: pair identity
 * (`chainId`/`dexId`), both token identities, and the price/liquidity/valuation
 * facts (`priceUsd`/`liquidity`/`fdv`/`marketCap`/`pairCreatedAt`/`labels`).
 * Every DexScreener read tool is `mutating:false` / `actionKind:"read"` with no
 * `_tradeCapture`, so trimming both the output string and the unused `data` is
 * safe.
 *
 * NOTE: the dropped `url`/`info.imageUrl` fields are still consumed ELSEWHERE
 * (the renderer's clickable-links + token-image features read them straight off
 * the upstream client responses, not off this projected tool output). This
 * projection only shapes the TOOL output the model sees; it does not change the
 * raw client shape those renderer features depend on.
 *
 * `pairAddress` IS kept: the `kyberswap.zap.*` manifest hint steers the agent to
 * resolve a pool address via `dexscreener.tokenPairs`, then pass it as the zap
 * `poolFrom`/`poolTo` arg — so the pool address is decision-relevant model
 * output here, not byte noise.
 *
 * Default-concise with NO verbosity knob: there is no agent use case for the
 * dropped `info`/`url`/`txns`/`volume`/`priceChange`/`boosts`.
 *
 * Every field read is defensive: the shapes come from an external API, so
 * missing / null / wrong-typed nested fields are normalised rather than assumed
 * present.
 */

import type { DexLiquidity, DexPair } from "@tools/dexscreener/types.js";

// ── Concise output shapes ────────────────────────────────────────

/** Concise base-token identity (DROPS nothing — `DexToken` is already minimal). */
export interface ConcisePairToken {
  address: string | null;
  name: string | null;
  symbol: string | null;
}

/**
 * Concise DexScreener pair row. KEEPS pair identity (`chainId`/`dexId`/
 * `pairAddress`), both token identities, the price/liquidity/valuation facts,
 * the pair-creation timestamp, and `labels`. DROPS the `info` block
 * (`imageUrl`/`websites`/`socials`), the human `url`, the `boosts` block, and
 * the per-window `txns`, `volume`, and `priceChange` maps.
 */
export interface ConciseDexPair {
  chainId: string;
  dexId: string;
  pairAddress: string | null;
  baseToken: ConcisePairToken;
  quoteToken: ConcisePairToken;
  priceUsd: string | null;
  liquidity: DexLiquidity | null;
  fdv: number | null;
  marketCap: number | null;
  pairCreatedAt: number | null;
  labels: string[] | null;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Narrow an `unknown` to a plain record so optional nested reads are type-safe. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Read a `string | null` field defensively (normalise missing/wrong-typed to `null`). */
function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Read a `number | null` field defensively (normalise missing/wrong-typed to `null`). */
function numOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * Project a raw token sub-object (base or quote) to a concise identity row.
 *
 * `DexToken` (base) is non-null on all three fields and `DexQuoteToken` (quote)
 * is nullable on all three; both narrow to the same `string | null` shape here
 * so a malformed/absent token block stays explicit rather than throwing.
 */
function projectPairToken(token: unknown): ConcisePairToken {
  if (!isRecord(token)) {
    return { address: null, name: null, symbol: null };
  }
  return {
    address: strOrNull(token.address),
    name: strOrNull(token.name),
    symbol: strOrNull(token.symbol),
  };
}

/**
 * Project the raw `liquidity` block defensively. KEEPS the full
 * `{usd, base, quote}` shape (the agent reasons over all three) but tolerates a
 * missing/malformed block by returning `null`, matching `DexPair.liquidity`'s
 * `DexLiquidity | null` contract.
 */
function projectLiquidity(liquidity: unknown): DexLiquidity | null {
  if (!isRecord(liquidity)) return null;
  return {
    usd: numOrNull(liquidity.usd),
    base: typeof liquidity.base === "number" ? liquidity.base : 0,
    quote: typeof liquidity.quote === "number" ? liquidity.quote : 0,
  };
}

// ── Projectors ───────────────────────────────────────────────────

/**
 * Project a raw `DexPair` to a concise, decision-relevant row.
 *
 * KEEP: chainId, dexId, pairAddress, baseToken{address,name,symbol},
 *   quoteToken{address,name,symbol}, priceUsd, liquidity{usd,base,quote}, fdv,
 *   marketCap, pairCreatedAt, labels.
 * DROP: info{imageUrl,websites,socials}, url, boosts, txns, volume,
 *   priceChange.
 */
export function projectPair(pair: DexPair): ConciseDexPair {
  return {
    chainId: typeof pair.chainId === "string" ? pair.chainId : "",
    dexId: typeof pair.dexId === "string" ? pair.dexId : "",
    pairAddress: strOrNull(pair.pairAddress),
    baseToken: projectPairToken(pair.baseToken),
    quoteToken: projectPairToken(pair.quoteToken),
    priceUsd: strOrNull(pair.priceUsd),
    liquidity: projectLiquidity(pair.liquidity),
    fdv: numOrNull(pair.fdv),
    marketCap: numOrNull(pair.marketCap),
    pairCreatedAt: numOrNull(pair.pairCreatedAt),
    labels: Array.isArray(pair.labels) ? pair.labels : null,
  };
}

/** Project an array of raw pairs defensively (tolerates a non-array input). */
export function projectPairs(
  pairs: readonly DexPair[] | null | undefined,
): ConciseDexPair[] {
  return (Array.isArray(pairs) ? pairs : []).map(projectPair);
}
