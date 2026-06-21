/**
 * Portfolio inspect — DB-backed read-only self-inspection tool.
 *
 * 15 views across 4 families:
 *   Trading: lots, profits, unrealized
 *   Positions: open_positions, closed_positions, orders
 *   Activity: activity, bridges, lp_history, non_trading_history, transactions
 *   Portfolio: summary, balances, snapshots, executions
 *
 * View implementations in inspect-views/*.ts — this file is the router only.
 */

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, num, fail } from "./types.js";
import { resolveSelectedAddressSetForRead, walletScopeErrorToResult } from "./wallet/resolve.js";

// Trading views
import { inspectLots, inspectProfits, inspectUnrealized } from "./inspect-views/trading.js";
// Position views
import { inspectOpenPositions, inspectClosedPositions, inspectOrders } from "./inspect-views/positions.js";
// Activity views
import { inspectActivity, inspectBridges, inspectLpHistory, inspectNonTradingHistory } from "./inspect-views/activity.js";
import { inspectTransactions } from "./inspect-views/transactions.js";
// Portfolio views
import { inspectSummary, inspectBalances, inspectSnapshots, inspectExecutions } from "./inspect-views/portfolio.js";

const VALID_VIEWS = new Set<string>([
  "open_positions", "activity", "executions", "balances", "snapshots", "summary",
  "lots", "profits", "closed_positions", "non_trading_history",
  "bridges", "lp_history", "orders", "unrealized", "transactions",
]);

/**
 * Views scoped to the session's selected wallet set (puzzle 5 phase 5E-2).
 * Only `executions` (a global protocol audit log with no wallet_address) stays
 * unscoped.
 */
const WALLET_SCOPED_VIEWS = new Set<string>([
  "summary", "balances", "snapshots",
  "open_positions", "closed_positions", "orders",
  "lots", "profits", "unrealized",
  "activity", "bridges", "lp_history", "non_trading_history",
  "transactions",
]);

export async function handlePortfolio(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const view = str(params, "view");
  if (!view || !VALID_VIEWS.has(view)) {
    return fail(`Invalid view "${view}". Must be one of: ${[...VALID_VIEWS].join(", ")}`);
  }

  const namespace = str(params, "namespace") || undefined;
  const productType = str(params, "productType") || undefined;
  const limit = num(params, "limit") ?? 20;

  if (WALLET_SCOPED_VIEWS.has(view)) {
    // Resolve the session's selected wallet set (read scope). Fails closed on
    // active-run contract drift / address drift / removed wallet; mission SETUP
    // (no active run) is allowed to read its own selected wallet. A valid
    // session with a family unselected yields a smaller set; empty → empty rows.
    let addresses: string[];
    try {
      addresses = resolveSelectedAddressSetForRead(context.walletResolution, context.walletPolicy).all;
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    switch (view) {
      case "summary": return inspectSummary(addresses);
      case "balances": return inspectBalances(addresses);
      case "snapshots": return inspectSnapshots(addresses);
      case "open_positions": return inspectOpenPositions(addresses, namespace, limit);
      case "closed_positions": return inspectClosedPositions(addresses, namespace, limit);
      case "orders": return inspectOrders(addresses, namespace, str(params, "status") || undefined, limit);
      case "lots": return inspectLots(addresses, str(params, "instrumentKey") || undefined, namespace, str(params, "status") || undefined, limit);
      case "profits": return inspectProfits(addresses, namespace, str(params, "instrumentKey") || undefined, str(params, "groupBy") || undefined);
      case "unrealized": return inspectUnrealized(addresses, namespace);
      case "activity": return inspectActivity(addresses, namespace, productType, limit);
      case "transactions": return inspectTransactions(addresses, context.sessionId, {
        productType,
        namespace,
        txHash: str(params, "txHash") || undefined,
        cursor: str(params, "cursor") || undefined,
        limit,
      });
      case "bridges": return inspectBridges(addresses, namespace, limit);
      case "lp_history": return inspectLpHistory(addresses, namespace, limit);
      case "non_trading_history": return inspectNonTradingHistory(addresses, namespace, limit);
      default: return fail(`Unknown view: ${view}`);
    }
  }

  // `executions` is a global protocol audit log (no wallet_address) — unscoped.
  switch (view) {
    case "executions": return inspectExecutions(namespace, limit);
    default: return fail(`Unknown view: ${view}`);
  }
}
