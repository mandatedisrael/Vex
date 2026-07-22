/**
 * Setup / configuration tools — bootstrap credentials and one-shot config.
 *
 * `polymarket_setup` derives PER-WALLET CLOB creds for the session's selected
 * EVM wallet (puzzle 5 B-core-2). It is ALWAYS visible (no `showOnlyWhenEnvMissing`
 * env gate) so the agent can configure ANY session wallet, not just the primary;
 * the handler is idempotent per wallet (returns "already configured" when creds
 * for the selected wallet already exist).
 *
 * KNOWN LIMITATION (Option A, Codex B-core-2 ruling): the polymarket trading
 * manifests still gate on `requiresEnv: POLYMARKET_API_KEY`, so a session that
 * has ONLY non-primary creds (the primary was never configured) won't see the
 * trading tools. Configuring the primary (onboarding) covers the common path; a
 * fully session-aware trading-tool gate is a separate stage if needed.
 */

import type { ToolDef } from "../types.js";

export const SETUP_TOOLS: readonly ToolDef[] = [
  {
    name: "polymarket_setup", kind: "internal", mutating: true, pressureSafety: "mutating", actionKind: "local_write",
    description: "Derive and save Polymarket CLOB API credentials for THIS SESSION's selected EVM wallet. Run this to enable Polymarket trading (buy/sell/cancel) for the active wallet. Idempotent — returns 'already configured' if the selected wallet already has credentials. No parameters.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];
