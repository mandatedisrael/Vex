/**
 * Mark-to-market — refresh current_value_usd / unrealized_pnl_usd on open prediction positions.
 *
 * Jupiter Prediction: exit price from sellYesPriceUsd / sellNoPriceUsd.
 * Polymarket: exit price from CLOB SELL price (public endpoint, no API key).
 *
 * Resilience: per-position try/catch, dedup marketIds, timeout via existing clients.
 * SQL-side math: UPDATE SET current_value_usd = contracts * $markPrice::numeric.
 */

import { query, execute } from "@echo-agent/db/client.js";
import { parseInstrumentKey } from "./instrument-key.js";
import logger from "@utils/logger.js";

export interface MtmResult {
  updated: number;
  skipped: number;
  errors: number;
}

export async function refreshPredictionMtm(): Promise<MtmResult> {
  const result: MtmResult = { updated: 0, skipped: 0, errors: 0 };

  // Get all open prediction positions
  const positions = await query<Record<string, unknown>>(
    `SELECT id, namespace, instrument_key, contracts, notional_usd, data
     FROM proj_open_positions
     WHERE position_type = 'prediction' AND status = 'open'`,
    [],
  );

  if (positions.length === 0) return result;

  // ── Jupiter Prediction MTM ──────────────────────────────────
  const jupiterPositions = positions.filter(p => p.namespace === "solana");
  if (jupiterPositions.length > 0) {
    // Dedup marketIds
    const marketMap = new Map<string, { side: string; positionIds: number[]; contracts: string; notionalUsd: string | null }[]>();
    for (const pos of jupiterPositions) {
      const parsed = parseInstrumentKey(pos.instrument_key as string);
      if (parsed.kind !== "prediction" || !parsed.marketId || !parsed.side) { result.skipped++; continue; }
      if (pos.contracts == null) { result.skipped++; continue; }

      const existing = marketMap.get(parsed.marketId) ?? [];
      existing.push({
        side: parsed.side,
        positionIds: [pos.id as number],
        contracts: String(pos.contracts),
        notionalUsd: pos.notional_usd != null ? String(pos.notional_usd) : null,
      });
      marketMap.set(parsed.marketId, existing);
    }

    // Fetch prices per unique marketId
    for (const [marketId, entries] of marketMap) {
      try {
        const { getJupiterPredictionMarket } = await import(
          "@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/service.js"
        );
        const market = await getJupiterPredictionMarket(marketId);
        const pricing = market.pricing;
        if (!pricing) { result.skipped += entries.length; continue; }

        for (const entry of entries) {
          // Exit price rule: yes → sellYes, no → sellNo
          const markPrice = entry.side === "yes"
            ? pricing.sellYesPriceUsd
            : pricing.sellNoPriceUsd;

          if (markPrice == null) { result.skipped++; continue; }

          for (const posId of entry.positionIds) {
            try {
              // SQL-side math: current_value = contracts * markPrice, unrealized = current_value - notional
              await execute(
                `UPDATE proj_open_positions
                 SET current_value_usd = contracts * $2::numeric,
                     unrealized_pnl_usd = contracts * $2::numeric - notional_usd,
                     last_refresh_at = NOW()
                 WHERE id = $1 AND status = 'open'`,
                [posId, String(markPrice)],
              );
              result.updated++;
            } catch (err) {
              result.errors++;
              logger.warn("sync.mtm.position_failed", {
                positionId: posId, marketId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err) {
        result.errors += entries.length;
        logger.warn("sync.mtm.market_fetch_failed", {
          marketId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ── Polymarket Prediction MTM ───────────────────────────────
  const polyPositions = positions.filter(p => p.namespace === "polymarket");
  for (const pos of polyPositions) {
    if (pos.contracts == null) { result.skipped++; continue; }

    const data = pos.data as Record<string, unknown> | null;
    const tokenId = (data as Record<string, unknown>)?.tokenId as string | undefined;
    if (!tokenId) { result.skipped++; continue; }

    try {
      const { getPolyClobClient } = await import("@tools/polymarket/clob/client.js");
      const priceResp = await getPolyClobClient().getPrice(tokenId, "SELL");
      const markPrice = priceResp.price;

      if (markPrice == null || markPrice <= 0) { result.skipped++; continue; }

      await execute(
        `UPDATE proj_open_positions
         SET current_value_usd = contracts * $2::numeric,
             unrealized_pnl_usd = contracts * $2::numeric - notional_usd,
             last_refresh_at = NOW()
         WHERE id = $1 AND status = 'open'`,
        [pos.id, String(markPrice)],
      );
      result.updated++;
    } catch (err) {
      result.errors++;
      logger.warn("sync.mtm.polymarket_failed", {
        positionId: pos.id, tokenId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.updated > 0 || result.errors > 0) {
    logger.info("sync.mtm.completed", result);
  }

  return result;
}
