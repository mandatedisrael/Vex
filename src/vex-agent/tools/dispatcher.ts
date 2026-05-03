/**
 * Tool dispatcher — routes tool calls to the correct handler.
 *
 * The engine calls dispatchTool() for every tool call from the LLM.
 * Dispatcher decides: internal tool → direct handler, or
 * discover/execute → protocol runtime.
 *
 * Internal tool handlers are lazy-imported so a dispatch for one handler
 * never forces the rest of the internal tool modules into memory. PR1
 * replaced a 25-case `switch` with a typed `INTERNAL_TOOL_LOADERS` map —
 * same lazy semantics, data-driven, and the completeness test structurally
 * catches orphaned entries.
 */

import type { ToolCallRequest, ToolResult } from "./types.js";
import type { InternalToolContext } from "./internal/types.js";
import { isInternalTool, isToolBlockedForRole } from "./registry.js";
import { discoverProtocolCapabilities } from "./protocols/runtime.js";
import { executeProtocolTool } from "./protocols/runtime.js";
import { logDiscoveryTelemetry, newDiscoveryRunId } from "./protocols/discovery.telemetry.js";
import { toResultData } from "./protocols/handler-helpers.js";
import logger from "@utils/logger.js";

/**
 * Dispatch a tool call to the appropriate handler.
 *
 * Returns a ToolResult that the engine feeds back to the LLM.
 * Never throws — errors are caught and returned as failed results.
 */
export async function dispatchTool(
  call: ToolCallRequest,
  context: InternalToolContext,
): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const result = await routeToolCall(call, context);
    const durationMs = Date.now() - startTime;

    logger.debug("tools.dispatch.completed", {
      tool: call.name,
      success: result.success,
      durationMs,
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    logger.warn("tools.dispatch.failed", {
      tool: call.name,
      error: message,
      durationMs,
    });

    return { success: false, output: `Tool ${call.name} failed: ${message}` };
  }
}

// ── Routing ──────────────────────────────────────────────────────

async function routeToolCall(
  call: ToolCallRequest,
  context: InternalToolContext,
): Promise<ToolResult> {
  // Protocol meta-tools
  if (call.name === "discover_tools") {
    const discoveryRequest = {
      query: typeof call.args.query === "string" ? call.args.query : undefined,
      namespace: typeof call.args.namespace === "string" ? call.args.namespace : undefined,
      limit: typeof call.args.limit === "number" ? call.args.limit : undefined,
    };
    const result = await discoverProtocolCapabilities(discoveryRequest);
    logDiscoveryTelemetry({
      request: discoveryRequest, result, discoveryRunId: newDiscoveryRunId(),
      sourceSurface: context.sourceSurface, sourceSession: context.sourceSession,
    });
    return {
      success: result.success,
      output: JSON.stringify(result, null, 2),
      data: toResultData(result),
    };
  }

  if (call.name === "execute_tool") {
    const toolId = typeof call.args.toolId === "string" ? call.args.toolId : "";
    const params = typeof call.args.params === "object" && call.args.params !== null
      ? call.args.params as Record<string, unknown>
      : {};

    if (!toolId) {
      return { success: false, output: "Missing required parameter: toolId" };
    }

    return executeProtocolTool(
      { toolId, params },
      { loopMode: context.loopMode, approved: context.approved, sessionId: context.sessionId },
    );
  }

  // Hard role enforcement — blocked tools rejected even if model emits them
  if (isToolBlockedForRole(call.name, context.role)) {
    return {
      success: false,
      output: `Tool "${call.name}" is not available for this session role (${context.role}).`,
    };
  }

  // Internal tools — route by name
  if (!isInternalTool(call.name)) {
    return { success: false, output: `Unknown tool: ${call.name}` };
  }

  return routeInternalTool(call, context);
}

// ── Internal tool routing ────────────────────────────────────────
//
// Table-driven lazy loader map (PR1 replacement for the 25-case switch).
// Each entry imports exactly one internal-tool module and returns the
// named handler. Lazy imports keep startup cost low — a handler module is
// only parsed when its tool is actually dispatched.
//
// Adding a new internal tool: add a row here. `registry-completeness.test.ts`
// asserts every ToolDef with `kind: "internal"` (except meta-tools
// `discover_tools` / `execute_tool`) has a loader entry.

type InternalHandler = (
  args: Record<string, unknown>,
  context: InternalToolContext,
) => Promise<ToolResult>;

type InternalHandlerLoader = () => Promise<InternalHandler>;

