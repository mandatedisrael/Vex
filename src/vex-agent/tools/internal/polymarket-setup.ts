/**
 * Polymarket setup — derive PER-WALLET CLOB API credentials for the session's
 * selected EVM wallet (puzzle 5 B-core-2).
 *
 * Always visible + idempotent per wallet. No secrets in output — only
 * apiKeyPrefix (first 8 chars). Approval: the dispatcher gates this tool
 * (mutating + restricted + !approved → pendingApproval) BEFORE the handler runs,
 * so a credential derive in a restricted session always waits for approval.
 */

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { ok, fail } from "./types.js";

export async function handlePolymarketSetup(
  _params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const { resolveSelectedAddress, walletScopeErrorToResult } = await import(
    "./wallet/resolve.js"
  );

  // 1. Resolve + policy-validate the EVM wallet for this session (address-only,
  // no key decrypt). A session with no EVM selected / scope drift fails closed.
  let address: string;
  try {
    address = resolveSelectedAddress(context.walletResolution, context.walletPolicy, "eip155");
  } catch (err) {
    return walletScopeErrorToResult(err);
  }

  // 2. Idempotent — already configured for THIS wallet? No re-derive / re-sign.
  const { hasPolyClobCredentials } = await import("@tools/polymarket/auth.js");
  if (hasPolyClobCredentials(address)) {
    return ok({
      configured: true,
      note: "Polymarket CLOB credentials already configured for the selected wallet.",
    });
  }

  // 3. Derive target. The SESSION path MUST derive for the selected wallet id —
  // never an address lookup or a primary fallback. default/CLI/MCP → primary.
  let walletId: string | undefined;
  if (context.walletResolution.source === "session") {
    walletId = context.walletResolution.evm?.id;
    if (!walletId) {
      // resolveSelectedAddress succeeded, so `evm` should be present — this is a
      // defensive fail-closed against selection drift.
      return fail("Wallet scope mismatch: this session has no selectable EVM wallet id.");
    }
  }

  // 4. Derive + persist. Approval is enforced upstream by the dispatcher gate.
  try {
    const { deriveAndSavePolymarketCredentials } = await import("@tools/wallet/polymarket-credentials.js");
    const result = await deriveAndSavePolymarketCredentials(walletId ? { walletId } : {});

    return ok({
      configured: true,
      apiKeyPrefix: result.apiKeyPrefix,
      storage: result.storage,
      note: "Polymarket CLOB credentials saved for the selected wallet. Trading tools (buy/sell/cancel) are now available.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Polymarket setup failed: ${msg}`);
  }
}
