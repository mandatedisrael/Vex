import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { KHALANI_INTERNAL_TO_PROTOCOL } from "../registry/khalani.js";
import type { KhalaniInternalToolName } from "../registry/khalani.js";
import { executeProtocolTool } from "../protocols/runtime.js";

type InternalHandler = (
  params: Record<string, unknown>,
  context: InternalToolContext,
) => Promise<ToolResult>;

function makeKhalaniAliasHandler(name: KhalaniInternalToolName): InternalHandler {
  return async (params, context) => executeProtocolTool(
    { toolId: KHALANI_INTERNAL_TO_PROTOCOL[name], params },
    {
      sessionPermission: context.sessionPermission,
      approved: context.approved,
      sessionId: context.sessionId,
      walletResolution: context.walletResolution,
      walletPolicy: context.walletPolicy,
    },
  );
}

export const handleKhalaniChainsList = makeKhalaniAliasHandler("khalani_chains_list");
export const handleKhalaniTokensTop = makeKhalaniAliasHandler("khalani_tokens_top");
export const handleKhalaniTokensSearch = makeKhalaniAliasHandler("khalani_tokens_search");
export const handleKhalaniTokensBalances = makeKhalaniAliasHandler("khalani_tokens_balances");
