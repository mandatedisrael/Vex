/**
 * Khalani protocol handlers — direct TS client calls.
 *
 * Each handler imports from src/tools/khalani/ and src/commands/khalani/.
 * No CLI spawning, no stdout parsing. Typed all the way through.
 *
 * Read-only handlers: call client method, return data.
 * Bridge handler: full flow (quote → build → execute → submit).
 */

import { getKhalaniClient } from "@tools/khalani/client.js";
import {
  getCachedKhalaniChains,
  resolveChainId,
  getChain,
  getChainFamily,
} from "@tools/khalani/chains.js";
import { requireWalletForChain } from "@tools/wallet/multi-auth.js";
import { requireEvmWallet, requireSolanaWallet } from "@tools/wallet/multi-auth.js";
import { resolveRouteBestIndex } from "@commands/khalani/helpers.js";
import { prepareQuoteRequest } from "@commands/khalani/request.js";
import { executeDepositPlan } from "@commands/khalani/bridge-executor.js";
import type { DepositMethod, QuoteRoute, TradeType } from "@tools/khalani/types.js";
import type { ToolResult } from "../../types.js";
import type { ProtocolHandler, ProtocolExecutionContext } from "../types.js";
import logger from "@utils/logger.js";

// ── Helper ───────────────────────────────────────────────────────

function str(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : "";
}

async function parseChainIds(raw: string | undefined): Promise<number[] | undefined> {
  if (!raw) return undefined;
  const chains = await getCachedKhalaniChains();
  const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.map(s => resolveChainId(s, chains));
}

function resolveWalletAddress(params: Record<string, unknown>): string {
  const explicit = str(params, "address");
  if (explicit) return explicit;

  const walletFamily = str(params, "wallet") || "eip155";
  if (walletFamily === "solana") return requireSolanaWallet().address;
  return requireEvmWallet().address;
}

// ── Handler map ──────────────────────────────────────────────────

export const KHALANI_HANDLERS: Record<string, ProtocolHandler> = {
  "khalani.chains.list": handleChainsList,
  "khalani.tokens.top": handleTokensTop,
  "khalani.tokens.search": handleTokensSearch,
  "khalani.tokens.autocomplete": handleTokensAutocomplete,
  "khalani.tokens.balances": handleTokensBalances,
  "khalani.quote.get": handleQuoteGet,
  "khalani.orders.list": handleOrdersList,
  "khalani.orders.get": handleOrdersGet,
  "khalani.bridge": handleBridge,
};

// ── Read-only handlers ───────────────────────────────────────────

async function handleChainsList(params: Record<string, unknown>): Promise<ToolResult> {
  const refresh = params.refresh === true;
  const chains = await getCachedKhalaniChains(refresh);
  return {
    success: true,
    output: JSON.stringify({ chains: chains.length, data: chains }, null, 2),
    data: { chains },
  };
}

async function handleTokensTop(params: Record<string, unknown>): Promise<ToolResult> {
  const chainIds = await parseChainIds(str(params, "chainIds"));
  const tokens = await getKhalaniClient().getTopTokens(chainIds);
  return {
    success: true,
    output: JSON.stringify({ count: tokens.length, tokens }, null, 2),
    data: { tokens },
  };
}

async function handleTokensSearch(params: Record<string, unknown>): Promise<ToolResult> {
  const query = str(params, "query");
  if (!query) return { success: false, output: "Missing required parameter: query" };

  const chainIds = await parseChainIds(str(params, "chainIds"));
  const result = await getKhalaniClient().searchTokens(query, chainIds);
  return {
    success: true,
    output: JSON.stringify({ count: result.data.length, tokens: result.data }, null, 2),
    data: { tokens: result.data },
  };
}

async function handleTokensAutocomplete(params: Record<string, unknown>): Promise<ToolResult> {
  const keyword = str(params, "keyword");
  if (!keyword) return { success: false, output: "Missing required parameter: keyword" };

  const chainIds = await parseChainIds(str(params, "chainIds"));
  const limit = typeof params.limit === "number" ? params.limit : undefined;
  const result = await getKhalaniClient().autocompleteToken(keyword, { chainIds, limit });
  return {
    success: true,
    output: JSON.stringify(result, null, 2),
    data: result as unknown as Record<string, unknown>,
  };
}

async function handleTokensBalances(params: Record<string, unknown>): Promise<ToolResult> {
  const address = resolveWalletAddress(params);
  const chainIds = await parseChainIds(str(params, "chainIds"));
  const tokens = await getKhalaniClient().getTokenBalances(address, chainIds);
  return {
    success: true,
    output: JSON.stringify({ address, count: tokens.length, tokens }, null, 2),
    data: { address, tokens },
  };
}

async function handleQuoteGet(params: Record<string, unknown>): Promise<ToolResult> {
  const fromChain = str(params, "fromChain");
  const toChain = str(params, "toChain");
  const fromToken = str(params, "fromToken");
  const toToken = str(params, "toToken");
  const amount = str(params, "amount");

  if (!fromChain || !toChain || !fromToken || !toToken || !amount) {
    return { success: false, output: "Missing required parameters: fromChain, toChain, fromToken, toToken, amount" };
  }

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

  const quoteResponse = await getKhalaniClient().getQuotes(prepared.request);

  return {
    success: true,
    output: JSON.stringify({
      quoteId: quoteResponse.quoteId,
      routeCount: quoteResponse.routes.length,
      routes: quoteResponse.routes.map(r => ({
        routeId: r.routeId,
        type: r.type,
        amountIn: r.quote.amountIn,
        amountOut: r.quote.amountOut,
        etaSeconds: r.quote.expectedDurationSeconds,
        tags: r.quote.tags,
      })),
    }, null, 2),
    data: { quoteId: quoteResponse.quoteId, routes: quoteResponse.routes },
  };
}

async function handleOrdersList(params: Record<string, unknown>): Promise<ToolResult> {
  const address = resolveWalletAddress(params);
  const chains = await getCachedKhalaniChains();
  const limit = typeof params.limit === "number" ? params.limit : undefined;
  const cursor = typeof params.cursor === "number" ? params.cursor : undefined;
  const fromChainId = str(params, "fromChain") ? resolveChainId(str(params, "fromChain"), chains) : undefined;
  const toChainId = str(params, "toChain") ? resolveChainId(str(params, "toChain"), chains) : undefined;
  const orderIds = str(params, "orderIds") || undefined;
  const txHashSearch = str(params, "txHashSearch") || undefined;

  const result = await getKhalaniClient().getOrders(address, {
    limit, cursor, fromChainId, toChainId, orderIds, txHashSearch,
  });
  return {
    success: true,
    output: JSON.stringify({ count: result.data.length, cursor: result.cursor, orders: result.data }, null, 2),
    data: { orders: result.data, cursor: result.cursor },
  };
}

async function handleOrdersGet(params: Record<string, unknown>): Promise<ToolResult> {
  const orderId = str(params, "orderId");
  if (!orderId) return { success: false, output: "Missing required parameter: orderId" };

  const order = await getKhalaniClient().getOrderById(orderId);
  return {
    success: true,
    output: JSON.stringify(order, null, 2),
    data: order as unknown as Record<string, unknown>,
  };
}

// ── Bridge handler (mutating) ────────────────────────────────────

async function handleBridge(
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<ToolResult> {
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
}
