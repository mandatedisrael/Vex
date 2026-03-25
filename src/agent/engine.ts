/**
 * Conversation engine — core message loop (Postgres-backed).
 *
 * All state lives in Postgres via db/repos/.
 * Session isolation via ConversationSession instances.
 * Tool results preserve tool_call_id for proper round-trip.
 */

import type { Message, ToolCall, AgentEvent, RequestUsage, InternalToolCall, ConversationSession, InferenceConfig, ChatMode } from "./types.js";
import { buildSystemPrompt } from "./tools.js";
import { generateId } from "./id.js";
import { SSE_TOOL_OUTPUT_LIMIT } from "./constants.js";
import { toOpenAITools, isInternal, isMutating } from "./tool-registry.js";
import { inferWithTools, inferNonStreaming, loadInferenceConfig } from "./inference.js";
import { executeTool } from "./executor.js";
import { recordBillingSnapshot } from "./billing.js";
import { getActiveProvider } from "./providers/registry.js";
import { calculateBudget, calculateHybridBudget, parseCompactionResult } from "./context.js";
import { processInternalTools } from "./internal-tool-handlers.js";
import { captureTradeFromResult } from "./trade-capture.js";
import * as memoryRepo from "./db/repos/memory.js";
import * as sessionsRepo from "./db/repos/sessions.js";
import * as messagesRepo from "./db/repos/messages.js";
import * as usageRepo from "./db/repos/usage.js";
import * as approvalsRepo from "./db/repos/approvals.js";
import { buildCompactionPrompt, getCompactionSystemPrompt } from "./prompts/compaction.js";
import { withSessionLock } from "./session-lock.js";
import logger from "../utils/logger.js";

// ── Session factory ──────────────────────────────────────────────────

let sharedInferenceConfig: InferenceConfig | null = null;

export async function initEngine(): Promise<boolean> {
  sharedInferenceConfig = await loadInferenceConfig();
  if (!sharedInferenceConfig) {
    logger.error("agent.engine.init_failed", { reason: "no inference config" });
    return false;
  }
  logger.info("agent.engine.ready", { model: sharedInferenceConfig.model });
  return true;
}

export function createSession(): ConversationSession | null {
  if (!sharedInferenceConfig) return null;
  const id = generateId("session");
  return { id, messages: [], loadedKnowledge: new Map(), inferenceConfig: sharedInferenceConfig };
}

export function getInferenceConfig(): InferenceConfig | null {
  return sharedInferenceConfig;
}

// ── Main conversation turn ───────────────────────────────────────────

export type EventEmitter = (event: AgentEvent) => void;

export async function processMessage(
  session: ConversationSession,
  userMessage: string,
  emit: EventEmitter,
  loopMode: ChatMode = "off",
): Promise<void> {
  // Ensure session exists in DB
  await sessionsRepo.createSession(session.id);

  const userMsg: Message = { role: "user", content: userMessage, timestamp: new Date().toISOString() };
  session.messages.push(userMsg);
  await messagesRepo.addMessage(session.id, userMsg);

  await inferenceLoop(session, emit, loopMode);
}

