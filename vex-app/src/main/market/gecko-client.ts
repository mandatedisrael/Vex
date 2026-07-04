/**
 * GeckoTerminal OHLCV client — the trailing hourly closes that feed the VEX
 * sparkline (T1). DexScreener has no candle endpoint; GeckoTerminal's public
 * OHLCV feed does (~30 req/min free, we poll 1/min).
 *
 * Tolerant by design: only the timestamp (col 0) + close (col 4) of each
 * `ohlcv_list` row are consumed, so extra columns or minor shape drift do not
 * break the widget. The upstream returns rows newest-first; we sort ascending
 * so the sparkline reads left→right oldest→newest.
 */

import { z } from "zod";
import { fetchJsonWithTimeout } from "./market-http.js";

/** VEX/VIRTUAL Uniswap-V2 pool on Robinhood chain (plan §3; on-chain verified). */
const VEX_GECKO_OHLCV_URL =
  "https://api.geckoterminal.com/api/v2/networks/robinhood/pools/" +
  "0x817f16f5d8da83d1b089b082c0172af3923618da/ohlcv/hour?aggregate=1&limit=24";

// Each row is [timestamp, open, high, low, close, volume]. A bare number array
// (min length 5) tolerates extra trailing columns without failing validation.
const geckoOhlcvSchema = z.object({
  data: z.object({
    attributes: z.object({
      ohlcv_list: z.array(z.array(z.number()).min(5)).max(1000),
    }),
  }),
});

/** Fetch the trailing hourly closes as `[unixSeconds, closeUsd]`, oldest first. */
export async function fetchVexSparkline(
  url: string = VEX_GECKO_OHLCV_URL,
): Promise<Array<[number, number]>> {
  const raw = await fetchJsonWithTimeout(url);
  const parsed = geckoOhlcvSchema.parse(raw);
  const points: Array<[number, number]> = [];
  for (const row of parsed.data.attributes.ohlcv_list) {
    const ts = row[0];
    const close = row[4];
    if (
      typeof ts === "number" &&
      Number.isFinite(ts) &&
      typeof close === "number" &&
      Number.isFinite(close)
    ) {
      points.push([ts, close]);
    }
  }
  points.sort((a, b) => a[0] - b[0]);
  return points;
}
