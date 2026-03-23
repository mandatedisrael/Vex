/**
 * Conversation engine — core message loop (Postgres-backed).
 *
 * All state lives in Postgres via db/repos/.
 * Session isolation via ConversationSession instances.
 * Tool results preserve tool_call_id for proper round-trip.
 */

import type { Message, ToolCall, ToolResult, AgentEvent, RequestUsage, InternalToolCall, ConversationSession, InferenceConfig, TradeEntry } from "./types.js";
import { buildSystemPrompt } from "./tools.js";
import { generateId } from "./id.js";
import { SSE_TOOL_OUTPUT_LIMIT } from "./constants.js";
import { toOpenAITools, isInternal, isMutating } from "./tool-registry.js";
import { inferWithTools, inferNonStreaming, loadInferenceConfig } from "./inference.js";
import { executeTool } from "./executor.js";
import { webSearch, webFetch } from "./search.js";
import { addTask, removeTask } from "./scheduler.js";
import { getLedgerState, isLowBalance, recordBillingSnapshot } from "./billing.js";
import { calculateBudget, calculateHybridBudget, parseCompactionResult } from "./context.js";
import * as soulRepo from "./db/repos/soul.js";
import * as memoryRepo from "./db/repos/memory.js";
import * as sessionsRepo from "./db/repos/sessions.js";
import * as messagesRepo from "./db/repos/messages.js";
import * as knowledgeRepo from "./db/repos/knowledge.js";
import * as skillsRepo from "./db/repos/skills.js";
import * as usageRepo from "./db/repos/usage.js";
import * as tradesRepo from "./db/repos/trades.js";
import * as approvalsRepo from "./db/repos/approvals.js";
import { buildCompactionPrompt, getCompactionSystemPrompt } from "./prompts/compaction.js";
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
  loopMode: "full" | "restricted" | "off" = "off",
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
  loopMode: "full" | "restricted" | "off",
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

  const toolMsg: Message = { role: "tool", content: result.output, toolCallId: resolvedId, timestamp: new Date().toISOString() };
  session.messages.push(toolMsg);
  await messagesRepo.addMessage(session.id, toolMsg);

  await inferenceLoop(session, emit, loopMode);
}

// ── Inference loop ───────────────────────────────────────────────────

