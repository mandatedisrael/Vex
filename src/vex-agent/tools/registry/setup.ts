/**
 * Setup / configuration tools — bootstrap credentials and one-shot config.
 *
 * `polymarket_setup` is hidden once the API key env var is set.
 */

import type { ToolDef } from "../types.js";

export const SETUP_TOOLS: readonly ToolDef[] = [
  {
    name: "polymarket_setup", kind: "internal", mutating: true, pressureSafety: "mutating", actionKind: "local_write",
    showOnlyWhenEnvMissing: "POLYMARKET_API_KEY",
    excludeRoles: ["subagent"],
    description: "Derive and save Polymarket CLOB API credentials from your wallet keystore. Run this to enable Polymarket trading tools (buy/sell/cancel). No parameters needed — credentials are derived automatically from your configured wallet.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];
