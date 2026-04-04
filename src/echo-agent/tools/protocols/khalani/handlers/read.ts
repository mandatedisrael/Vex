/**
 * Khalani read-only handlers — chains, tokens, quotes, orders.
 */

import { getKhalaniClient } from "@tools/khalani/client.js";
import {
  getCachedKhalaniChains,
  resolveChainId,
} from "@tools/khalani/chains.js";
import { requireEvmWallet, requireSolanaWallet } from "@tools/wallet/multi-auth.js";
import { prepareQuoteRequest } from "@tools/khalani/request.js";

import type { ProtocolHandler } from "../../types.js";
import { str } from "../../handler-helpers.js";

// ── Shared helpers (exported for bridge handler) ────────────────

export async function parseChainIds(raw: string | undefined): Promise<number[] | undefined> {
  if (!raw) return undefined;
  const chains = await getCachedKhalaniChains();
  const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.map(s => resolveChainId(s, chains));
}

export function resolveWalletAddress(params: Record<string, unknown>): string {
  const explicit = str(params, "address");
  if (explicit) return explicit;

  const walletFamily = str(params, "wallet") || "eip155";
  if (walletFamily === "solana") return requireSolanaWallet().address;
  return requireEvmWallet().address;
}

// ── Handler map ──────────────────────────────────────────────────

export const READ_HANDLERS: Record<string, ProtocolHandler> = {
  "khalani.chains.list": async (params) => {
    const refresh = params.refresh === true;
    const chains = await getCachedKhalaniChains(refresh);
    return {
      success: true,
      output: JSON.stringify({ chains: chains.length, data: chains }, null, 2),
      data: { chains },
    };
  },

  "khalani.tokens.top": async (params) => {
    const chainIds = await parseChainIds(str(params, "chainIds"));
    const tokens = await getKhalaniClient().getTopTokens(chainIds);
    return {
      success: true,
      output: JSON.stringify({ count: tokens.length, tokens }, null, 2),
      data: { tokens },
    };
  },

  "khalani.tokens.search": async (params) => {
    const query = str(params, "query");
    if (!query) return { success: false, output: "Missing required parameter: query" };

    const chainIds = await parseChainIds(str(params, "chainIds"));
    const result = await getKhalaniClient().searchTokens(query, chainIds);
    return {
      success: true,
      output: JSON.stringify({ count: result.data.length, tokens: result.data }, null, 2),
      data: { tokens: result.data },
    };
  },

  "khalani.tokens.autocomplete": async (params) => {
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
  },

  "khalani.tokens.balances": async (params) => {
    const address = resolveWalletAddress(params);
    const chainIds = await parseChainIds(str(params, "chainIds"));
    const tokens = await getKhalaniClient().getTokenBalances(address, chainIds);
    return {
      success: true,
      output: JSON.stringify({ address, count: tokens.length, tokens }, null, 2),
      data: { address, tokens },
    };
  },

  "khalani.quote.get": async (params) => {
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
  },

  "khalani.orders.list": async (params) => {
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
  },

  "khalani.orders.get": async (params) => {
    const orderId = str(params, "orderId");
    if (!orderId) return { success: false, output: "Missing required parameter: orderId" };

    const order = await getKhalaniClient().getOrderById(orderId);
    return {
      success: true,
      output: JSON.stringify(order, null, 2),
      data: order as unknown as Record<string, unknown>,
    };
  },
};
