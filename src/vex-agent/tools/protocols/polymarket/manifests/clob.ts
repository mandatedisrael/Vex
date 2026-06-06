/**
 * CLOB manifest façade (A-036 structural split).
 *
 * The CLOB manifest objects were split VERBATIM into per-resource chunk
 * modules under `./clob/` (markets / orders / account by toolId prefix). This
 * file stays a compatibility façade that re-assembles the SAME single
 * `CLOB_TOOLS` export.
 *
 * The original array is INTERLEAVED in its authenticated tail: `trades`
 * (account), `simplifiedMarkets` (markets), `rebates`+`heartbeat` (account),
 * `cancelOrders` (orders), `orderScoring` (account) appear in that exact
 * sequence. Each chunk therefore exports named segments sized to the original
 * contiguous runs, and the façade spreads them in the order that reproduces
 * the EXACT original `CLOB_TOOLS.map(t => t.toolId)` sequence (byte-identical).
 */

import type { ProtocolToolManifest } from "../../types.js";
import { CLOB_MARKETS_HEAD, CLOB_MARKETS_SIMPLIFIED } from "./clob/markets.js";
import { CLOB_ORDERS_CORE, CLOB_ORDERS_CANCEL_ORDERS } from "./clob/orders.js";
import {
  CLOB_ACCOUNT_TRADES,
  CLOB_ACCOUNT_REBATES_HEARTBEAT,
  CLOB_ACCOUNT_ORDER_SCORING,
} from "./clob/account.js";

export const CLOB_TOOLS: readonly ProtocolToolManifest[] = [
  ...CLOB_MARKETS_HEAD, // 1–15: orderbook … feeRate
  ...CLOB_ORDERS_CORE, // 16–22: buy … order
  ...CLOB_ACCOUNT_TRADES, // 23: trades
  ...CLOB_MARKETS_SIMPLIFIED, // 24: simplifiedMarkets
  ...CLOB_ACCOUNT_REBATES_HEARTBEAT, // 25–26: rebates, heartbeat
  ...CLOB_ORDERS_CANCEL_ORDERS, // 27: cancelOrders
  ...CLOB_ACCOUNT_ORDER_SCORING, // 28: orderScoring
];
