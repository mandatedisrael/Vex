/**
 * DexScreener concise pair projector — ONE shape for search / pairs / tokens /
 * tokenPairs.
 *
 * The DexScreener REST schema (`DexPair`) ships a heavy per-pair payload the
 * model never acts on: an `info` block (`imageUrl`/`websites`/`socials`), the
 * human `url`, a `boosts` block, and per-window `txns` / `volume` / `priceChange`
 * maps carrying every timeframe (m5/h1/h6/h24). Dumped raw across every read
 * tool this is the biggest byte sink in the DexScreener bundle and dilutes the
 * decision-relevant signal.
 *
 * This pure projector produces a lean, flat, decision-relevant row used by ALL
 * four market-data handlers (context economy — no more raw fat payloads):
 *
 *   KEEP: chainId, dexId, pairAddress, base/quote token (address, name, symbol),
 *     priceUsd, priceNative, liquidityUsd, fdv, marketCap, volumeH24,
 *     priceChangeH1, priceChangeH24, txnsH24{buys,sells}, pairCreatedAt, labels.
 *   DROP: info{imageUrl,websites,socials}, url, boosts, and every non-h24
 *     timeframe of txns/volume/priceChange (h24 is the window the model trades
 *     on; h1 priceChange is kept as the short-term momentum read).
 *
 * `pairAddress` is load-bearing: the `kyberswap.zap.*` manifest hint steers the
 * agent to resolve a pool address via `dexscreener.tokenPairs`, then pass it as
 * the zap `poolFrom`/`poolTo` arg.
 *
 * NOTE: the dropped `url`/`info.imageUrl` fields are still consumed ELSEWHERE
 * (the renderer's clickable-links + token-image features read them straight off
 * the upstream client responses, not off this projected tool output). This
 * projection only shapes the TOOL output the model sees.
 *
 * Every field read is defensive: shapes come from an external API, so missing /
 * null / wrong-typed nested fields are normalised rather than assumed present.
 */

import type { DexPair, DexTxnCounts } from "@tools/dexscreener/types.js";

// ── Concise output shapes ────────────────────────────────────────

/** Concise token identity (address + symbol + name). */
export interface ConcisePairToken {
  address: string | null;
  name: string | null;
  symbol: string | null;
}

/** Flat, decision-relevant pair row. See module docstring for KEEP/DROP. */
export interface ConciseDexPair {
  chainId: string;
  dexId: string;
  pairAddress: string | null;
  baseToken: ConcisePairToken;
  quoteToken: ConcisePairToken;
  priceUsd: string | null;
  priceNative: string | null;
  liquidityUsd: number | null;
  fdv: number | null;
  marketCap: number | null;
  volumeH24: number | null;
  priceChangeH1: number | null;
  priceChangeH24: number | null;
  txnsH24: DexTxnCounts | null;
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

/** Pull one timeframe out of a `Record<string, number>`-shaped map. */
function windowNumber(map: unknown, key: string): number | null {
  if (!isRecord(map)) return null;
  return numOrNull(map[key]);
}

/**
 * Project a raw token sub-object (base or quote) to a concise identity row.
 * `DexToken` (base) is non-null on all three fields and `DexQuoteToken` (quote)
 * is nullable; both narrow to the same `string | null` shape here.
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

/** Project the `txns.h24` sub-object defensively to `{buys, sells}` (missing → null). */
function projectTxnsH24(txns: unknown): DexTxnCounts | null {
  if (!isRecord(txns)) return null;
  const h24 = txns.h24;
  if (!isRecord(h24)) return null;
  return {
    buys: typeof h24.buys === "number" ? h24.buys : 0,
    sells: typeof h24.sells === "number" ? h24.sells : 0,
  };
}

// ── Projectors ───────────────────────────────────────────────────

/** Project a raw `DexPair` to the concise, flat, decision-relevant row. */
export function projectPair(pair: DexPair): ConciseDexPair {
  return {
    chainId: typeof pair.chainId === "string" ? pair.chainId : "",
    dexId: typeof pair.dexId === "string" ? pair.dexId : "",
    pairAddress: strOrNull(pair.pairAddress),
    baseToken: projectPairToken(pair.baseToken),
    quoteToken: projectPairToken(pair.quoteToken),
    priceUsd: strOrNull(pair.priceUsd),
    priceNative: strOrNull(pair.priceNative),
    liquidityUsd: isRecord(pair.liquidity) ? numOrNull(pair.liquidity.usd) : null,
    fdv: numOrNull(pair.fdv),
    marketCap: numOrNull(pair.marketCap),
    volumeH24: windowNumber(pair.volume, "h24"),
    priceChangeH1: windowNumber(pair.priceChange, "h1"),
    priceChangeH24: windowNumber(pair.priceChange, "h24"),
    txnsH24: projectTxnsH24(pair.txns),
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
