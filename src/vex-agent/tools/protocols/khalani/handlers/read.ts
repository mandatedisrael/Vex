/**
 * Khalani read-only handlers — chains, tokens, quotes, orders.
 */

import { getKhalaniClient } from "@tools/khalani/client.js";
import {
  getCachedKhalaniChains,
  resolveChainId,
} from "@tools/khalani/chains.js";
import {
  getSelectedChainIdsForFamily,
  getTokenBalancesAcrossChains,
  parseBalanceChainSelection,
} from "@tools/khalani/balances.js";
import { walletAddressesEqual, familyToInventory } from "@tools/wallet/inventory.js";
import { prepareQuoteRequest } from "@tools/khalani/request.js";
import { VexError, ErrorCodes } from "../../../../../errors.js";
import type { ChainFamily } from "@tools/khalani/types.js";

import type { ProtocolHandler, ProtocolExecutionContext } from "../../types.js";
import { resolveSelectedAddress } from "../../../internal/wallet/resolve.js";
import { str, toResultData } from "../../handler-helpers.js";

// ── Shared helpers (exported for bridge handler) ────────────────

export async function parseChainIds(raw: string | undefined): Promise<number[] | undefined> {
  if (!raw) return undefined;
  const chains = await getCachedKhalaniChains();
  const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.map(s => resolveChainId(s, chains));
}

export function resolveWalletFamily(params: Record<string, unknown>): ChainFamily {
  const walletFamily = str(params, "wallet") || "eip155";
  if (walletFamily === "eip155" || walletFamily === "solana") return walletFamily;
  throw new VexError(
    ErrorCodes.AGENT_VALIDATION_ERROR,
    `Unsupported wallet family: ${walletFamily}. Use eip155 or solana.`,
  );
}

export function resolveWalletAddress(
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
  walletFamily = resolveWalletFamily(params),
): string {
  const selected = resolveSelectedAddress(context.walletResolution, context.walletPolicy, walletFamily);
  const explicit = str(params, "address");
  if (!explicit) return selected;
  // Default (CLI/MCP) may query an arbitrary explicit address. A session scope
  // is locked to its selected wallet — an explicit address must match it
  // (Codex 5B #2); generic recipient/quote fields are separate params.
  if (context.walletResolution.source === "default") return explicit;
  if (!walletAddressesEqual(familyToInventory(walletFamily), explicit, selected)) {
    throw new VexError(
      ErrorCodes.WALLET_SCOPE_MISMATCH,
      "Explicit address is not the wallet selected for this session.",
    );
  }
  return selected;
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
      data: toResultData(result),
    };
  },

  "khalani.tokens.balances": async (params, context) => {
    const walletFamily = resolveWalletFamily(params);
    const address = resolveWalletAddress(params, context, walletFamily);
    const selection = await parseBalanceChainSelection(str(params, "chainIds"));
    const chainIds = getSelectedChainIdsForFamily(selection, walletFamily);
    if (selection.rawProvided && chainIds?.length === 0) {
      return {
        success: false,
        output: `No ${walletFamily} chains matched chainIds="${str(params, "chainIds")}".`,
      };
    }
    const scan = await getTokenBalancesAcrossChains({ address, family: walletFamily, chainIds });
    return {
      success: true,
      output: JSON.stringify({
        address,
        wallet: walletFamily,
        count: scan.tokens.length,
        totalUsd: scan.totalUsd,
        scannedChainIds: scan.scannedChainIds,
        chainErrors: scan.chainErrors,
        tokens: scan.tokens,
      }, null, 2),
      data: {
        address,
        wallet: walletFamily,
        totalUsd: scan.totalUsd,
        scannedChainIds: scan.scannedChainIds,
        chainErrors: scan.chainErrors,
        tokens: scan.tokens,
      },
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

  "khalani.orders.list": async (params, context) => {
    const address = resolveWalletAddress(params, context);
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
      data: toResultData(order),
    };
  },
};
