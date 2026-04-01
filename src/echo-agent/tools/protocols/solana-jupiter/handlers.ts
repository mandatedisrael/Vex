/**
 * Solana/Jupiter protocol handlers — retained tools only.
 *
 * All handlers import from src/tools/solana-ecosystem/jupiter/ shelves.
 * No legacy src/tools/chains/solana/ imports.
 */

import {
  searchJupiterTokens,
  getJupiterTokensByCategory,
  getJupiterTokensByTag,
  getJupiterRecentTokens,
} from "@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js";
import type {
  JupiterTokenCategory,
  JupiterTokenTag,
  JupiterTokenInterval,
} from "@tools/solana-ecosystem/jupiter/jupiter-tokens/types.js";
import { getJupiterPricesByMint } from "@tools/solana-ecosystem/jupiter/jupiter-prices/service.js";
import {
  getJupiterSwapQuote,
  executeJupiterSwap,
} from "@tools/solana-ecosystem/jupiter/jupiter-swaps/service.js";
import {
  getJupiterLendEarnTokens,
  getJupiterLendEarnPositions,
  getJupiterLendEarnEarnings,
  executeJupiterLendEarnDeposit,
  executeJupiterLendEarnWithdraw,
} from "@tools/solana-ecosystem/jupiter/jupiter-lend/earn-api/service.js";
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
import { classifySolanaSwap } from "@tools/solana-ecosystem/shared/swap-classify.js";
import { requireSolanaWallet } from "@tools/wallet/multi-auth.js";

import type { ToolResult } from "../../types.js";
import type { ProtocolHandler } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────

function str(p: Record<string, unknown>, k: string): string {
  const v = p[k]; return typeof v === "string" ? v : "";
}
function num(p: Record<string, unknown>, k: string): number | undefined {
  const v = p[k]; return typeof v === "number" ? v : undefined;
}
function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}
function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}
function walletAddress(p: Record<string, unknown>): string {
  const explicit = str(p, "address");
  if (explicit) return explicit;
  return requireSolanaWallet().address;
}
function walletSecret(): Uint8Array {
  return requireSolanaWallet().secretKey;
}

// ── Category routing for tokens.trending ─────────────────────────

const CATEGORY_MAP: Record<string, JupiterTokenCategory> = {
  toptrending: "toptrending",
  toptraded: "toptraded",
  toporganicscore: "toporganicscore",
};
const TAG_MAP: Record<string, JupiterTokenTag> = {
  lst: "lst",
  verified: "verified",
};

// ── Handler map ──────────────────────────────────────────────────

