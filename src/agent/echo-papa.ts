/**
 * Echo Papa — LLM-powered background knowledge steward.
 *
 * Runs every 30 minutes via scheduler. Has its own inference loop
 * with a dedicated system prompt and limited tool set (CRUD only).
 *
 * Architecture:
 * - Uses inferWithTools() directly (NOT processMessage) — bypasses mama's prompt stack
 * - Fresh session per cycle — no persistence, no compaction risk
 * - Tool whitelist enforced in code — only file_read, file_write, file_list, file_delete, memory_manage
 * - Safe executor: protected paths, recency guard, must-read-before-delete
 * - Usage logged separately since we bypass the engine loop
 */

import type { Message, InternalToolCall, ConversationSession, InferenceConfig, ParsedToolCall } from "./types.js";
import type { OpenAITool } from "./tool-registry.js";
import { TOOLS } from "./tool-registry.js";
import { createSession } from "./engine.js";
import { inferWithTools } from "./inference.js";
import { generateId } from "./id.js";
import { SUBAGENT_CONTEXT_LIMIT } from "./constants.js";
import { buildPapaSystemPrompt, buildPapaCyclePrompt } from "./prompts/echo-papa.js";
import * as sessionsRepo from "./db/repos/sessions.js";
import * as messagesRepo from "./db/repos/messages.js";
import * as usageRepo from "./db/repos/usage.js";
import * as memoryRepo from "./db/repos/memory.js";
import * as knowledgeRepo from "./db/repos/knowledge.js";
import logger from "../utils/logger.js";

// ── Constants ────────────────────────────────────────────────────────

const PAPA_MAX_ITERATIONS = 15;
const PAPA_RECENCY_GUARD_MS = 5 * 60 * 1000; // 5 minutes

const PAPA_ALLOWED_TOOLS = new Set([
  "file_read", "file_write", "file_list", "file_delete",
  "memory_manage",
]);

const PROTECTED_PATHS = new Set(["soul.md", "../soul.md"]);

// ── Tool subset ──────────────────────────────────────────────────────

