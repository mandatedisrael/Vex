/**
 * Solana/Jupiter prediction market handlers.
 */

import {
  getJupiterPredictionEvents,
  searchJupiterPredictionEvents,
  getJupiterPredictionMarket,
  getJupiterPredictionEvent,
  getJupiterPredictionPosition,
  getJupiterPredictionPositions,
  getJupiterPredictionHistory,
  executeJupiterPredictionCreateOrder,
  executeJupiterPredictionClosePosition,
  executeJupiterPredictionCloseAllPositions,
  executeJupiterPredictionClaimPosition,
} from "@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/service.js";
import { JUPITER_PREDICTION_USDC_MINT } from "@tools/solana-ecosystem/jupiter/jupiter-prediction/constants.js";

import type { ProtocolHandler } from "../../types.js";
import { str, num, ok, fail, enumField } from "../../handler-helpers.js";
import { walletAddress, walletSecret } from "./core.js";
import { walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";

// ── SDK enum mirrors ──────────────────────────────────────────────
// Source: `JupiterPredictionCategory` + `JupiterPredictionFilter` in
// `@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/types/base.ts`.
const PREDICT_CATEGORY = [
  "all", "crypto", "sports", "politics", "esports", "culture", "economics", "tech",
] as const;
const PREDICT_FILTER = ["new", "live", "trending"] as const;

// ── Handler map ──────────────────────────────────────────────────

export const PREDICT_HANDLERS: Record<string, ProtocolHandler> = {
  "solana.predict.events": async (p) => {
    const result = await getJupiterPredictionEvents({
      category: enumField(p, "category", PREDICT_CATEGORY),
      filter: enumField(p, "filter", PREDICT_FILTER),
      includeMarkets: true,
    });
    return ok(result);
  },
  "solana.predict.search": async (p) => {
    const q = str(p, "query");
    if (!q) return fail("Missing required: query");
    return ok(await searchJupiterPredictionEvents({ query: q }));
  },
  "solana.predict.market": async (p) => {
    const id = str(p, "marketId");
    if (!id) return fail("Missing required: marketId");
    return ok(await getJupiterPredictionMarket(id));
  },
  "solana.predict.positions": async (p, ctx) => {
    let owner: string;
    try {
      owner = walletAddress(p, ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    return ok(await getJupiterPredictionPositions({ ownerPubkey: owner }));
  },
  "solana.predict.history": async (p, ctx) => {
    let owner: string;
    try {
      owner = walletAddress(p, ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const start = num(p, "offset") ?? 0;
    const limit = num(p, "limit") ?? 10;
    return ok(await getJupiterPredictionHistory({
      ownerPubkey: owner,
      start,
      end: start + limit,
    }));
  },
  "solana.predict.buy": async (p, ctx) => {
    const marketId = str(p, "marketId"), side = str(p, "side");
    const amount = num(p, "amountUsdc");
    if (!marketId || !side || amount == null) return fail("Missing required: marketId, side, amountUsdc");
    const normalizedSide = side.toLowerCase();
    if (normalizedSide !== "yes" && normalizedSide !== "no") return fail('side must be "yes" or "no"');
    const isYes = normalizedSide === "yes";
    const depositAmount = Math.round(amount * 1_000_000);
    // Resolve owner + signer BEFORE broadcast (5D-protocols p2).
    let addr: string, secret: Uint8Array;
    try {
      addr = walletAddress(p, ctx);
      secret = walletSecret(ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const result = await executeJupiterPredictionCreateOrder(secret, {
      marketId, isYes, isBuy: true, depositAmount, depositMint: JUPITER_PREDICTION_USDC_MINT,
    });
    const positionPubkey = result.raw.order.positionPubkey;
    const order = result.raw.order;
    return {
      success: true,
      // Lean view (P0-2): drop the base64 VersionedTransaction + build internals
      // carried on `result.raw`; the full result + _tradeCapture stay in `data`.
      output: JSON.stringify({
        signature: result.signature,
        explorerUrl: result.explorerUrl,
        positionPubkey,
        marketId,
        side: normalizedSide,
        sizeUsd: order.newSizeUsd,
        payoutUsd: order.newPayoutUsd,
        contracts: order.newContracts,
        avgPriceUsd: order.newAvgPriceUsd,
        costUsd: order.orderCostUsd,
        feeUsd: order.estimatedTotalFeeUsd,
      }, null, 2),
      data: {
        ...result,
        positionPubkey,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "open",
          walletAddress: addr, tradeSide: "buy",
          positionKey: positionPubkey, instrumentKey: `solana:predict:${marketId}:${normalizedSide}`,
          inputValueUsd: order.orderCostUsd,
          unitPriceUsd: order.newAvgPriceUsd,
          feeValueUsd: order.estimatedTotalFeeUsd,
          valuationSource: "prediction_exact",
          settlementAssetKey: "USDC",
          meta: { marketId, side: normalizedSide, sizeUsd: order.newSizeUsd, payoutUsd: order.newPayoutUsd, contracts: order.newContracts },
        },
      },
    };
  },
  "solana.predict.sell": async (p, ctx) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    let addr: string, secret: Uint8Array;
    try {
      addr = walletAddress(p, ctx);
      secret = walletSecret(ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const result = await executeJupiterPredictionClosePosition(secret, pk);
    const order = result.raw.order;
    const outcome = order.isYes ? "yes" : "no";
    return {
      success: true,
      // Lean view (P0-2): drop the base64 tx; full result + _tradeCapture in data.
      output: JSON.stringify({
        signature: result.signature,
        explorerUrl: result.explorerUrl,
        positionPubkey: pk,
        marketId: order.marketId,
        side: outcome,
        sizeUsd: order.newSizeUsd,
        payoutUsd: order.newPayoutUsd,
        contracts: order.contracts,
        avgPriceUsd: order.newAvgPriceUsd,
        costUsd: order.orderCostUsd,
        feeUsd: order.estimatedTotalFeeUsd,
      }, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "closed",
          walletAddress: addr, tradeSide: "sell",
          positionKey: pk,
          instrumentKey: `solana:predict:${order.marketId}:${outcome}`,
          inputValueUsd: order.orderCostUsd,
          unitPriceUsd: order.newAvgPriceUsd,
          feeValueUsd: order.estimatedTotalFeeUsd,
          valuationSource: "prediction_exact",
          settlementAssetKey: "USDC",
          meta: { positionPubkey: pk, marketId: order.marketId, side: outcome, sizeUsd: order.newSizeUsd, payoutUsd: order.newPayoutUsd, contracts: order.contracts },
        },
      },
    };
  },
  "solana.predict.claim": async (p, ctx) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    let addr: string, secret: Uint8Array;
    try {
      addr = walletAddress(p, ctx);
      secret = walletSecret(ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const result = await executeJupiterPredictionClaimPosition(secret, pk);
    const pos = result.raw.position;
    const outcome = pos.isYes ? "yes" : "no";
    return {
      success: true,
      // Lean view (P0-2): drop the base64 tx; full result + _tradeCapture in data.
      output: JSON.stringify({
        signature: result.signature,
        explorerUrl: result.explorerUrl,
        positionPubkey: pk,
        side: outcome,
        payoutAmountUsd: pos.payoutAmountUsd,
        contracts: pos.contracts,
      }, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "claimed",
          walletAddress: addr, positionKey: pk,
          outputValueUsd: pos.payoutAmountUsd,
          valuationSource: "prediction_exact",
          settlementAssetKey: "USDC",
          // No instrumentKey — claim response has marketPubkey (account address), not marketId.
          // Downstream matches via positionKey from the buy capture.
          meta: { positionPubkey: pk, side: outcome, payoutAmountUsd: pos.payoutAmountUsd, contracts: pos.contracts },
        },
      },
    };
  },
  "solana.predict.closeAll": async (p, ctx) => {
    // Resolve owner + signer BEFORE broadcast (5D-protocols p2).
    let wallet: string, secret: Uint8Array;
    try {
      wallet = walletAddress(p, ctx);
      secret = walletSecret(ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const result = await executeJupiterPredictionCloseAllPositions(secret);

    const captureItems = result.results.map(item => {
      let pk: string | undefined;
      let marketId: string | undefined;
      let outcome: string | undefined;
      let itemValuation: Record<string, string | undefined> = {};

      let contracts: string | undefined;

      if ("order" in item.raw) {
        const order = item.raw.order;
        pk = order.positionPubkey;
        marketId = order.marketId;
        outcome = order.isYes ? "yes" : "no";
        contracts = order.contracts;
        itemValuation = {
          inputValueUsd: order.orderCostUsd,
          unitPriceUsd: order.newAvgPriceUsd,
          feeValueUsd: order.estimatedTotalFeeUsd,
          valuationSource: "prediction_exact",
        };
      } else if ("position" in item.raw) {
        const pos = item.raw.position;
        pk = pos.positionPubkey;
        outcome = pos.isYes ? "yes" : "no";
        contracts = pos.contracts;
        itemValuation = {
          outputValueUsd: pos.payoutAmountUsd,
          valuationSource: "prediction_exact",
        };
      }

      return {
        type: "prediction" as const, chain: "solana" as const,
        status: item.kind === "claim" ? "claimed" as const : "closed" as const,
        walletAddress: wallet, tradeSide: "sell" as const,
        signature: item.signature,
        positionKey: pk,
        instrumentKey: marketId && outcome ? `solana:predict:${marketId}:${outcome}` : undefined,
        settlementAssetKey: "USDC",
        ...itemValuation,
        meta: { kind: item.kind, positionPubkey: pk, outcome, contracts },
      };
    });

    // Lean view (P0-2): closeAll otherwise DOUBLE-embeds every position's base64
    // tx (result.raw + each results[].raw). Summarise from the captured items;
    // the full result + _tradeCapture(+Items) stay in the (dropped) `data`.
    const closed = captureItems.map((c) => ({
      kind: c.meta.kind,
      signature: c.signature,
      positionPubkey: c.meta.positionPubkey,
      outcome: c.meta.outcome,
      contracts: c.meta.contracts,
    }));
    return {
      success: true,
      output: JSON.stringify({ count: result.results.length, closed }, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "closed",
          walletAddress: wallet, tradeSide: "sell",
          signature: result.results[0]?.signature,
          meta: { action: "closeAll", count: result.results.length },
        },
        _tradeCaptureItems: captureItems,
      },
    };
  },
  "solana.predict.event": async (p) => {
    const id = str(p, "eventId");
    if (!id) return fail("Missing required: eventId");
    return ok(await getJupiterPredictionEvent({ eventId: id, includeMarkets: true }));
  },
  "solana.predict.position": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    return ok(await getJupiterPredictionPosition(pk));
  },
};
