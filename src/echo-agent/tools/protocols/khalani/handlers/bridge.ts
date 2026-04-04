/**
 * Khalani bridge handler — full flow (quote → build → execute → submit).
 */

import { getKhalaniClient } from "@tools/khalani/client.js";
import {
  getCachedKhalaniChains,
  getChain,
} from "@tools/khalani/chains.js";
import { resolveRouteBestIndex } from "@tools/khalani/helpers.js";
import { prepareQuoteRequest } from "@tools/khalani/request.js";
import { executeDepositPlan } from "@tools/khalani/bridge-executor.js";
import type { DepositMethod, QuoteRoute } from "@tools/khalani/types.js";
import type { ToolResult } from "../../../types.js";
import type { ProtocolHandler, ProtocolExecutionContext } from "../../types.js";
import logger from "@utils/logger.js";

import { str } from "../../handler-helpers.js";

// ── Handler map ──────────────────────────────────────────────────

export const BRIDGE_HANDLERS: Record<string, ProtocolHandler> = {
  "khalani.bridge": async (
    params: Record<string, unknown>,
    context: ProtocolExecutionContext,
  ): Promise<ToolResult> => {
    const client = getKhalaniClient();

    const fromChain = str(params, "fromChain");
    const toChain = str(params, "toChain");
    const fromToken = str(params, "fromToken");
    const toToken = str(params, "toToken");
    const amount = str(params, "amount");

    if (!fromChain || !toChain || !fromToken || !toToken || !amount) {
      return { success: false, output: "Missing required parameters: fromChain, toChain, fromToken, toToken, amount" };
    }

    // 1. Prepare quote request (resolves aliases, normalizes addresses, parses hex amounts)
    const prepared = await prepareQuoteRequest({
      fromChain,
      fromToken,
      toChain,
      toToken,
      amount,
      tradeType: str(params, "tradeType") || undefined,
      fromAddress: str(params, "fromAddress") || undefined,
      recipient: str(params, "recipient") || undefined,
      refundTo: str(params, "refundTo") || undefined,
      referrer: str(params, "referrer") || undefined,
      referrerFeeBps: str(params, "referrerFeeBps") || undefined,
      filler: str(params, "filler") || undefined,
    });

    const { chains, fromChainId, toChainId, request } = prepared;
    const sourceChain = getChain(fromChainId, chains);

    // 2. Quote
    const routeIdParam = str(params, "routeId");
    const quoteResponse = await client.getQuotes(
      request,
      routeIdParam ? { routes: [routeIdParam] } : undefined,
    );

    if (quoteResponse.routes.length === 0) {
      return { success: false, output: "No routes available for this bridge." };
    }

    // 3. Select route
    let selectedRoute: QuoteRoute;
    if (routeIdParam) {
      const found = quoteResponse.routes.find(r => r.routeId === routeIdParam);
      if (!found) return { success: false, output: `Route ${routeIdParam} not found in quote.` };
      selectedRoute = found;
    } else {
      selectedRoute = quoteResponse.routes[resolveRouteBestIndex(quoteResponse.routes)];
    }

    // 4. Check freshness
    const expiresAt = selectedRoute.quote.quoteExpiresAt ?? selectedRoute.quote.validBefore;
    if (expiresAt > 0 && Date.now() >= expiresAt * 1000) {
      return { success: false, output: "Quote has expired. Re-request a fresh quote." };
    }

    // 5. Build deposit plan (needed for BOTH dryRun and execute)
    const depositMethod = str(params, "depositMethod") as DepositMethod | "";
    const plan = await client.buildDeposit({
      from: request.fromAddress,
      quoteId: quoteResponse.quoteId,
      routeId: selectedRoute.routeId,
      ...(depositMethod ? { depositMethod } : {}),
    });

    // 6. Dry run — return quote + deposit plan without executing
    if (params.dryRun === true) {
      return {
        success: true,
        output: JSON.stringify({
          dryRun: true,
          quoteId: quoteResponse.quoteId,
          route: {
            routeId: selectedRoute.routeId,
            type: selectedRoute.type,
            amountIn: selectedRoute.quote.amountIn,
            amountOut: selectedRoute.quote.amountOut,
            etaSeconds: selectedRoute.quote.expectedDurationSeconds,
          },
          depositPlan: plan,
          sourceChain,
          destinationChain: getChain(toChainId, chains),
        }, null, 2),
      };
    }

    // 7. Execute deposit
    logger.info("khalani.bridge.executing", {
      fromChain: fromChainId,
      toChain: toChainId,
      routeId: selectedRoute.routeId,
      planKind: plan.kind,
    });

    const result = await executeDepositPlan(
      plan,
      sourceChain,
      chains,
      quoteResponse.quoteId,
      selectedRoute.routeId,
    );

    // 9. Return result with trade capture data
    const bridgeResult = {
      orderId: result.orderId,
      txHash: result.txHash,
      fromChain: fromChainId,
      toChain: toChainId,
      fromToken,
      toToken,
      amount,
      routeType: selectedRoute.type,
      amountOut: selectedRoute.quote.amountOut,
      etaSeconds: selectedRoute.quote.expectedDurationSeconds,
    };

    return {
      success: true,
      output: JSON.stringify({ success: true, ...bridgeResult }, null, 2),
      data: {
        ...bridgeResult,
        // Trade capture hint — runtime uses this to auto-store
        _tradeCapture: {
          type: "bridge",
          chain: String(fromChainId),
          status: "pending",
          inputToken: fromToken,
          inputTokenAddress: fromToken,
          inputAmount: amount,
          outputToken: toToken,
          outputTokenAddress: toToken,
          outputAmount: selectedRoute.quote.amountOut,
          signature: result.txHash,
          walletAddress: request.fromAddress,
          meta: {
            sourceChain: String(fromChainId),
            destChain: String(toChainId),
            routeId: selectedRoute.routeId,
            orderId: result.orderId,
          },
        },
      },
    };
  },
};
