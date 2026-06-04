/**
 * Portfolio inspection — DB-backed read-only views over the agent's own
 * positions, activity, executions, balances, snapshots, lots, profits.
 */

import type { ToolDef } from "../types.js";

export const PORTFOLIO_TOOLS: readonly ToolDef[] = [
  {
    name: "portfolio", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description: [
      "Read-only view over your own portfolio state, materialized from DB projections — NOT live RPC. The agent owns this surface; do not query third parties for the same data.",
      "View groups (pick one via `view`; see parameters.view.enum for the full set):",
      "- Position state: `summary`, `open_positions`, `closed_positions` — current and historical position rows.",
      "- Holdings: `lots`, `balances`, `snapshots` — per-instrument lots, per-wallet balances, point-in-time snapshots.",
      "- P&L: `profits` (use `groupBy:namespace` to aggregate across protocols), `unrealized` (open-position MTM).",
      "- Activity log: `activity`, `executions`, `non_trading_history` — trade flow and operational events.",
      "- Orders: `orders` (open + recent terminal) — combine with `status` filter.",
      "- Cross-chain: `bridges`, `lp_history` — bridge intents and LP positions over time.",
      "Filters narrow the rows: `namespace` (protocol), `productType` (spot/perps/prediction), `instrumentKey`, `walletAddress`, `status`, `limit`.",
      "Freshness caveat: balances/snapshots reflect the last indexer sync, not on-chain head. For real-time per-token balance (e.g. confirming a swap landed), prefer `wallet_balances` (EVM) or `khalani_tokens_balances`. For instrument prices, use the relevant quote tools in the kyberswap/jupiter/polymarket namespaces.",
    ].join(" "),
    parameters: { type: "object", properties: {
      view: { type: "string", enum: ["open_positions", "activity", "executions", "balances", "snapshots", "summary", "lots", "profits", "closed_positions", "non_trading_history", "bridges", "lp_history", "orders", "unrealized"], description: "What to inspect (see description for group breakdown)" },
      namespace: { type: "string", description: "Protocol filter (e.g. solana, khalani)" },
      productType: { type: "string", description: "Product filter (e.g. spot, perps, prediction)" },
      instrumentKey: { type: "string", description: "Instrument filter (lots, profits)" },
      walletAddress: { type: "string", description: "Wallet filter (profits)" },
      status: { type: "string", description: "Status filter (lots, orders)" },
      groupBy: { type: "string", enum: ["instrument", "namespace"], description: "Group by for profits (default: instrument)" },
      limit: { type: "number", description: "Max rows (default 20)" },
    }, required: ["view"] },
  },
];