export async function resumeAfterApproval(
  session: ConversationSession,
  approvedToolCall: ToolCall,
  emit: EventEmitter,
  loopMode: ChatMode,
  toolCallId?: string,
): Promise<void> {
  // Use provided toolCallId (from approval item) or generate one
  const resolvedId = toolCallId ?? generateId("call");
  emit({ type: "tool_start", data: { id: resolvedId, command: approvedToolCall.command, args: approvedToolCall.args } });
  const result = await executeTool(approvedToolCall, true);
  emit({ type: "tool_result", data: {
    id: resolvedId, command: result.command, success: result.success,
    output: result.output.slice(0, SSE_TOOL_OUTPUT_LIMIT), durationMs: result.durationMs,
  }});

  if (result.success) {
    try {
      await captureTradeFromResult(approvedToolCall.command, result.argv, result.output);
    } catch (err) {
      logger.warn("trade.capture.failed", {
        command: approvedToolCall.command,
        phase: "approval_resume",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const toolMsg: Message = { role: "tool", content: result.output, toolCallId: resolvedId, timestamp: new Date().toISOString() };
  session.messages.push(toolMsg);
  await messagesRepo.addMessage(session.id, toolMsg);

  await inferenceLoop(session, emit, loopMode);
}

// ── Inference loop ───────────────────────────────────────────────────

async function inferenceLoop(
  session: ConversationSession,
  emit: EventEmitter,
  loopMode: ChatMode,
  maxIterations = 100,
): Promise<void> {
  const config = session.inferenceConfig;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const systemPrompt = await buildSystemPrompt(session.loadedKnowledge, loopMode);

    const newMessagesSinceSnapshot = session.messageCountAtSnapshot !== undefined
      ? session.messages.length - session.messageCountAtSnapshot
      : session.messages.length;
    const budget = calculateHybridBudget(
      session.lastPromptTokens, systemPrompt, session.messages,
      newMessagesSinceSnapshot, config.contextLimit,
    );
    if (budget.shouldCompact) {
      await compactSession(session, emit);
    }

    const fullMessages: Message[] = [
      { role: "system", content: systemPrompt, timestamp: new Date().toISOString() },
      ...session.messages,
    ];

    emit({ type: "status", data: { type: "thinking" } });

    // Native OpenAI function calling — filter proactive tools in manual mode
    const tools = toOpenAITools(loopMode);
    let response;

    try {
      response = await inferWithTools(config, fullMessages, tools);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("agent.inference.failed", { sessionId: session.id, error: msg });
      emit({ type: "error", data: { message: `Inference failed: ${msg}` } });
      emit({ type: "done", data: {} });
      return;
    }

    const totalUsage = response.usage;

    // Emit clean text content (null when tool calls returned)
    if (response.content) {
      emit({ type: "text_delta", data: { text: response.content } });
    }

    // Record usage with dynamic pricing from provider
    const cost = (totalUsage.promptTokens / 1_000_000) * config.inputPricePerM
               + (totalUsage.completionTokens / 1_000_000) * config.outputPricePerM;
    await usageRepo.logUsage(session.id, totalUsage.promptTokens, totalUsage.completionTokens, cost, config.provider, config.priceCurrency);

    // Snapshot real prompt_tokens for hybrid compaction budget
    if (totalUsage.promptTokens > 0) {
      session.lastPromptTokens = totalUsage.promptTokens;
      session.messageCountAtSnapshot = session.messages.length;
      await sessionsRepo.updateSessionTokenCount(session.id, totalUsage.promptTokens);
    }

    // Get session totals + provider balance for enhanced usage event
    const sessionStats = await usageRepo.getUsageStats(session.id, config.priceCurrency);
    const providerBalance = await getActiveProvider()?.getBalance() ?? null;
    const avgCost = sessionStats.requestCount > 0 ? sessionStats.lifetimeCost / sessionStats.requestCount : cost;
    const estimatedRemaining = avgCost > 0 && providerBalance ? Math.floor(providerBalance.availableRaw / avgCost) : 0;

    const usage: RequestUsage = { promptTokens: totalUsage.promptTokens, completionTokens: totalUsage.completionTokens, totalTokens: totalUsage.promptTokens + totalUsage.completionTokens, cost };
    emit({ type: "usage", data: {
      ...usage,
      sessionTotalTokens: sessionStats.sessionTokens,
      sessionTotalCost: sessionStats.sessionCost,
      providerBalance: providerBalance?.availableRaw ?? null,
      providerCurrency: providerBalance?.currency ?? config.priceCurrency,
      priceCurrency: config.priceCurrency,
      providerName: getActiveProvider()?.displayName ?? "Unknown",
      isLowBalance: providerBalance?.isLow ?? false,
      // Legacy compat — remove after UI fully migrated
      ledgerLockedOg: providerBalance?.availableRaw ?? null,
      estimatedRequestsRemaining: estimatedRemaining,
      model: config.model,
      inputPricePerM: config.inputPricePerM.toFixed(4),
      outputPricePerM: config.outputPricePerM.toFixed(4),
    }});

    // Record billing snapshot + check low balance
    await recordBillingSnapshot(config.provider, sessionStats.sessionCost);
    if (providerBalance?.isLow) {
      emit({ type: "balance_low", data: {
        message: providerBalance.lowBalanceMessage ?? "Low provider balance",
        providerBalanceRaw: providerBalance.availableRaw,
        threshold: 0,
      }});
    }

    // Convert ParsedToolCall[] → ToolCall[] with mutating flag from registry
    const allToolCalls: ToolCall[] | null = response.toolCalls?.map(tc => ({
      command: tc.name,
      args: tc.arguments as Record<string, string | boolean | number>,
      confirm: isMutating(tc.name),
    })) ?? null;

    // Store message with clean content
    const assistantMsg: Message = {
      role: "assistant", content: response.content ?? "",
      toolCalls: allToolCalls?.map((tc, i) => ({ id: response.toolCalls?.[i]?.id ?? generateId("call"), command: tc.command, args: tc.args as Record<string, unknown> })),
      timestamp: new Date().toISOString(),
    };
    session.messages.push(assistantMsg);
    await messagesRepo.addMessage(session.id, assistantMsg);

    if (!allToolCalls || allToolCalls.length === 0) {
      emit({ type: "done", data: { sessionTokens: usage.totalTokens } });
      return;
    }

    // Split by registry: internal (engine-handled) vs CLI (spawned)
    const internalCalls = allToolCalls.filter(tc => isInternal(tc.command));
    const cliCalls = allToolCalls.filter(tc => !isInternal(tc.command));

    // Process internal tools first (web search, file ops, etc.)
    if (internalCalls.length > 0) {
      const internalAsTools: InternalToolCall[] = internalCalls.map(tc => {
        // Find by original index in allToolCalls to avoid ambiguity with duplicate commands
        const originalIdx = allToolCalls!.indexOf(tc);
        const toolCallId = assistantMsg.toolCalls?.[originalIdx]?.id;
        return {
          type: tc.command as InternalToolCall["type"],
          params: tc.args as Record<string, string>,
          toolCallId,
        };
      });
      await processInternalTools(internalAsTools, session, emit, loopMode);
    }

    // If no CLI calls, continue inference loop (internal tools may have loaded context)
    if (cliCalls.length === 0 && internalCalls.length > 0) {
      continue;
    }

    if (cliCalls.length === 0) {
      emit({ type: "done", data: { sessionTokens: usage.totalTokens } });
      return;
    }

    // Build a filtered assistantMsg for CLI tool execution (only CLI tool_calls)
    const cliAssistantMsg: Message = {
      ...assistantMsg,
      toolCalls: cliCalls.map(tc => {
        const originalIdx = allToolCalls!.indexOf(tc);
        return { id: assistantMsg.toolCalls?.[originalIdx]?.id ?? generateId("call"), command: tc.command, args: tc.args as Record<string, unknown> };
      }),
    };

    const execResult = await executeToolCalls(cliCalls, cliAssistantMsg, session, emit, loopMode);
    if (execResult === "approval_pending") {
      emit({ type: "done", data: { pendingApprovals: true } });
      return;
    }
  }

  emit({ type: "error", data: { message: "Max tool iterations reached" } });
  emit({ type: "done", data: {} });
}

// ── System prompt built directly from DB via tools.ts buildSystemPrompt() ──

// ── Tool execution ───────────────────────────────────────────────────
//
// Design decision: multi-mutation approval is INTENTIONALLY piecemeal.
// Each mutating tool is a separate approval. After approving tool A, engine
// re-enters inference — model sees result, may adjust or skip remaining tools.
// This is correct for a trading agent where market conditions change between
// each execution. "Sell SOL" approved → model sees SOL sold → may decide
// ETH buy is no longer optimal at new price.

async function executeToolCalls(
  toolCalls: ToolCall[], assistantMsg: Message, session: ConversationSession,
  emit: EventEmitter, loopMode: ChatMode,
): Promise<"ok" | "approval_pending"> {
  // In restricted mode: execute safe tools first, enqueue ALL mutating tools for approval
  const pendingApprovals: Array<{ id: string; toolCallId: string; call: ToolCall }> = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];
    if (!call.confirm && isMutating(call.command)) call.confirm = true;

    const toolCallId = assistantMsg.toolCalls?.[i]?.id ?? generateId("call");

    if (call.confirm && (loopMode === "restricted" || loopMode === "off")) {
      // Queue for approval — don't stop, continue processing safe tools
      const approvalId = generateId("approval");
      await approvalsRepo.enqueue(approvalId, call, "This operation modifies on-chain state or moves funds.", session.id, toolCallId, loopMode);
      pendingApprovals.push({ id: approvalId, toolCallId, call });
      continue;
    }

    // Execute safe tool (or any tool in full mode)
    emit({ type: "tool_start", data: { id: toolCallId, command: call.command, args: call.args } });

    const confirmed = loopMode === "full" || !call.confirm;
    const result = await executeTool(call, confirmed);

    emit({ type: "tool_result", data: { id: toolCallId, command: result.command, success: result.success, output: result.output.slice(0, SSE_TOOL_OUTPUT_LIMIT), durationMs: result.durationMs } });

    if (result.success) {
      try {
        await captureTradeFromResult(call.command, result.argv, result.output);
      } catch (err) {
        logger.warn("trade.capture.failed", {
          command: call.command,
          phase: "execute_tool_calls",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const toolMsg: Message = { role: "tool", content: result.output, toolCallId, timestamp: new Date().toISOString() };
    session.messages.push(toolMsg);
    await messagesRepo.addMessage(session.id, toolMsg);
  }

  // Emit all pending approvals
  if (pendingApprovals.length > 0) {
    for (const pa of pendingApprovals) {
      emit({ type: "approval_required", data: { id: pa.id, toolCallId: pa.toolCallId, command: pa.call.command, args: pa.call.args, reasoning: "This operation modifies on-chain state or moves funds." } });
    }
    return "approval_pending";
  }

  return "ok";
}

// ── Compaction ────────────────────────────────────────────────────────

async function compactSession(session: ConversationSession, emit: EventEmitter): Promise<void> {
  logger.info("agent.session.compacting", { sessionId: session.id, messageCount: session.messages.length });
  emit({ type: "status", data: { type: "compacting" } });

  const compactionMessages: Message[] = [
    { role: "system", content: getCompactionSystemPrompt(), timestamp: new Date().toISOString() },
    { role: "user", content: buildCompactionPrompt(session.messages, [...session.loadedKnowledge.keys()]), timestamp: new Date().toISOString() },
  ];

  try {
    const result = await inferNonStreaming(session.inferenceConfig, compactionMessages);

    // Track compaction inference cost (§19 cost awareness)
    const config = session.inferenceConfig;
    const compactionCost = (result.usage.promptTokens / 1_000_000) * config.inputPricePerM
                         + (result.usage.completionTokens / 1_000_000) * config.outputPricePerM;
    await usageRepo.logUsage(session.id, result.usage.promptTokens, result.usage.completionTokens, compactionCost, config.provider, config.priceCurrency);

    const { summary, insights } = parseCompactionResult(result.content);

    // Skip insight extraction for trivial sessions (< 4 substantive messages)
    const substantiveMessages = session.messages.filter(m => m.role !== "system").length;
    if (insights && substantiveMessages >= 4) {
      await memoryRepo.appendMemory(insights, "compaction", "compaction");
      emit({ type: "file_update", data: { path: "memory.md", action: "compaction_insights" } });
    }

    // Checkpoint: archive old messages, reset counters. Session ID stays the same.
    // Session lock prevents concurrent requests from racing with archive+checkpoint.
    await withSessionLock(session.id, async () => {
      await sessionsRepo.archiveSessionMessages(session.id);
      await sessionsRepo.checkpointSession(session.id, summary);
    });
    // DO NOT change session.id — session identity is stable across compaction
    // DO NOT emit status:session — no session change visible to the client

    const today = new Date().toISOString().slice(0, 10);

    // Clear loaded knowledge — compaction summary lists which files to re-read
    session.loadedKnowledge.clear();

    // Replace in-memory messages with compaction context
    const contextMsg: Message = { role: "system", content: `[Session compacted — ${today}]

Your previous session was summarized. Key insights saved to memory.
Loaded knowledge files were cleared — re-read files listed in the continuation context below as needed.

To restore full working context:
1. Check the continuation context below for files to re-read and next steps
2. Your memory entries above contain pointers to knowledge files
3. Resume where you left off — your entire knowledge base is intact

Previous session summary:
${summary}`, timestamp: new Date().toISOString() };

    session.messages = [contextMsg];
    // Persist the context message to DB (increments message_count from 0 to 1)
    await messagesRepo.addMessage(session.id, contextMsg);

    // Reset hybrid snapshot — fresh start with full heuristic
    session.lastPromptTokens = undefined;
    session.messageCountAtSnapshot = undefined;

    logger.info("agent.session.compaction_checkpoint", { sessionId: session.id });
  } catch (err) {
    logger.error("agent.session.compaction_failed", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
      messageCount: session.messages.length,
    });
    // Do NOT mutate session state on failure — keep existing messages intact
    emit({ type: "error", data: { message: "Context compaction failed — session continues with current context" } });
  }
}
