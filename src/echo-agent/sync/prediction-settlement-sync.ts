/**
 * Prediction settlement sync — closes zombie prediction positions.
 *
 * Jupiter Prediction and Polymarket settle via on-chain keepers, bypassing
 * execute_tool. This module polls read APIs to detect settlements and creates
 * synthetic captures that flow through the standard pipeline.
 *
 * Algorithm: wallet-grouped. One API call per unique wallet, local matching.
 *
 * Jupiter settlement semantics:
 *   position_lost              → status "closed", no outputValueUsd
 *   position_won + !claimed    → status "closed", payout in meta only
 *   position_won + claimed     → status "claimed", outputValueUsd = payoutAmountUsd
 *
 * Polymarket settlement semantics:
 *   in closedPositions         → status "closed", realizedPnl in meta
 */

import { query } from "@echo-agent/db/client.js";
import { parseInstrumentKey } from "./instrument-key.js";
import { recordSyntheticCapture } from "./synthetic-capture.js";
import logger from "@utils/logger.js";

export interface SettlementResult {
  checked: number;
  closed: number;
  skipped: number;
  errors: number;
}

/**
 * Reconcile open prediction positions against protocol APIs.
 * Creates synthetic captures for settled positions.
 */
export async function reconcilePredictionSettlements(): Promise<SettlementResult> {
  const result: SettlementResult = { checked: 0, closed: 0, skipped: 0, errors: 0 };

  // Get all open prediction positions
  const positions = await query<Record<string, unknown>>(
    `SELECT id, namespace, instrument_key, position_key, wallet_address, contracts, notional_usd, data
     FROM proj_open_positions
     WHERE position_type = 'prediction' AND status = 'open'`,
    [],
  );

  if (positions.length === 0) return result;

  result.checked = positions.length;

  // Group by namespace + wallet
  const groups = new Map<string, typeof positions>();
  for (const pos of positions) {
    const key = `${pos.namespace}:${pos.wallet_address}`;
    const group = groups.get(key) ?? [];
    group.push(pos);
    groups.set(key, group);
  }

  for (const [groupKey, groupPositions] of groups) {
    const namespace = groupPositions[0].namespace as string;
    const walletAddress = groupPositions[0].wallet_address as string;

    try {
      if (namespace === "solana") {
        const groupResult = await reconcileJupiterSettlements(walletAddress, groupPositions);
        result.closed += groupResult.closed;
        result.skipped += groupResult.skipped;
        result.errors += groupResult.errors;
      } else if (namespace === "polymarket") {
        const groupResult = await reconcilePolymarketSettlements(walletAddress, groupPositions);
        result.closed += groupResult.closed;
        result.skipped += groupResult.skipped;
        result.errors += groupResult.errors;
      } else {
        result.skipped += groupPositions.length;
      }
    } catch (err) {
      result.errors += groupPositions.length;
      logger.warn("sync.settlement.group_failed", {
        groupKey, namespace,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.closed > 0 || result.errors > 0) {
    logger.info("sync.settlement.completed", result);
  }

  return result;
}

// ── Jupiter Prediction ─────────────────────────────────────────────

async function reconcileJupiterSettlements(
  walletAddress: string,
  positions: Record<string, unknown>[],
): Promise<{ closed: number; skipped: number; errors: number }> {
  let closed = 0, skipped = 0, errors = 0;

  const { getJupiterPredictionHistory, getJupiterPredictionPositions } = await import(
    "@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/service.js"
  );

  // Fetch ALL history pages — settlement event may be beyond first 100 entries
  const allHistoryEvents: Awaited<ReturnType<typeof getJupiterPredictionHistory>>["data"] = [];
  const PAGE_SIZE = 100;
  let historyStart = 0;
  let hasMore = true;
  while (hasMore) {
    const page = await getJupiterPredictionHistory({ ownerPubkey: walletAddress, start: historyStart, end: historyStart + PAGE_SIZE });
    const events = page.data ?? [];
    allHistoryEvents.push(...events);
    hasMore = page.pagination?.hasNext === true && events.length === PAGE_SIZE;
    historyStart += PAGE_SIZE;
  }

  const positionsResp = await getJupiterPredictionPositions({ ownerPubkey: walletAddress });

  const historyEvents = allHistoryEvents;
  const apiPositions = positionsResp.data ?? [];

  // Build lookup maps
  const settlementByPositionPubkey = new Map<string, typeof historyEvents[number]>();
  for (const event of historyEvents) {
    if (event.eventType === "position_lost" || event.eventType === "position_won") {
      settlementByPositionPubkey.set(event.positionPubkey, event);
    }
  }

  const apiPositionByPubkey = new Map<string, typeof apiPositions[number]>();
  for (const pos of apiPositions) {
    apiPositionByPubkey.set(pos.pubkey, pos);
  }

  for (const dbPos of positions) {
    const positionKey = dbPos.position_key as string;
    if (!positionKey) { skipped++; continue; }

    const settlementEvent = settlementByPositionPubkey.get(positionKey);
    if (!settlementEvent) { skipped++; continue; }

    const instrumentKey = dbPos.instrument_key as string | null;
    const apiPosition = apiPositionByPubkey.get(positionKey);

    // Determine status based on event type + claimed state
    let status: string;
    let outputValueUsd: string | undefined;

    if (settlementEvent.eventType === "position_lost") {
      status = "closed";
      // No outputValueUsd — payout is $0
    } else if (settlementEvent.eventType === "position_won") {
      if (apiPosition?.claimed === true) {
        status = "claimed";
        outputValueUsd = settlementEvent.payoutAmountUsd;
      } else {
        // Won but not yet claimed — close position, payout in meta only
        status = "closed";
      }
    } else {
      skipped++;
      continue;
    }

    try {
      await recordSyntheticCapture({
        toolId: "settlement_sync.jupiter",
        namespace: "solana",
        tradeCapture: {
          type: "prediction",
          chain: "solana",
          status,
          walletAddress,
          positionKey,
          instrumentKey: instrumentKey ?? undefined,
          ...(outputValueUsd ? { outputValueUsd } : {}),
          ...(settlementEvent.totalCostUsd ? { inputValueUsd: settlementEvent.totalCostUsd } : {}),
          valuationSource: outputValueUsd ? "prediction_exact" : "none",
          settlementAssetKey: "USDC",
          meta: {
            source: "settlement_sync",
            eventType: settlementEvent.eventType,
            contractsSettled: settlementEvent.contractsSettled,
            realizedPnl: settlementEvent.realizedPnl,
            grossProceedsUsd: settlementEvent.grossProceedsUsd,
            payoutAmountUsd: settlementEvent.payoutAmountUsd,
            settledAt: settlementEvent.timestamp,
            claimed: apiPosition?.claimed ?? false,
          },
        },
        source: "settlement_sync",
      });
      closed++;
    } catch (err) {
      errors++;
      logger.warn("sync.settlement.jupiter_position_failed", {
        positionKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { closed, skipped, errors };
}

// ── Polymarket ─────────────────────────────────────────────────────

async function reconcilePolymarketSettlements(
  eoaWalletAddress: string,
  positions: Record<string, unknown>[],
): Promise<{ closed: number; skipped: number; errors: number }> {
  let closed = 0, skipped = 0, errors = 0;

  // Derive proxy wallet from EOA via relayer
  let proxyWallet: string;
  try {
    const { getPolyRelayerClient } = await import("@tools/polymarket/relayer/client.js");
    const payload = await getPolyRelayerClient().getRelayPayload(eoaWalletAddress, "SAFE");
    proxyWallet = payload.address;
    if (!proxyWallet) {
      logger.warn("sync.settlement.polymarket_no_proxy", { eoaWalletAddress });
      return { closed: 0, skipped: positions.length, errors: 0 };
    }
  } catch (err) {
    logger.warn("sync.settlement.polymarket_proxy_failed", {
      eoaWalletAddress,
      error: err instanceof Error ? err.message : String(err),
    });
    return { closed: 0, skipped: positions.length, errors: 0 };
  }

  // One API call per proxy wallet
  const { getPolyDataClient } = await import("@tools/polymarket/data/client.js");
  const closedPositions = await getPolyDataClient().getClosedPositions(proxyWallet);

  // Build lookup: conditionId:outcome → closedPosition (case-insensitive on outcome)
  const closedByKey = new Map<string, typeof closedPositions[number]>();
  for (const cp of closedPositions) {
    if (cp.conditionId && cp.outcome) {
      const key = `${cp.conditionId}:${cp.outcome.toUpperCase()}`;
      closedByKey.set(key, cp);
    }
  }

  for (const dbPos of positions) {
    const instrumentKey = dbPos.instrument_key as string | null;
    const positionKey = dbPos.position_key as string | null;
    if (!instrumentKey || !positionKey) { skipped++; continue; }

    const parsed = parseInstrumentKey(instrumentKey);
    if (parsed.kind !== "prediction" || !parsed.marketId || !parsed.side) { skipped++; continue; }

    // Match: polymarket:{conditionId}:{outcome} → conditionId:OUTCOME (normalized)
    const lookupKey = `${parsed.marketId}:${parsed.side.toUpperCase()}`;
    const closedPos = closedByKey.get(lookupKey);
    if (!closedPos) { skipped++; continue; }

    try {
      await recordSyntheticCapture({
        toolId: "settlement_sync.polymarket",
        namespace: "polymarket",
        tradeCapture: {
          type: "prediction",
          chain: "polygon",
          status: "closed",
          walletAddress: eoaWalletAddress,
          positionKey,
          instrumentKey,
          valuationSource: "none",
          settlementAssetKey: "USDC",
          meta: {
            source: "settlement_sync",
            realizedPnl: closedPos.realizedPnl,
            avgPrice: closedPos.avgPrice,
            settledAt: closedPos.timestamp,
          },
        },
        source: "settlement_sync",
      });
      closed++;
    } catch (err) {
      errors++;
      logger.warn("sync.settlement.polymarket_position_failed", {
        positionKey, instrumentKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { closed, skipped, errors };
}
