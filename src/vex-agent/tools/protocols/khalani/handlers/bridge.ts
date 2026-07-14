/**
 * Khalani bridge handler — full flow (quote → build → execute → submit).
 */

import { getKhalaniClient } from "@tools/khalani/client.js";
import {
  getCachedKhalaniChains,
  getChain,
  getChainFamily,
  resolveChainId,
} from "@tools/khalani/chains.js";
import { resolveRouteBestIndex } from "@tools/khalani/helpers.js";
import { prepareQuoteRequest } from "@tools/khalani/request.js";
import { executeDepositPlan } from "@tools/khalani/bridge-executor.js";
import { pollKhalaniOrderToTerminal } from "@tools/khalani/order-status.js";
import type { DepositMethod, QuoteRoute } from "@tools/khalani/types.js";
import type { ChainWallet } from "@tools/wallet/multi-auth.js";
import { familyToInventory, walletAddressesEqual } from "@tools/wallet/inventory.js";
import { resolveSelectedAddress, resolveSigningWallet, walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";
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

    // Per-session wallet scope (5D-protocols p4). Resolve source/dest chain
    // families up front so the bridge uses the session's selected wallets: the
    // deposit signs with the SOURCE-family wallet, funds land at the dest-family
    // recipient. prepareQuoteRequest re-resolves these cached chains (cheap).
    const chains = await getCachedKhalaniChains();
    let fromFamily: "eip155" | "solana";
    let toFamily: "eip155" | "solana";
    try {
      fromFamily = getChainFamily(resolveChainId(fromChain, chains), chains);
      toFamily = getChainFamily(resolveChainId(toChain, chains), chains);
    } catch (err) {
      return { success: false, output: err instanceof Error ? err.message : String(err) };
    }

    // Source address: the session's selected wallet for the source family. An
    // explicit fromAddress under a session must match it — never override session
    // scope (fail-closed, before quote and before signing).
    const explicitFrom = str(params, "fromAddress") || undefined;
    let fromAddress: string;
    try {
      fromAddress = resolveSelectedAddress(context.walletResolution, context.walletPolicy, fromFamily);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    if (
      context.walletResolution.source === "session" && explicitFrom
      && !walletAddressesEqual(familyToInventory(fromFamily), explicitFrom, fromAddress)
    ) {
      return { success: false, output: "The provided fromAddress does not match the session's selected wallet for the source chain." };
    }

    // Recipient: an explicit address is honored (bridging to another address is
    // valid); otherwise the session's selected dest-family wallet (fail-closed
    // if neither is available).
    const explicitRecipient = str(params, "recipient") || undefined;
    let recipient: string;
    try {
      recipient = explicitRecipient ?? resolveSelectedAddress(context.walletResolution, context.walletPolicy, toFamily);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }

    // 1. Prepare quote request (resolves aliases, normalizes addresses, parses hex amounts)
    const prepared = await prepareQuoteRequest({
      fromChain,
      fromToken,
      toChain,
      toToken,
      amount,
      tradeType: str(params, "tradeType") || undefined,
      fromAddress,
      recipient,
      refundTo: str(params, "refundTo") || undefined,
      referrer: str(params, "referrer") || undefined,
      referrerFeeBps: str(params, "referrerFeeBps") || undefined,
      filler: str(params, "filler") || undefined,
    });

    const { fromChainId, toChainId, request } = prepared;
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

    // Source-family signing wallet — resolved AFTER the dryRun gate, just before broadcast.
    let signer: ChainWallet;
    try {
      signer = resolveSigningWallet(context.walletResolution, context.walletPolicy, fromFamily);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }

    const result = await executeDepositPlan({
      plan,
      sourceChain,
      chains,
      quoteId: quoteResponse.quoteId,
      routeId: selectedRoute.routeId,
      signer,
    });

    // 9. Track the submitted order to a TERMINAL state (Khalani Integration
    // Guide). The deposit tx mining does NOT mean the destination leg filled —
    // the fill can still fail or refund. Bounded (5s × 24 ≈ 2 min) so a turn
    // never blocks forever; mirrors relay.bridge's terminal-status handling.
    const poll = await pollKhalaniOrderToTerminal(result.orderId);

    const bridgeBase = {
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

    // Status could NOT be verified: EVERY getOrderById poll failed (Khalani status
    // API unreachable for the whole window). Do NOT mask a total verification
    // outage as a benign pending order — that would enqueue a projection for a
    // status nobody observed. Fail closed, NO _tradeCapture, and surface the
    // orderId + deposit tx hash so the user can verify the order manually.
    if (poll.kind === "unavailable") {
      logger.warn("khalani.bridge.status_unverifiable", {
        fromChain: fromChainId,
        toChain: toChainId,
        orderId: result.orderId,
      });
      const message = `Khalani order status could NOT be verified — the Khalani status API was unreachable for the entire tracking window. The deposit was broadcast but delivery is UNCONFIRMED. Do NOT re-bridge; verify the order manually via orderId=${result.orderId} (deposit txHash=${result.txHash}).`;
      return {
        success: false,
        output: JSON.stringify({ success: false, ...bridgeBase, status: "unverified", message }, null, 2),
        data: { ...bridgeBase, status: "unverified" },
      };
    }

    const finalStatus = poll.status;
    const bridgeResult = { ...bridgeBase, status: finalStatus };

    // Terminal failure/refund: the destination amount did NOT arrive. Fail the
    // tool result and emit NO _tradeCapture — nothing arrived to record. Mirrors
    // relay.bridge (PR #27): venue truth drives tool-result truth.
    if (finalStatus === "failed" || finalStatus === "refunded") {
      logger.warn("khalani.bridge.terminal_failure", {
        fromChain: fromChainId,
        toChain: toChainId,
        finalStatus,
        orderId: result.orderId,
      });
      const message = finalStatus === "refunded"
        ? "Khalani reported this bridge as refunded: the destination amount did NOT arrive; funds were returned toward the refund address. Verify balances before any follow-up."
        : "Khalani reported this bridge as failed: the destination amount did NOT arrive. Verify balances via the order id before retrying.";
      return {
        success: false,
        output: JSON.stringify({ success: false, ...bridgeResult, message }, null, 2),
        data: { ...bridgeResult },
      };
    }

    logger.info("khalani.bridge.completed", {
      fromChain: fromChainId,
      toChain: toChainId,
      finalStatus,
      orderId: result.orderId,
    });

    // filled → confirmed delivery. Any NON-terminal status here means the bounded
    // poll window closed while the order was still live (created/deposited/
    // published/refund_pending) — keep the pending capture (the order is live and
    // may still complete) BUT the output must never read as delivery. A
    // refund_pending is called out explicitly: a refund is in flight, NOT yet
    // delivered, and the destination amount did NOT arrive.
    const captureStatus = finalStatus === "filled" ? "executed" : "pending";
    const pendingMessage = finalStatus === "filled"
      ? undefined
      : finalStatus === "refund_pending"
        ? 'Khalani has NOT confirmed this bridge — the last status was "refund_pending": a refund is IN FLIGHT but not yet delivered, and the destination amount did NOT arrive. Do NOT re-bridge; track the order id.'
        : `Khalani has NOT confirmed this bridge yet — the last status after the poll window was "${finalStatus}". It may still complete; track the order id before any retry. Do NOT re-bridge.`;

    return {
      success: true,
      output: JSON.stringify({
        success: true,
        ...bridgeResult,
        ...(pendingMessage ? { message: pendingMessage } : {}),
      }, null, 2),
      data: {
        ...bridgeResult,
        // Trade capture hint — runtime uses this to auto-store
        _tradeCapture: {
          type: "bridge",
          chain: String(fromChainId),
          status: captureStatus,
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
            finalStatus,
          },
        },
      },
    };
  },
};
