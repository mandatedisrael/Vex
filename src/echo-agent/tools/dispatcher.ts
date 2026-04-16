/**
 * Tool dispatcher — routes tool calls to the correct handler.
 *
 * The engine calls dispatchTool() for every tool call from the LLM.
 * Dispatcher decides: internal tool → direct handler, or
 * discover/execute → protocol runtime.
 *
 * Internal tool handlers are lazy-imported to avoid loading
 * all dependencies at startup.
 */

import type { ToolCallRequest, ToolResult } from "./types.js";
import type { InternalToolContext } from "./internal/types.js";
import { isInternalTool, isToolBlockedForRole } from "./registry.js";
import { discoverProtocolCapabilities } from "./protocols/runtime.js";
import { executeProtocolTool } from "./protocols/runtime.js";
import { logDiscoveryTelemetry, newDiscoveryRunId } from "./protocols/discovery.telemetry.js";
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
      includeMutating: call.args.includeMutating === true,
      includeDeclared: call.args.includeDeclared === true,
      limit: typeof call.args.limit === "number" ? call.args.limit : undefined,
    };
    const result = discoverProtocolCapabilities(discoveryRequest);
    logDiscoveryTelemetry({
      request: discoveryRequest, result, discoveryRunId: newDiscoveryRunId(),
      sourceSurface: context.sourceSurface, sourceSession: context.sourceSession,
    });
    return {
      success: result.success,
      output: JSON.stringify(result, null, 2),
      data: result as unknown as Record<string, unknown>,
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
// All handlers lazy-imported to avoid loading dependencies at startup.

async function routeInternalTool(
  call: ToolCallRequest,
  context: InternalToolContext,
): Promise<ToolResult> {
  switch (call.name) {
    // Web
    case "web_search": {
      const { handleWebSearch } = await import("./internal/web.js");
      return handleWebSearch(call.args, context);
    }
    case "web_fetch": {
      const { handleWebFetch } = await import("./internal/web.js");
      return handleWebFetch(call.args, context);
    }

    // Documents (replaces file_*)
    case "document_read": {
      const { handleDocumentRead } = await import("./internal/documents.js");
      return handleDocumentRead(call.args, context);
    }
    case "document_write": {
      const { handleDocumentWrite } = await import("./internal/documents.js");
      return handleDocumentWrite(call.args, context);
    }
    case "document_list": {
      const { handleDocumentList } = await import("./internal/documents.js");
      return handleDocumentList(call.args, context);
    }
    case "document_delete": {
      const { handleDocumentDelete } = await import("./internal/documents.js");
      return handleDocumentDelete(call.args, context);
    }

    // Knowledge — canonical agent memory layer (replaces memory_manage)
    case "knowledge_write": {
      const { handleKnowledgeWrite } = await import("./internal/knowledge.js");
      return handleKnowledgeWrite(call.args, context);
    }
    case "knowledge_recall": {
      const { handleKnowledgeRecall } = await import("./internal/knowledge.js");
      return handleKnowledgeRecall(call.args, context);
    }
    case "knowledge_recall_overflow": {
      const { handleKnowledgeRecallOverflow } = await import("./internal/knowledge.js");
      return handleKnowledgeRecallOverflow(call.args, context);
    }
    case "knowledge_get": {
      const { handleKnowledgeGet } = await import("./internal/knowledge.js");
      return handleKnowledgeGet(call.args, context);
    }
    case "knowledge_update_status": {
      const { handleKnowledgeUpdateStatus } = await import("./internal/knowledge.js");
      return handleKnowledgeUpdateStatus(call.args, context);
    }
    case "knowledge_supersede": {
      const { handleKnowledgeSupersede } = await import("./internal/knowledge.js");
      return handleKnowledgeSupersede(call.args, context);
    }

    // Scheduling
    case "schedule_create": {
      const { handleScheduleCreate } = await import("./internal/schedule.js");
      return handleScheduleCreate(call.args, context);
    }
    case "schedule_remove": {
      const { handleScheduleRemove } = await import("./internal/schedule.js");
      return handleScheduleRemove(call.args, context);
    }

    // Portfolio
    case "portfolio_inspect": {
      const { handlePortfolioInspect } = await import("./internal/portfolio-inspect.js");
      return handlePortfolioInspect(call.args, context);
    }

    // Setup / Configuration
    case "polymarket_setup": {
      const { handlePolymarketSetup } = await import("./internal/polymarket-setup.js");
      return handlePolymarketSetup(call.args, context);
    }

    // Mission
    case "mission_stop": {
      const { handleMissionStop } = await import("./internal/mission.js");
      return handleMissionStop(call.args, context);
    }

    // Subagents
    case "subagent_spawn": {
      const { handleSubagentSpawn } = await import("./internal/subagent.js");
      return handleSubagentSpawn(call.args, context);
    }
    case "subagent_status": {
      const { handleSubagentStatus } = await import("./internal/subagent.js");
      return handleSubagentStatus(call.args, context);
    }
    case "subagent_stop": {
      const { handleSubagentStop } = await import("./internal/subagent.js");
      return handleSubagentStop(call.args, context);
    }
    case "subagent_reply": {
      const { handleSubagentReply } = await import("./internal/subagent.js");
      return handleSubagentReply(call.args, context);
    }
    case "subagent_request_parent": {
      const { handleSubagentRequestParent } = await import("./internal/subagent.js");
      return handleSubagentRequestParent(call.args, context);
    }
    case "subagent_report_complete": {
      const { handleSubagentReportComplete } = await import("./internal/subagent.js");
      return handleSubagentReportComplete(call.args, context);
    }

    // EVM on-chain reads
    case "evm_read": {
      const { handleEvmRead } = await import("./internal/evm-read.js");
      return handleEvmRead(call.args, context);
    }

    // Wallet
    case "wallet_read": {
      const { handleWalletRead } = await import("./internal/wallet.js");
      return handleWalletRead(call.args, context);
    }
    case "wallet_send_prepare": {
      const { handleWalletSendPrepare } = await import("./internal/wallet.js");
      return handleWalletSendPrepare(call.args, context);
    }
    case "wallet_send_confirm": {
      const { handleWalletSendConfirm } = await import("./internal/wallet.js");
      return handleWalletSendConfirm(call.args, context);
    }

    default:
      return { success: false, output: `Unknown internal tool: ${call.name}` };
  }
}
