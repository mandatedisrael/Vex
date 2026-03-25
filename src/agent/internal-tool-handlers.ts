/**
 * Internal tool handlers — extracted from engine.ts per Team Standards §5.3.
 *
 * Handles all internal tool dispatch: file ops, memory, web, trades,
 * schedules, and subagents. Called by inferenceLoop in engine.ts.
 */

import type { Message, InternalToolCall, ConversationSession, AgentEvent, TradeEntry, ChatMode } from "./types.js";
import type { EventEmitter } from "./engine.js";
import { generateId } from "./id.js";
import { SSE_TOOL_OUTPUT_LIMIT } from "./constants.js";
import { isMutating } from "./tool-registry.js";
import { spawnSubagent, getSubagentStatus, stopSubagent } from "./subagent.js";
import { webSearch, webFetch } from "./search.js";
import { addTask, removeTask } from "./scheduler.js";
import * as soulRepo from "./db/repos/soul.js";
import * as memoryRepo from "./db/repos/memory.js";
import * as messagesRepo from "./db/repos/messages.js";
import * as knowledgeRepo from "./db/repos/knowledge.js";

import * as tradesRepo from "./db/repos/trades.js";
import { deriveTradeIdFromTrade } from "./trade-capture.js";
import { normalizePortfolioChain } from "./portfolio-chains.js";
import logger from "../utils/logger.js";

// ── Constants ────────────────────────────────────────────────────────

const FILE_SIZE_WARNING_CHARS = 3000;
const MAX_FILES_WARNING = 50;
const PREVIEW_CHAR_LIMIT = 1000;

// ── Types ────────────────────────────────────────────────────────────

export interface InternalToolResult { output: string; success: boolean }

/** Safe string accessor for tool params. */
function str(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : "";
}

// ── Dispatch ─────────────────────────────────────────────────────────

export async function processInternalTools(tools: InternalToolCall[], session: ConversationSession, emit: EventEmitter, loopMode: ChatMode = "off"): Promise<void> {
  for (const tool of tools) {
    const toolCallId = tool.toolCallId ?? generateId("call");
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
        case "subagent_spawn":  result = await handleSubagentSpawn(tool, session, loopMode); break;
        case "subagent_status": result = await handleSubagentStatus(tool); break;
        case "subagent_stop":   result = await handleSubagentStop(tool); break;
        default: result = { output: `Unknown tool: ${tool.type}`, success: false };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("agent.internal_tool.failed", { command: tool.type, error: msg });
      result = { output: msg, success: false };
    }

    // Ensure any tool messages pushed by handlers carry the correct toolCallId
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i];
      if (m.role === "tool" && !m.toolCallId) {
        m.toolCallId = toolCallId;
        break;
      }
      if (m.role !== "tool") break;
    }

    emit({ type: "tool_result", data: { id: toolCallId, command: tool.type, success: result.success, output: result.output.slice(0, SSE_TOOL_OUTPUT_LIMIT), durationMs: Date.now() - startTime } });
  }
}

// ── File handlers ────────────────────────────────────────────────────

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

  const content = await knowledgeRepo.getFile(path);
  if (!content) return { output: `Not found: ${path}`, success: false };

  if (isPreview) {
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

// ── Memory handlers ──────────────────────────────────────────────────

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

// ── Web handlers ─────────────────────────────────────────────────────

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

// ── Trade handler ────────────────────────────────────────────────────

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
    id: trade.id ?? deriveTradeIdFromTrade({
      type: trade.type,
      chain: normalizePortfolioChain(trade.chain),
      signature: trade.signature,
      explorerUrl: trade.explorerUrl,
      meta: trade.meta,
    }) ?? generateId("trade"),
    timestamp: trade.timestamp ?? new Date().toISOString(),
    type: trade.type, chain: normalizePortfolioChain(trade.chain), status: trade.status,
    input: trade.input, output: trade.output,
    pnl: trade.pnl, meta: trade.meta ?? {},
    reasoning: trade.reasoning, signature: trade.signature, explorerUrl: trade.explorerUrl,
  };
  await tradesRepo.addTrade(entry);
  emit({ type: "file_update", data: { path: "trades", action: "logged", tradeId: entry.id } });
  return { output: `Trade logged: ${entry.id}`, success: true };
}

// ── Schedule handlers ────────────────────────────────────────────────

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

// ── Subagent handlers ────────────────────────────────────────────────

async function handleSubagentSpawn(tool: InternalToolCall, session: ConversationSession, loopMode: ChatMode): Promise<InternalToolResult> {
  const name = str(tool.params, "name");
  const task = str(tool.params, "task");
  if (!name || !task) return { output: "Missing name or task", success: false };

  const allowTrades = tool.params.allow_trades === true;
  const maxIterations = typeof tool.params.max_iterations === "number" ? tool.params.max_iterations : undefined;

  const result = await spawnSubagent({
    name,
    task,
    allowTrades,
    maxIterations,
    parentSessionId: session.id,
    loopMode: loopMode === "off" ? "restricted" : loopMode as "full" | "restricted",
  });

  if (result.error) {
    return { output: result.error, success: false };
  }

  return { output: `Subagent "${name}" spawned (ID: ${result.id}). Use subagent_status to check progress.`, success: true };
}

async function handleSubagentStatus(tool: InternalToolCall): Promise<InternalToolResult> {
  const id = str(tool.params, "id") || undefined;
  const agents = await getSubagentStatus(id);

  if (agents.length === 0) {
    return { output: id ? `No subagent found with ID ${id}` : "No active or recent subagents", success: true };
  }

  const lines = agents.map((a) => {
    const duration = a.endedAt
      ? `${Math.round((new Date(a.endedAt).getTime() - new Date(a.startedAt).getTime()) / 1000)}s`
      : `${Math.round((Date.now() - new Date(a.startedAt).getTime()) / 1000)}s (running)`;
    const resultPreview = a.result ? a.result.slice(0, 500) : "";
    return `[${a.name}] ${a.status} | ${duration} | Iterations: ${a.iterations}/${a.maxIterations}${a.error ? ` | Error: ${a.error}` : ""}${resultPreview ? `\nResult: ${resultPreview}` : ""}`;
  });

  return { output: lines.join("\n\n"), success: true };
}

async function handleSubagentStop(tool: InternalToolCall): Promise<InternalToolResult> {
  const id = str(tool.params, "id");
  if (!id) return { output: "Missing subagent ID", success: false };

  const result = await stopSubagent(id);
  return { output: result.error ?? `Subagent ${id} stopped`, success: result.success };
}
