/**
 * Polymarket CLOB handlers — orderbook, pricing, trading.
 *
 * Market data: public. Trading: HMAC-SHA256 auth + EIP-712 order signing.
 * All 28 PolyClobClient methods covered (batch GET/POST consolidated).
 *
 * Façade: re-assembles `CLOB_HANDLERS` from the grouped modules under
 * `handlers-clob/` (markets / orders / account). Key names are identical.
 */

import type { ProtocolHandler } from "../types.js";
import { MARKETS_HANDLERS } from "./handlers-clob/markets.js";
import { ORDERS_HANDLERS } from "./handlers-clob/orders.js";
import { ACCOUNT_HANDLERS } from "./handlers-clob/account.js";

export const CLOB_HANDLERS: Record<string, ProtocolHandler> = {
  ...MARKETS_HANDLERS,
  ...ORDERS_HANDLERS,
  ...ACCOUNT_HANDLERS,
};
