/**
 * Polymarket CLOB handlers — authenticated account.
 *
 * Trades, rebates, heartbeat, order scoring — keyed to the selected wallet.
 */

import { getPolyClobClient } from "@tools/polymarket/clob/client.js";
import { resolveSelectedAddress, walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";
import type { ProtocolHandler } from "../../types.js";
import { str, ok, fail } from "../../handler-helpers.js";

export const ACCOUNT_HANDLERS: Record<string, ProtocolHandler> = {
  "polymarket.clob.trades": async (p, ctx) => {
    let address: string;
    try {
      address = resolveSelectedAddress(ctx.walletResolution, ctx.walletPolicy, "eip155");
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    return ok(await getPolyClobClient().getTrades({ address }, {
      id: str(p, "id") || undefined,
      maker_address: address,
      market: str(p, "market") || undefined,
      asset_id: str(p, "assetId") || undefined,
      before: str(p, "before") || undefined,
      after: str(p, "after") || undefined,
      next_cursor: str(p, "cursor") || undefined,
    }));
  },

  "polymarket.clob.rebates": async (p) => {
    const date = str(p, "date"), makerAddress = str(p, "makerAddress");
    if (!date || !makerAddress) return fail("Missing required: date, makerAddress");
    return ok(await getPolyClobClient().getRebates(date, makerAddress));
  },

  "polymarket.clob.heartbeat": async (_p, ctx) => {
    let address: string;
    try {
      address = resolveSelectedAddress(ctx.walletResolution, ctx.walletPolicy, "eip155");
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    return ok(await getPolyClobClient().sendHeartbeat({ address }));
  },

  "polymarket.clob.orderScoring": async (p, ctx) => {
    const orderId = str(p, "orderId");
    if (!orderId) return fail("Missing required: orderId");
    let address: string;
    try {
      address = resolveSelectedAddress(ctx.walletResolution, ctx.walletPolicy, "eip155");
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    return ok(await getPolyClobClient().getOrderScoring({ address }, orderId));
  },
};