export const INTERNAL_TOOL_LOADERS: Readonly<Record<string, InternalHandlerLoader>> = {
  // Self-documentation (Vex orientation tools)
  vex_introduction: async () => (await import("./internal/vex-intro.js")).handleVexIntroduction,
  vex_namespace_tools: async () => (await import("./internal/vex-namespace-tools.js")).handleVexNamespaceTools,

  // Web research (search + optional fetch in one tool)
  web_research: async () => (await import("./internal/web.js")).handleWebResearch,

  // Twitter/X account research
  twitter_account: async () => (await import("./internal/twitter-account.js")).handleTwitterAccount,

  // Documents (replaces file_*)
  document_read: async () => (await import("./internal/documents.js")).handleDocumentRead,
  document_write: async () => (await import("./internal/documents.js")).handleDocumentWrite,
  document_list: async () => (await import("./internal/documents.js")).handleDocumentList,
  document_delete: async () => (await import("./internal/documents.js")).handleDocumentDelete,

  // Knowledge — canonical agent memory layer
  knowledge_write: async () => (await import("./internal/knowledge.js")).handleKnowledgeWrite,
  knowledge_recall: async () => (await import("./internal/knowledge.js")).handleKnowledgeRecall,
  knowledge_recall_overflow: async () => (await import("./internal/knowledge.js")).handleKnowledgeRecallOverflow,
  knowledge_get: async () => (await import("./internal/knowledge.js")).handleKnowledgeGet,
  knowledge_update_status: async () => (await import("./internal/knowledge.js")).handleKnowledgeUpdateStatus,
  knowledge_supersede: async () => (await import("./internal/knowledge.js")).handleKnowledgeSupersede,
  knowledge_lineage: async () => (await import("./internal/knowledge.js")).handleKnowledgeLineage,
  knowledge_history: async () => (await import("./internal/knowledge.js")).handleKnowledgeHistory,

  // Portfolio
  portfolio_inspect: async () => (await import("./internal/portfolio-inspect.js")).handlePortfolioInspect,

  // Khalani direct read aliases
  khalani_chains_list: async () => (await import("./internal/khalani.js")).handleKhalaniChainsList,
  khalani_tokens_top: async () => (await import("./internal/khalani.js")).handleKhalaniTokensTop,
  khalani_tokens_search: async () => (await import("./internal/khalani.js")).handleKhalaniTokensSearch,
  khalani_tokens_balances: async () => (await import("./internal/khalani.js")).handleKhalaniTokensBalances,

  // Setup / Configuration
  polymarket_setup: async () => (await import("./internal/polymarket-setup.js")).handlePolymarketSetup,

  // Mission
  mission_draft_update: async () => (await import("./internal/mission.js")).handleMissionDraftUpdate,
  mission_stop: async () => (await import("./internal/mission.js")).handleMissionStop,

  // Autonomy primitives — mission/full-autonomous wake
  loop_defer: async () => (await import("./internal/loop-defer.js")).handleLoopDefer,
  checkpoint_handoff_prepare: async () => (await import("./internal/checkpoint-handoff.js")).handleCheckpointHandoffPrepare,
  tool_output_read: async () => (await import("./internal/tool-output-read.js")).handleToolOutputRead,

  // Subagents
  subagent_spawn: async () => (await import("./internal/subagent.js")).handleSubagentSpawn,
  subagent_status: async () => (await import("./internal/subagent.js")).handleSubagentStatus,
  subagent_stop: async () => (await import("./internal/subagent.js")).handleSubagentStop,
  subagent_reply: async () => (await import("./internal/subagent.js")).handleSubagentReply,
  subagent_request_parent: async () => (await import("./internal/subagent.js")).handleSubagentRequestParent,
  subagent_report_complete: async () => (await import("./internal/subagent.js")).handleSubagentReportComplete,

  // EVM on-chain reads
  evm_read: async () => (await import("./internal/evm-read.js")).handleEvmRead,

  // Wallet
  wallet_read: async () => (await import("./internal/wallet.js")).handleWalletRead,
  wallet_send_prepare: async () => (await import("./internal/wallet.js")).handleWalletSendPrepare,
  wallet_send_confirm: async () => (await import("./internal/wallet.js")).handleWalletSendConfirm,
};

async function routeInternalTool(
  call: ToolCallRequest,
  context: InternalToolContext,
): Promise<ToolResult> {
  const loader = INTERNAL_TOOL_LOADERS[call.name];
  if (!loader) {
    return { success: false, output: `Unknown internal tool: ${call.name}` };
  }
  const handler = await loader();
  return handler(call.args, context);
}