export const SOLANA_JUPITER_HANDLERS: Record<string, ProtocolHandler> = {
  // Core — prices
  "solana.prices": async (p) => {
    const mints = str(p, "mints").split(",").map(s => s.trim()).filter(Boolean);
    if (mints.length === 0) return fail("Missing required parameter: mints");
    const prices = await getJupiterPricesByMint(mints);
    return ok(prices);
  },

  // Core — token search
  "solana.tokens.search": async (p) => {
    const q = str(p, "query");
    if (!q) return fail("Missing required parameter: query");
    return ok(await searchJupiterTokens(q));
  },

  // Core — token trending (routes to category, recent, or tag)
  "solana.tokens.trending": async (p) => {
    const category = str(p, "category") || "toptrending";
    const interval = (str(p, "interval") || "1h") as JupiterTokenInterval;
    const limit = num(p, "limit") ?? 20;

    if (category === "recent") {
      return ok(await getJupiterRecentTokens());
    }
    if (category in TAG_MAP) {
      return ok(await getJupiterTokensByTag(TAG_MAP[category]));
    }
    const jupiterCategory = CATEGORY_MAP[category] ?? "toptrending";
    return ok(await getJupiterTokensByCategory({ category: jupiterCategory, interval, limit }));
  },

  // Swap
  "solana.swap.quote": async (p) => {
    const input = str(p, "inputToken"), output = str(p, "outputToken");
    const amount = num(p, "amount");
    if (!input || !output || amount == null) return fail("Missing required: inputToken, outputToken, amount");
    const { quote } = await getJupiterSwapQuote(input, output, amount, { slippageBps: num(p, "slippageBps") });
    return ok(quote);
  },
  "solana.swap.execute": async (p) => {
    const input = str(p, "inputToken"), output = str(p, "outputToken");
    const amount = num(p, "amount");
    if (!input || !output || amount == null) return fail("Missing required: inputToken, outputToken, amount");
    const result = await executeJupiterSwap(input, output, amount, walletSecret(), { slippageBps: num(p, "slippageBps") });
    const cls = classifySolanaSwap(result.inputToken.address, result.outputToken.address);

    // Side-aware unitPriceUsd (best-effort, from human-readable amounts)
    let unitPriceUsd: string | undefined;
    if (cls.tradeSide === "buy" && result.order.inUsdValue != null) {
      const outputUi = parseFloat(result.outputAmount);
      if (outputUi > 0) unitPriceUsd = String(result.order.inUsdValue / outputUi);
    } else if (cls.tradeSide === "sell" && result.order.outUsdValue != null) {
      const inputUi = parseFloat(result.inputAmount);
      if (inputUi > 0) unitPriceUsd = String(result.order.outUsdValue / inputUi);
    }

    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "swap", chain: "solana", status: "executed",
          inputToken: result.inputToken.symbol, outputToken: result.outputToken.symbol,
          inputTokenAddress: result.inputToken.address, outputTokenAddress: result.outputToken.address,
          inputAmount: result.inputAmountRaw, outputAmount: result.outputAmountRaw,
          signature: result.signature, walletAddress: walletAddress(p),
          tradeSide: cls.tradeSide, instrumentKey: `solana:${cls.instrumentMint}`,
          inputValueUsd: result.order.inUsdValue != null ? String(result.order.inUsdValue) : undefined,
          outputValueUsd: result.order.outUsdValue != null ? String(result.order.outUsdValue) : undefined,
          unitPriceUsd,
          valuationSource: result.order.inUsdValue != null ? "jupiter_exact" : "none",
          meta: { inputAmountUi: result.inputAmount, outputAmountUi: result.outputAmount, ...cls.meta },
        },
      },
    };
  },

  // Predictions
  "solana.predict.events": async (p) => {
    const result = await getJupiterPredictionEvents({
      category: (str(p, "category") || undefined) as any,
      filter: (str(p, "filter") || undefined) as any,
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
  "solana.predict.positions": async (p) => ok(await getJupiterPredictionPositions({ ownerPubkey: walletAddress(p) })),
  "solana.predict.history": async (p) => {
    const start = num(p, "offset") ?? 0;
    const limit = num(p, "limit") ?? 10;
    return ok(await getJupiterPredictionHistory({
      ownerPubkey: walletAddress(p),
      start,
      end: start + limit,
    }));
  },
  "solana.predict.buy": async (p) => {
    const marketId = str(p, "marketId"), side = str(p, "side");
    const amount = num(p, "amountUsdc");
    if (!marketId || !side || amount == null) return fail("Missing required: marketId, side, amountUsdc");
    const normalizedSide = side.toLowerCase();
    if (normalizedSide !== "yes" && normalizedSide !== "no") return fail('side must be "yes" or "no"');
    const isYes = normalizedSide === "yes";
    const depositAmount = Math.round(amount * 1_000_000);
    const result = await executeJupiterPredictionCreateOrder(walletSecret(), {
      marketId, isYes, isBuy: true, depositAmount, depositMint: JUPITER_PREDICTION_USDC_MINT,
    });
    const positionPubkey = result.raw.order.positionPubkey;
    const order = result.raw.order;
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        positionPubkey,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "open",
          walletAddress: walletAddress(p), tradeSide: "buy",
          positionKey: positionPubkey, instrumentKey: `solana:predict:${marketId}:${normalizedSide}`,
          inputValueUsd: order.orderCostUsd,
          unitPriceUsd: order.newAvgPriceUsd,
          feeValueUsd: order.estimatedTotalFeeUsd,
          valuationSource: "prediction_exact",
          meta: { marketId, side: normalizedSide, sizeUsd: order.newSizeUsd, payoutUsd: order.newPayoutUsd },
        },
      },
    };
  },
  "solana.predict.sell": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    const result = await executeJupiterPredictionClosePosition(walletSecret(), pk);
    const order = result.raw.order;
    const outcome = order.isYes ? "yes" : "no";
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "closed",
          walletAddress: walletAddress(p), tradeSide: "sell",
          positionKey: pk,
          instrumentKey: `solana:predict:${order.marketId}:${outcome}`,
          inputValueUsd: order.orderCostUsd,
          unitPriceUsd: order.newAvgPriceUsd,
          feeValueUsd: order.estimatedTotalFeeUsd,
          valuationSource: "prediction_exact",
          meta: { positionPubkey: pk, marketId: order.marketId, side: outcome, sizeUsd: order.newSizeUsd, payoutUsd: order.newPayoutUsd },
        },
      },
    };
  },
  "solana.predict.claim": async (p) => {
    const pk = str(p, "positionPubkey");
    if (!pk) return fail("Missing required: positionPubkey");
    const result = await executeJupiterPredictionClaimPosition(walletSecret(), pk);
    const pos = result.raw.position;
    const outcome = pos.isYes ? "yes" : "no";
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "prediction", chain: "solana", status: "claimed",
          walletAddress: walletAddress(p), positionKey: pk,
          outputValueUsd: pos.payoutAmountUsd,
          valuationSource: "prediction_exact",
          // No instrumentKey — claim response has marketPubkey (account address), not marketId.
          // Downstream matches via positionKey from the buy capture.
          meta: { positionPubkey: pk, side: outcome, payoutAmountUsd: pos.payoutAmountUsd },
        },
      },
    };
  },
  "solana.predict.closeAll": async (p) => {
    const result = await executeJupiterPredictionCloseAllPositions(walletSecret());
    const wallet = walletAddress(p);

    const captureItems = result.results.map(item => {
      let pk: string | undefined;
      let marketId: string | undefined;
      let outcome: string | undefined;
      let itemValuation: Record<string, string | undefined> = {};

      if ("order" in item.raw) {
        const order = item.raw.order;
        pk = order.positionPubkey;
        marketId = order.marketId;
        outcome = order.isYes ? "yes" : "no";
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
        ...itemValuation,
        meta: { kind: item.kind, positionPubkey: pk, outcome },
      };
    });

    return {
      success: true,
      output: JSON.stringify(result, null, 2),
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

  // Lending
  "solana.lend.rates": async () => ok(await getJupiterLendEarnTokens()),
  "solana.lend.positions": async (p) => {
    const addr = walletAddress(p);
    const positions = await getJupiterLendEarnPositions(addr);
    const posAddresses = positions.map(pos => pos.token.assetAddress).filter(Boolean);
    const earningsResult = posAddresses.length > 0
      ? await getJupiterLendEarnEarnings(addr, posAddresses)
      : null;
    return ok({ positions, earnings: earningsResult?.earnings ?? [], earningsRaw: earningsResult?.raw });
  },
  "solana.lend.deposit": async (p) => {
    const asset = str(p, "asset"), amount = str(p, "amount");
    if (!asset || !amount) return fail("Missing required: asset, amount");
    const result = await executeJupiterLendEarnDeposit(walletSecret(), asset, amount);
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "lend", chain: "solana", status: "executed",
          walletAddress: walletAddress(p), inputTokenAddress: asset, inputAmount: amount,
          meta: { action: "deposit", asset },
        },
      },
    };
  },
  "solana.lend.withdraw": async (p) => {
    const asset = str(p, "asset"), amount = str(p, "amount");
    if (!asset || !amount) return fail("Missing required: asset, amount");
    const result = await executeJupiterLendEarnWithdraw(walletSecret(), asset, amount);
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "lend", chain: "solana", status: "executed",
          walletAddress: walletAddress(p), inputTokenAddress: asset, inputAmount: amount,
          meta: { action: "withdraw", asset },
        },
      },
    };
  },
};
