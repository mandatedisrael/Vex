/**
 * VEX pair projector — the price side of the market snapshot (T1).
 *
 * Reuses the root DexScreener client via the main-only `@tools` alias (same
 * precedent as `agent/sync-worker.ts` importing `@vex-agent/*`). The client's
 * own Zod validators guard the wire shape; this module projects the ONE VEX
 * pair into the finite-number-or-null fields the widget needs (`priceUsd` is a
 * string upstream → parsed here; every other field is coerced to a finite
 * number or `null`, never fabricated).
 *
 * NOTE on side effects: importing `@tools/dexscreener/client.js` pulls only
 * module-level function/const definitions — its `loadConfig()` (which touches
 * the config dir) runs lazily inside `getDexScreenerClient()`, not at import
 * time — so this stays inert until the poller actually calls it.
 */

import { getDexScreenerClient } from "@tools/dexscreener/client.js";

/** Robinhood-chain VEX/VIRTUAL Uniswap-V2 pair (plan §3; on-chain verified). */
const VEX_CHAIN_SLUG = "robinhood";
const VEX_PAIR_ADDRESS = "0x817f16F5D8da83d1B089B082c0172af3923618dA";

export interface VexPairData {
  readonly priceUsd: number | null;
  readonly priceChange: {
    readonly h1: number | null;
    readonly h24: number | null;
  };
  readonly marketCap: number | null;
  readonly fdv: number | null;
  readonly liquidityUsd: number | null;
  readonly volumeH24: number | null;
  readonly txnsH24: { readonly buys: number; readonly sells: number } | null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parsePriceUsd(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Fetch + project the live VEX pair. Throws when DexScreener is unreachable or
 * returns no VEX pair — the poller catches this and re-broadcasts last-good
 * data marked `stale`.
 */
export async function fetchVexPair(): Promise<VexPairData> {
  const response = await getDexScreenerClient().getPairs(
    VEX_CHAIN_SLUG,
    VEX_PAIR_ADDRESS,
  );
  const pair = response.pairs?.[0] ?? null;
  if (pair === null) {
    throw new Error("DexScreener returned no VEX pair");
  }

  const txns = pair.txns?.h24 ?? null;
  const buys = txns === null ? null : finiteOrNull(txns.buys);
  const sells = txns === null ? null : finiteOrNull(txns.sells);

  return {
    priceUsd: parsePriceUsd(pair.priceUsd),
    priceChange: {
      h1: finiteOrNull(pair.priceChange?.h1),
      h24: finiteOrNull(pair.priceChange?.h24),
    },
    marketCap: finiteOrNull(pair.marketCap),
    fdv: finiteOrNull(pair.fdv),
    liquidityUsd: finiteOrNull(pair.liquidity?.usd ?? null),
    volumeH24: finiteOrNull(pair.volume?.h24),
    txnsH24:
      buys === null || sells === null
        ? null
        : { buys: Math.max(0, Math.trunc(buys)), sells: Math.max(0, Math.trunc(sells)) },
  };
}
