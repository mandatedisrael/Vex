/**
 * Pendle market/asset resolution — the SINGLE deterministic source for
 * PT → market / YT / expiry / liquidity and PT/token → USD price.
 *
 * Both the prequote redeem identity (record-time AND gate-time) and the handlers
 * resolve YT from a PT through `resolveMarketByPt` here, so their redeem
 * identities collide by construction. Backed by the client's TTL-cached
 * markets/active + assets/all, so repeated lookups in one flow hit the cache.
 */

import { getPendleClient } from "@tools/pendle/client.js";
import type { PendleAsset, PendleMarket } from "@tools/pendle/types.js";

function eq(a: string | null, b: string): boolean {
  return a !== null && a.toLowerCase() === b.toLowerCase();
}

/** Find the active market whose PT equals `ptAddress`. */
export async function resolveMarketByPt(ptAddress: string): Promise<PendleMarket | null> {
  const markets = await getPendleClient().getActiveMarkets();
  return markets.find((m) => eq(m.pt, ptAddress)) ?? null;
}

/** Find the active market by its market (LP) address. */
export async function resolveMarketByAddress(marketAddress: string): Promise<PendleMarket | null> {
  const markets = await getPendleClient().getActiveMarkets();
  return markets.find((m) => eq(m.address, marketAddress)) ?? null;
}

/** Resolve the canonical YT for a PT (from the active market). */
export async function resolveYtForPt(ptAddress: string): Promise<string | null> {
  return (await resolveMarketByPt(ptAddress))?.yt ?? null;
}

/** Lowercase address → asset (metadata + price), for valuation/enrichment. */
export async function buildAssetMap(): Promise<Map<string, PendleAsset>> {
  const assets = await getPendleClient().getAllAssets();
  const map = new Map<string, PendleAsset>();
  for (const a of assets) map.set(a.address.toLowerCase(), a);
  return map;
}

/** Spot USD price for a token address from the asset map, or null. */
export function priceUsdFor(assetMap: Map<string, PendleAsset>, address: string): number | null {
  return assetMap.get(address.toLowerCase())?.priceUsd ?? null;
}