function getPapaTools(): OpenAITool[] {
  return TOOLS
    .filter(t => PAPA_ALLOWED_TOOLS.has(t.name))
    .map(t => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}

// ── Safe executor ────────────────────────────────────────────────────

/** Tracks which files Papa has read this cycle (for must-read-before-delete rule). */
const filesReadThisCycle = new Set<string>();

function isProtectedPath(path: string): boolean {
  const normalized = path.toLowerCase().trim();
  return PROTECTED_PATHS.has(normalized) || normalized.startsWith("../");
}

async function isRecentlyModified(path: string): Promise<boolean> {
  const file = await knowledgeRepo.getFileWithMeta(path);
  if (!file?.updatedAt) return false;
  return (Date.now() - new Date(file.updatedAt).getTime()) < PAPA_RECENCY_GUARD_MS;
}

/**
 * Execute a single Papa tool call with safety enforcement.
 * Returns the tool output string.
 */
async function executePapaTool(
  toolName: string,
  params: Record<string, unknown>,
  session: ConversationSession,
): Promise<string> {
  // 1. Whitelist enforcement (defense in depth — tools are also filtered at API level)
  if (!PAPA_ALLOWED_TOOLS.has(toolName)) {
    return `DENIED: Tool "${toolName}" is not available to Echo Papa.`;
  }

  const path = String(params.path ?? "");

  // 2. Protected path enforcement
  if ((toolName === "file_write" || toolName === "file_delete") && path) {
    if (isProtectedPath(path)) {
      return `DENIED: "${path}" is a protected path. Echo Papa cannot modify it.`;
    }
  }

  // 3. Recency guard — don't overwrite files mama just wrote
  if ((toolName === "file_write" || toolName === "file_delete") && path) {
    if (await isRecentlyModified(path)) {
      return `DENIED: "${path}" was modified less than 5 minutes ago. Skipping to avoid race with active agent.`;
    }
  }

  // 4. Active trade protection — don't modify files with open/pending positions
  if ((toolName === "file_write" || toolName === "file_delete") && path && path.startsWith("trades/")) {
    const existing = filesReadThisCycle.has(path)
      ? null // already checked via read
      : await knowledgeRepo.getFile(path);
    const contentToCheck = existing ?? "";
    if (contentToCheck && /status["\s:]*(?:open|pending)/i.test(contentToCheck)) {
      return `DENIED: "${path}" contains active trade positions (open/pending). Cannot modify.`;
    }
  }

  // 5. Must-read-before-delete enforcement
  if (toolName === "file_delete" && path) {
    if (!filesReadThisCycle.has(path)) {
      return `DENIED: Cannot delete "${path}" — must file_read it first in this cycle.`;
    }
  }

  // 6. Execute via existing handlers (reuse the same logic as mama's internal tools)
  try {
    return await dispatchTool(toolName, params, session);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("echo_papa.tool.failed", { tool: toolName, error: msg });
    return `Error: ${msg}`;
  }
}

/** Dispatch to the actual tool handler (reuses existing repo functions). */
async function dispatchTool(
  toolName: string,
  params: Record<string, unknown>,
  session: ConversationSession,
): Promise<string> {
  const str = (key: string) => typeof params[key] === "string" ? params[key] as string : "";

  switch (toolName) {
    case "file_read": {
      const path = str("path");
      if (!path) return "Missing path";
      const content = await knowledgeRepo.getFile(path);
      if (!content) return `Not found: ${path}`;
      filesReadThisCycle.add(path);
      session.loadedKnowledge.set(path, content);
      return `Loaded: ${path} (${content.length} chars)\n\n${content}`;
    }

    case "file_write": {
      const path = str("path"), content = str("content");
      if (!path || !content) return "Missing path or content";
      await knowledgeRepo.upsertFile(path, content);
      return `Written: ${path} (${content.length} chars)`;
    }

    case "file_list": {
      const entries = await knowledgeRepo.listFiles(str("path"));
      return JSON.stringify(entries, null, 2);
    }

    case "file_delete": {
      const path = str("path");
      if (!path) return "Missing path";
      await knowledgeRepo.deleteFile(path);
      session.loadedKnowledge.delete(path);
      return `Deleted: ${path}`;
    }

    case "memory_manage": {
      const action = str("action");

      if (action === "list") {
        const entries = await memoryRepo.listEntriesWithIds();
        return JSON.stringify(entries, null, 2);
      }
      if (action === "append") {
        const text = str("append") || str("content");
        if (!text) return "Missing append text";
        await memoryRepo.appendMemory(text, undefined, "echo_papa");
        return "Memory entry appended";
      }
      if (action === "replace") {
        const id = params.id;
        const content = str("content");
        if (typeof id !== "number" || !content) return "Missing id or content";
        const replaced = await memoryRepo.replaceEntry(id, content);
        return replaced ? `Entry #${id} replaced` : `Entry #${id} not found`;
      }
      if (action === "delete") {
        const id = params.id;
        if (typeof id !== "number") return "Missing id";
        const deleted = await memoryRepo.deleteEntry(id);
        return deleted ? `Entry #${id} deleted` : `Entry #${id} not found`;
      }
      return `Unknown action: "${action}". Use list, append, replace, or delete.`;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ── Stats collection ─────────────────────────────────────────────────

async function analyzeState(): Promise<{ memoryCount: number; fileCount: number; folders: string[] }> {
  const memoryCount = (await memoryRepo.listEntriesWithIds()).length;
  const fileCount = await knowledgeRepo.fileCount();
  const topLevel = await knowledgeRepo.listFiles("");
  const folders = topLevel.filter(f => f.type === "dir").map(f => f.name);
  return { memoryCount, fileCount, folders };
}

// ── Inference loop ───────────────────────────────────────────────────

export async function runEchoPapaCycle(): Promise<{ success: boolean; result: string; toolCalls: number; tokensUsed: number }> {
  // Fresh session per cycle
  const session = createSession();
  if (!session) {
    return { success: false, result: "Agent not ready — no inference config", toolCalls: 0, tokensUsed: 0 };
  }

  // Override context limit for Papa (40k)
  session.inferenceConfig = { ...session.inferenceConfig, contextLimit: SUBAGENT_CONTEXT_LIMIT };
  await sessionsRepo.createSession(session.id);
  await sessionsRepo.setScope(session.id, "papa");

  // Reset per-cycle tracking
  filesReadThisCycle.clear();

  // Build Papa's own system prompt with current stats
  const stats = await analyzeState();
  const systemPrompt = buildPapaSystemPrompt(stats);
  const userPrompt = buildPapaCyclePrompt(stats);

  // Initial messages — Papa's own prompt stack (NOT mama's buildSystemPrompt)
  const messages: Message[] = [
    { role: "system", content: systemPrompt, timestamp: new Date().toISOString() },
    { role: "user", content: userPrompt, timestamp: new Date().toISOString() },
  ];

  const config = session.inferenceConfig;
  const papaTools = getPapaTools();
  let totalToolCalls = 0;
  let totalTokens = 0;
  let finalResult = "";
  let hadError = false;

  try {
    for (let iteration = 0; iteration < PAPA_MAX_ITERATIONS; iteration++) {
      // Call LLM with Papa's limited tool set
      const response = await inferWithTools(config, messages, papaTools);

      // Log usage
      const cost = (response.usage.promptTokens / 1_000_000) * config.inputPricePerM
                 + (response.usage.completionTokens / 1_000_000) * config.outputPricePerM;
      await usageRepo.logUsage(session.id, response.usage.promptTokens, response.usage.completionTokens, cost, config.provider, config.priceCurrency);
      totalTokens += response.usage.promptTokens + response.usage.completionTokens;

      // If text response (no tool calls) — done
      if (response.content && (!response.toolCalls || response.toolCalls.length === 0)) {
        finalResult = response.content;
        // Persist final message
        const assistantMsg: Message = { role: "assistant", content: response.content, timestamp: new Date().toISOString() };
        messages.push(assistantMsg);
        await messagesRepo.addMessage(session.id, assistantMsg);
        break;
      }

      // Process tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Store assistant message with tool calls
        const assistantMsg: Message = {
          role: "assistant",
          content: response.content ?? "",
          toolCalls: response.toolCalls.map(tc => ({
            id: generateId("call"),
            command: tc.name,
            args: tc.arguments as Record<string, unknown>,
          })),
          timestamp: new Date().toISOString(),
        };
        messages.push(assistantMsg);
        await messagesRepo.addMessage(session.id, assistantMsg);

        // Execute each tool call through the safe executor
        for (let i = 0; i < response.toolCalls.length; i++) {
          const tc = response.toolCalls[i];
          const toolCallId = assistantMsg.toolCalls![i].id;
          totalToolCalls++;

          logger.debug("echo_papa.tool.execute", { tool: tc.name, iteration });

          const output = await executePapaTool(
            tc.name,
            tc.arguments as Record<string, unknown>,
            session,
          );

          // Feed result back to LLM
          const toolMsg: Message = {
            role: "tool",
            content: output,
            toolCallId,
            timestamp: new Date().toISOString(),
          };
          messages.push(toolMsg);
          await messagesRepo.addMessage(session.id, toolMsg);
        }

        // Continue loop — LLM will see tool results and decide next step
        continue;
      }

      // No content and no tool calls — unexpected, stop
      finalResult = "(no output from model)";
      break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("echo_papa.cycle.failed", { sessionId: session.id, error: msg, iteration: totalToolCalls });
    finalResult = `Error: ${msg}`;
    hadError = true;
  }

  // Write report
  const report = `# Echo Papa Report — ${new Date().toISOString().slice(0, 16)}

- Tool calls: ${totalToolCalls}
- Tokens used: ${totalTokens}
- Memory entries: ${stats.memoryCount}
- Knowledge files: ${stats.fileCount}

## Summary

${finalResult}
`;

  try {
    await knowledgeRepo.upsertFile("ops/echo-papa-report.md", report);
  } catch (err) {
    logger.warn("echo_papa.report.write_failed", { error: err instanceof Error ? err.message : String(err) });
  }

  logger.info("echo_papa.cycle.complete", {
    sessionId: session.id,
    toolCalls: totalToolCalls,
    tokensUsed: totalTokens,
    resultLength: finalResult.length,
  });

  return { success: !hadError, result: finalResult, toolCalls: totalToolCalls, tokensUsed: totalTokens };
}