async function inferenceLoop(
  session: ConversationSession,
  emit: EventEmitter,
  loopMode: "full" | "restricted" | "off",
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

    // Native OpenAI function calling — tools sent via API parameter
    const tools = toOpenAITools();
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
    const costOg = (totalUsage.promptTokens / 1_000_000) * config.inputPricePerM
                  + (totalUsage.completionTokens / 1_000_000) * config.outputPricePerM;
    await usageRepo.logUsage(session.id, totalUsage.promptTokens, totalUsage.completionTokens, costOg);

    // Snapshot real prompt_tokens for hybrid compaction budget
    if (totalUsage.promptTokens > 0) {
      session.lastPromptTokens = totalUsage.promptTokens;
      session.messageCountAtSnapshot = session.messages.length;
      await sessionsRepo.updateSessionTokenCount(session.id, totalUsage.promptTokens);
    }

    // Get session totals + ledger balance for enhanced usage event
    const sessionStats = await usageRepo.getUsageStats(session.id);
    const ledger = await getLedgerState(config.provider);
    const avgCost = sessionStats.requestCount > 0 ? sessionStats.lifetimeCost / sessionStats.requestCount : costOg;
    const estimatedRemaining = avgCost > 0 && ledger ? Math.floor(ledger.providerLockedOg / avgCost) : 0;

    const usage: RequestUsage = { promptTokens: totalUsage.promptTokens, completionTokens: totalUsage.completionTokens, totalTokens: totalUsage.promptTokens + totalUsage.completionTokens, costOg };
    emit({ type: "usage", data: {
      ...usage,
      sessionTotalTokens: sessionStats.sessionTokens,
      sessionTotalCostOg: sessionStats.sessionCost,
      ledgerAvailableOg: ledger?.ledgerAvailableOg ?? null,
      ledgerLockedOg: ledger?.providerLockedOg ?? null,
      estimatedRequestsRemaining: estimatedRemaining,
      model: config.model,
      inputPricePerM: config.inputPricePerM.toFixed(4),
      outputPricePerM: config.outputPricePerM.toFixed(4),
    }});

    // Record billing snapshot + check low balance
    await recordBillingSnapshot(config.provider, sessionStats.sessionCost);
    if (ledger && isLowBalance(ledger, config)) {
      emit({ type: "balance_low", data: {
        message: `Low compute balance: ${ledger.providerLockedOg.toFixed(4)} 0G (threshold: ${config.alertThresholdOg.toFixed(4)} 0G)`,
        ledgerLockedOg: ledger.providerLockedOg,
        threshold: config.alertThresholdOg,
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
      toolCalls: allToolCalls?.map(tc => ({ id: generateId("call"), command: tc.command, args: tc.args as Record<string, unknown> })),
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
      const internalAsTools: InternalToolCall[] = internalCalls.map(tc => ({
        type: tc.command as InternalToolCall["type"],
        params: tc.args as Record<string, string>,
      }));
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
      toolCalls: cliCalls.map(tc => ({ id: generateId("call"), command: tc.command, args: tc.args as Record<string, unknown> })),
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
  emit: EventEmitter, loopMode: "full" | "restricted" | "off",
): Promise<"ok" | "approval_pending"> {
  // In restricted mode: execute safe tools first, enqueue ALL mutating tools for approval
  const pendingApprovals: Array<{ id: string; toolCallId: string; call: ToolCall }> = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];
    if (!call.confirm && isMutating(call.command)) call.confirm = true;

    const toolCallId = assistantMsg.toolCalls?.[i]?.id ?? generateId("call");

    if (call.confirm && loopMode === "restricted") {
      // Queue for approval — don't stop, continue processing safe tools
      const approvalId = generateId("approval");
      await approvalsRepo.enqueue(approvalId, call, "This operation modifies on-chain state or moves funds.", session.id, toolCallId);
      pendingApprovals.push({ id: approvalId, toolCallId, call });
      continue;
    }

    // Execute safe tool (or any tool in full mode)
    emit({ type: "tool_start", data: { id: toolCallId, command: call.command, args: call.args } });

    const confirmed = loopMode === "full" || !call.confirm;
    const result = await executeTool(call, confirmed);

    emit({ type: "tool_result", data: { id: toolCallId, command: result.command, success: result.success, output: result.output.slice(0, SSE_TOOL_OUTPUT_LIMIT), durationMs: result.durationMs } });

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

// ── Internal tools (DB-backed) ───────────────────────────────────────
// TODO: §5.3 — engine.ts exceeds 500 lines. Consider extracting tool handlers
// and compaction into separate modules in a dedicated refactor.

const FILE_SIZE_WARNING_CHARS = 3000;
const MAX_FILES_WARNING = 50;
const PREVIEW_CHAR_LIMIT = 1000;

interface InternalToolResult { output: string; success: boolean }

/** Safe string accessor for tool params. */
function str(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : "";
}

async function processInternalTools(tools: InternalToolCall[], session: ConversationSession, emit: EventEmitter, loopMode: "full" | "restricted" | "off" = "off"): Promise<void> {
  for (const tool of tools) {
    const toolCallId = generateId("call");
    const startTime = Date.now();
    emit({ type: "tool_start", data: { id: toolCallId, command: tool.type, args: tool.params } });

    let result: InternalToolResult;
    try {
      switch (tool.type) {
        case "file_write":    result = await handleFileWrite(tool, session, emit); break;
        case "file_read":     result = await handleFileRead(tool, session, emit); break;
        case "file_list":     result = await handleFileList(tool, session); break;
        case "file_delete":   result = await handleFileDelete(tool, session, emit); break;
        case "memory_update": result = await handleMemoryUpdate(tool, emit); break;
        case "memory_manage": result = await handleMemoryManage(tool, session, emit); break;
        case "web_search":    result = await handleWebSearch(tool, session); break;
        case "web_fetch":     result = await handleWebFetch(tool, session); break;
        case "trade_log":     result = await handleTradeLog(tool, emit); break;
        case "schedule_create": result = await handleScheduleCreate(tool, emit, loopMode); break;
        case "schedule_remove": result = await handleScheduleRemove(tool, emit); break;
        default: result = { output: `Unknown tool: ${tool.type}`, success: false };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("agent.internal_tool.failed", { command: tool.type, error: msg });
      result = { output: msg, success: false };
    }

    emit({ type: "tool_result", data: { id: toolCallId, command: tool.type, success: result.success, output: result.output.slice(0, SSE_TOOL_OUTPUT_LIMIT), durationMs: Date.now() - startTime } });
  }
}

// ── Tool handlers (one per tool type) ────────────────────────────────

async function handleFileWrite(tool: InternalToolCall, session: ConversationSession, emit: EventEmitter): Promise<InternalToolResult> {
  const path = str(tool.params, "path"), content = str(tool.params, "content");
  if (!path || !content) return { output: "Missing path or content", success: false };
  if (path.includes("..") && path !== "../soul.md") return { output: `Blocked: path traversal "${path}"`, success: false };

  if (path === "../soul.md" || path === "soul.md") {
    await soulRepo.upsertSoul(content);
  } else {
    await knowledgeRepo.upsertFile(path, content);
  }
  emit({ type: "file_update", data: { path, action: "write" } });

  const hints: string[] = [];
  if (content.length > FILE_SIZE_WARNING_CHARS) hints.push(`File is ${content.length} chars. Consider keeping files concise for efficient context usage.`);
  const totalFiles = await knowledgeRepo.fileCount();
  if (totalFiles > MAX_FILES_WARNING) hints.push(`You have ${totalFiles} knowledge files. Consider consolidating older files.`);

  return { output: `Written: ${path}` + (hints.length > 0 ? ` (${hints.join(" ")})` : ""), success: true };
}

async function handleFileRead(tool: InternalToolCall, session: ConversationSession, emit: EventEmitter): Promise<InternalToolResult> {
  const path = str(tool.params, "path");
  const isPreview = tool.params.preview === true;
  if (!path) return { output: "Missing path", success: false };

  let content = await knowledgeRepo.getFile(path);
  const isSkillRef = !content;
  if (!content) content = await skillsRepo.getSkillReference(path);
  if (!content) return { output: `Not found: ${path}`, success: false };

  // Skill references always load fully; knowledge files respect preview flag
  if (isPreview && !isSkillRef) {
    const previewText = content.length > PREVIEW_CHAR_LIMIT
      ? content.slice(0, PREVIEW_CHAR_LIMIT) + "\n\n... (preview — use file_read without preview to load full file)"
      : content;
    return { output: `Preview: ${path} (${content.length} chars total)\n\n${previewText}`, success: true };
  }

  session.loadedKnowledge.set(path, content);
  emit({ type: "file_update", data: { path, action: "loaded" } });
  return { output: `Loaded: ${path} (${content.length} chars)`, success: true };
}

async function handleFileList(tool: InternalToolCall, session: ConversationSession): Promise<InternalToolResult> {
  const entries = await knowledgeRepo.listFiles(str(tool.params, "path"));
  const content = JSON.stringify(entries, null, 2);
  const listMsg: Message = { role: "tool", content, timestamp: new Date().toISOString() };
  session.messages.push(listMsg);
  await messagesRepo.addMessage(session.id, listMsg);
  return { output: `${entries.length} entries`, success: true };
}

async function handleFileDelete(tool: InternalToolCall, session: ConversationSession, emit: EventEmitter): Promise<InternalToolResult> {
  const path = str(tool.params, "path");
  if (!path) return { output: "Missing path", success: false };
  if (path.includes("..")) return { output: `Blocked: path traversal "${path}"`, success: false };
  await knowledgeRepo.deleteFile(path);
  session.loadedKnowledge.delete(path);
  emit({ type: "file_update", data: { path, action: "deleted" } });
  return { output: `Deleted: ${path}`, success: true };
}

async function handleMemoryUpdate(tool: InternalToolCall, emit: EventEmitter): Promise<InternalToolResult> {
  const append = str(tool.params, "append");
  if (!append) return { output: "Missing append text", success: false };
  await memoryRepo.appendMemory(append, undefined, "agent");
  emit({ type: "file_update", data: { path: "memory.md", action: "updated" } });
  return { output: "Memory updated", success: true };
}

async function handleMemoryManage(tool: InternalToolCall, session: ConversationSession, emit: EventEmitter): Promise<InternalToolResult> {
  const action = str(tool.params, "action");

  if (action === "list") {
    const entries = await memoryRepo.listEntriesWithIds();
    const content = JSON.stringify(entries, null, 2);
    const listMsg: Message = { role: "tool", content, timestamp: new Date().toISOString() };
    session.messages.push(listMsg);
    await messagesRepo.addMessage(session.id, listMsg);
    return { output: `${entries.length} memory entries`, success: true };
  }

  if (action === "append") {
    const text = str(tool.params, "append") || str(tool.params, "content");
    if (!text) return { output: "Missing append text", success: false };
    await memoryRepo.appendMemory(text, undefined, "agent");
    emit({ type: "file_update", data: { path: "memory.md", action: "updated" } });
    return { output: "Memory entry appended", success: true };
  }

  if (action === "replace") {
    const id = tool.params.id;
    const content = str(tool.params, "content");
    if (typeof id !== "number" || !content) return { output: "Missing id or content", success: false };
    const replaced = await memoryRepo.replaceEntry(id, content);
    if (!replaced) return { output: `Memory entry #${id} not found`, success: false };
    emit({ type: "file_update", data: { path: "memory.md", action: "updated" } });
    return { output: `Memory entry #${id} replaced`, success: true };
  }

  if (action === "delete") {
    const id = tool.params.id;
    if (typeof id !== "number") return { output: "Missing id", success: false };
    const deleted = await memoryRepo.deleteEntry(id);
    if (!deleted) return { output: `Memory entry #${id} not found`, success: false };
    emit({ type: "file_update", data: { path: "memory.md", action: "updated" } });
    return { output: `Memory entry #${id} deleted`, success: true };
  }

  return { output: `Unknown memory action: "${action}". Use list, append, replace, or delete.`, success: false };
}

async function handleWebSearch(tool: InternalToolCall, session: ConversationSession): Promise<InternalToolResult> {
  const query = str(tool.params, "query");
  if (!query) return { output: "Missing query", success: false };
  const results = await webSearch(query);
  const content = JSON.stringify(results, null, 2);
  const searchMsg: Message = { role: "tool", content, timestamp: new Date().toISOString() };
  session.messages.push(searchMsg);
  await messagesRepo.addMessage(session.id, searchMsg);
  return { output: `${Array.isArray(results) ? results.length : 0} results`, success: true };
}

async function handleWebFetch(tool: InternalToolCall, session: ConversationSession): Promise<InternalToolResult> {
  const url = str(tool.params, "url");
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) return { output: "Invalid URL", success: false };
  const result = await webFetch(url);
  const content = result
    ? `# ${result.title ?? "Fetched page"}\n\nSource: ${url}\n\n${result.markdown}`
    : `Failed to fetch: ${url}`;
  const fetchMsg: Message = { role: "tool", content, timestamp: new Date().toISOString() };
  session.messages.push(fetchMsg);
  await messagesRepo.addMessage(session.id, fetchMsg);
  return { output: result ? `Fetched: ${result.title ?? url}` : `Failed: ${url}`, success: !!result };
}

async function handleTradeLog(tool: InternalToolCall, emit: EventEmitter): Promise<InternalToolResult> {
  const rawTrade = tool.params.trade;
  let trade: Partial<TradeEntry>;
  if (typeof rawTrade === "object" && rawTrade !== null) {
    trade = rawTrade as Partial<TradeEntry>;
  } else if (typeof rawTrade === "string") {
    try { trade = JSON.parse(rawTrade) as Partial<TradeEntry>; }
    catch { return { output: "Invalid trade entry — expected JSON object", success: false }; }
  } else {
    trade = {};
  }
  if (!trade.type || !trade.chain || !trade.status || !trade.input || !trade.output) {
    return { output: "Incomplete trade entry", success: false };
  }
  const entry: TradeEntry = {
    id: trade.id ?? generateId("trade"),
    timestamp: trade.timestamp ?? new Date().toISOString(),
    type: trade.type, chain: trade.chain, status: trade.status,
    input: trade.input, output: trade.output,
    pnl: trade.pnl, meta: trade.meta ?? {},
    reasoning: trade.reasoning, signature: trade.signature, explorerUrl: trade.explorerUrl,
  };
  await tradesRepo.addTrade(entry);
  emit({ type: "file_update", data: { path: "trades", action: "logged", tradeId: entry.id } });
  return { output: `Trade logged: ${entry.id}`, success: true };
}

async function handleScheduleCreate(tool: InternalToolCall, emit: EventEmitter, loopMode: string): Promise<InternalToolResult> {
  const p = tool.params;
  const taskType = str(p, "type") || "inference";
  const validTaskTypes = new Set(["cli_execute", "inference", "alert", "snapshot", "backup"]);
  if (!validTaskTypes.has(taskType)) return { output: `Invalid task type: ${taskType}`, success: false };

  const cronExpr = str(p, "cron") || "0 * * * *";
  const { default: cron } = await import("node-cron");
  if (!cron.validate(cronExpr)) return { output: `Invalid cron: ${cronExpr}`, success: false };

  let payload: Record<string, unknown>;
  if (!p.payload) {
    payload = {};
  } else if (typeof p.payload === "object") {
    payload = p.payload as Record<string, unknown>;
  } else if (typeof p.payload === "string") {
    try { payload = JSON.parse(p.payload) as Record<string, unknown>; }
    catch {
      const keyMap: Record<string, string> = { inference: "prompt", cli_execute: "command", alert: "message" };
      payload = { [keyMap[taskType] ?? "prompt"]: p.payload };
    }
  } else {
    payload = {};
  }

  const effectiveLoopMode = loopMode === "full" ? (str(p, "loopMode") || "full") : "restricted";
  if (taskType === "cli_execute" && payload.command) {
    const cmdSnake = String(payload.command).replace(/\s+/g, "_");
    if (isMutating(cmdSnake) && effectiveLoopMode !== "full") {
      return { output: `Blocked: mutating command in ${loopMode} mode`, success: false };
    }
  }

  const taskId = generateId("task");
  await addTask({ id: taskId, name: str(p, "name") || "Unnamed task", description: str(p, "description"), cronExpression: cronExpr, taskType, payload, loopMode: effectiveLoopMode });
  emit({ type: "file_update", data: { path: "tasks", action: "created", taskId, name: str(p, "name") } });
  return { output: `Task created: ${taskId}`, success: true };
}

async function handleScheduleRemove(tool: InternalToolCall, emit: EventEmitter): Promise<InternalToolResult> {
  const taskId = str(tool.params, "id");
  if (!taskId) return { output: "Missing task ID", success: false };
  const ok = await removeTask(taskId);
  emit({ type: "file_update", data: { path: "tasks", action: ok ? "removed" : "not_found", taskId } });
  return { output: ok ? `Removed: ${taskId}` : `Not found: ${taskId}`, success: ok };
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
    const { summary, insights } = parseCompactionResult(result.content);

    if (insights) {
      await memoryRepo.appendMemory(insights, "compaction", "compaction");
      emit({ type: "file_update", data: { path: "memory.md", action: "compaction_insights" } });
    }

    await sessionsRepo.compactSession(session.id, summary);

    // Start fresh session — emit new sessionId so client stays in sync
    session.id = generateId("session");
    await sessionsRepo.createSession(session.id);
    emit({ type: "status", data: { type: "session", sessionId: session.id } });
    const today = new Date().toISOString().slice(0, 10);
    // Clear loaded knowledge — new session starts clean.
    // The continuation context in the summary lists which files to re-read.
    session.loadedKnowledge.clear();

    session.messages = [{ role: "system", content: `[Session compacted — ${today}]

Your previous session was summarized. Key insights saved to memory.
Loaded knowledge files were cleared — re-read files listed in the continuation context below as needed.

To restore full working context:
1. Check the continuation context below for files to re-read and next steps
2. Your memory entries above contain pointers to knowledge files
3. Resume where you left off — your entire knowledge base is intact

Previous session summary:
${summary}`, timestamp: new Date().toISOString() }];

    // Reset hybrid snapshot — new session starts with full heuristic
    session.lastPromptTokens = undefined;
    session.messageCountAtSnapshot = undefined;

    logger.info("[agent] compaction complete — new session started");
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
