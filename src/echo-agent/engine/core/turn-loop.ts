/**
 * Turn loop — main engine loop. Iterates inference turns.
 *
 * In mission run, text from model does NOT end the loop.
 * Ends only on: stop condition, approval pause, or iteration limit.
 *
 * Deferred save: executeTurn() does NOT save the assistant message.
 * This loop determines the canonical batch prefix (only dispatched calls),
 * then saves assistant + tool results in correct order.
 *
 * Invariants:
 * - Every toolCall in the saved assistant message was actually dispatched
 * - Each toolCall has 0 or 1 tool_result in messages (0 = approval pending)
 * - "awaiting approval" state lives in approval_queue, not in messages
 * - liveMessages always has assistant msg BEFORE tool results
 *
 * Semantics per iteration:
 * 1. executeTurn() → model returns text and/or toolCalls (no save)
 * 2. If toolCalls → dispatch + deferred save:
 *    - dispatch returns pendingApproval → enqueue, trim batch, break
 *    - dispatch returns engineSignal → track result, trim batch, break
 *    - dispatch OK → track result → next call
 *    - After batch: save assistant[canonical] + results
 * 3. If text → deferred save text-only assistant message
 * 4. If text + checkpoint needed → checkpoint → continue
 * 5. If text + mission → add continue → next turn
 * 6. If text + chat → break
 */

import type { EngineContext, TurnResult, StopReason } from "../types.js";
import type { InferenceProvider, InferenceConfig, ToolDefinition } from "@echo-agent/inference/types.js";
import type { Message } from "@echo-agent/db/repos/messages.js";
import type { PromptStackOptions } from "../prompts/index.js";
import { executeTurn, saveAssistantMessage, type SingleTurnResult } from "./turn.js";
import type { ParsedToolCall } from "@echo-agent/inference/types.js";
import { evaluateRuntimeStopConditions, type StopConditionContext } from "./stop-conditions.js";
import { shouldCheckpoint, executeCheckpoint } from "./checkpoint.js";
import { dispatchTool } from "@echo-agent/tools/dispatcher.js";
import type { InternalToolContext } from "@echo-agent/tools/internal/types.js";
import * as messagesRepo from "@echo-agent/db/repos/messages.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import * as missionRunsRepo from "@echo-agent/db/repos/mission-runs.js";
import * as approvalsRepo from "@echo-agent/db/repos/approvals.js";

export interface TurnLoopConfig {
  maxIterations: number;
  timeoutMs: number;
  contextLimit: number;
}

export interface TurnLoopResult {
  text: string | null;
  toolCallsMade: number;
  pendingApprovals: string[];
  stopReason: StopReason | null;
  /** Structured stop payload — summary/evidence from mission_stop or complete_subagent. */
  stopPayload?: { summary?: string; evidence?: Record<string, unknown> };
}

/**
 * Run the turn loop.
 *
 * Iterates inference turns until a stop condition or chat response.
 */
export async function runTurnLoop(
  context: EngineContext,
  messages: Message[],
  summary: string | null,
  tokenCount: number,
  provider: InferenceProvider,
  config: InferenceConfig,
  tools: ToolDefinition[],
  loopConfig: TurnLoopConfig,
  promptOptions: PromptStackOptions = {},
  abortSignal?: AbortSignal,
): Promise<TurnLoopResult> {
  let lastText: string | null = null;
  let totalToolCalls = 0;
  const pendingApprovals: string[] = [];
  let stopReason: StopReason | null = null;
  const startTime = Date.now();
  let currentTokenCount = tokenCount;
  let currentSummary = summary;

  // Mutable copy of messages for turn history
  const liveMessages = [...messages];

  /**
   * Evaluate the checkpoint trigger against the DB-authoritative token count
   * and run `executeCheckpoint` if we're over the threshold. Returns `true`
   * only when a real compaction happened (prefix or giant_tool) — the caller
   * uses that to short-circuit normal turn bookkeeping (e.g. mission
   * `[Engine: continue]` injection). A `noop` outcome (cooldown, empty
   * session, no compactable content) leaves the loop on its normal path so
   * the mission protocol stays consistent with any other text turn.
   */
  async function maybeRunCheckpoint(): Promise<boolean> {
    const freshSession = await sessionsRepo.getSession(context.sessionId);
    currentTokenCount = freshSession?.tokenCount ?? currentTokenCount;
    if (!shouldCheckpoint(currentTokenCount, loopConfig.contextLimit)) return false;

    const result = await executeCheckpoint(
      context.sessionId, context.memoryScopeKey, provider, config,
    );

    if (result.mode === "noop") {
      // Don't touch currentSummary (nothing produced), don't reload live
      // messages (nothing changed), don't skip the caller's follow-up work.
      return false;
    }

    if (result.summary) {
      currentSummary = result.summary;
    }

    if (context.missionRunId) {
      await missionRunsRepo.setLastCheckpoint(context.missionRunId);
    }

    liveMessages.length = 0;
    const freshMessages = await messagesRepo.getLiveMessages(context.sessionId);
    liveMessages.push(...freshMessages);
    return true;
  }

  for (let iteration = 0; iteration < loopConfig.maxIterations; iteration++) {
    // Check abort signal
    if (abortSignal?.aborted) {
      stopReason = "user_stopped";
      break;
    }

    // Check runtime stop conditions
    const runtimeStop = evaluateRuntimeStopConditions({
      iterationCount: iteration,
      maxIterations: loopConfig.maxIterations,
      elapsedMs: Date.now() - startTime,
      timeoutMs: loopConfig.timeoutMs,
    });

    if (runtimeStop) {
      stopReason = runtimeStop;
      break;
    }

    // Increment iteration counter for mission runs
    if (context.missionRunId) {
      await missionRunsRepo.incrementIterations(context.missionRunId);
    }

    // Execute turn
    const turnResult = await executeTurn(
      context, liveMessages, currentSummary, provider, config, tools, promptOptions,
    );

    // ── Handle tool calls ─────────────────────────────────────
    // Deferred save: collect dispatched calls + results, then save the
    // canonical batch prefix (only calls that actually entered dispatch).
    if (turnResult.toolCalls && turnResult.toolCalls.length > 0) {
      const executedCalls: ParsedToolCall[] = [];
      const executedResults: Array<{ toolCallId: string; output: string }> = [];
      let batchStopReason: StopReason | null = null;
      let batchStopOutput: string | null = null;
      let batchStopPayload: { summary?: string; evidence?: Record<string, unknown> } | undefined;

      for (const toolCall of turnResult.toolCalls) {
        totalToolCalls++;

        const toolContext: InternalToolContext = {
          sessionId: context.sessionId,
          loadedDocuments: context.loadedDocuments,
          loopMode: context.loopMode,
          approved: false,
          role: context.isSubagent ? "subagent" : "parent",
          missionRunId: context.missionRunId,
        };

        const result = await dispatchTool(
          { name: toolCall.name, args: toolCall.arguments, toolCallId: toolCall.id },
          toolContext,
        );

        // ── Approval break: call was dispatched but has no result in messages ──
        // "awaiting approval" state lives in approval_queue, not in transcript.
        if (result.pendingApproval) {
          executedCalls.push(toolCall);

          const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await approvalsRepo.enqueue(
            approvalId,
            { command: toolCall.name, args: toolCall.arguments },
            result.output,
            context.sessionId,
            toolCall.id,
            context.loopMode,
          );
          pendingApprovals.push(approvalId);
          batchStopReason = "approval_required";

          if (context.missionRunId) {
            await missionRunsRepo.updateStatus(context.missionRunId, "paused_approval", "approval_required");
          }
          break; // remaining calls are NOT dispatched
        }

        // Track executed call + result
        executedCalls.push(toolCall);
        executedResults.push({ toolCallId: toolCall.id, output: result.output });

        // ── Engine signals: result tracked, then stop ──
        if (result.engineSignal) {
          const sig = result.engineSignal;
          if (sig.type === "stop_mission" || sig.type === "complete_subagent") {
            batchStopReason = sig.reason as StopReason;
            batchStopOutput = result.output;
            batchStopPayload = { summary: sig.summary, evidence: sig.evidence };
            break; // remaining calls are NOT dispatched
          }
          if (sig.type === "wait_for_parent") {
            batchStopReason = "waiting_for_parent";
            batchStopOutput = result.output;
            break; // remaining calls are NOT dispatched
          }
        }
      }

      // ── DEFERRED SAVE: assistant message with canonical calls only ──
      await saveAssistantMessage(context.sessionId, turnResult.content, executedCalls);

      liveMessages.push({
        role: "assistant",
        content: turnResult.content ?? "",
        toolCalls: executedCalls.map(tc => ({ id: tc.id, command: tc.name, args: tc.arguments })),
        timestamp: new Date().toISOString(),
      });

      // Save tool results (only for fully-executed, non-approval calls)
      for (const { toolCallId, output } of executedResults) {
        await messagesRepo.addMessage(
          context.sessionId,
          { role: "tool", content: output, toolCallId, timestamp: new Date().toISOString() },
          { source: "tool", messageType: "tool_result", visibility: "internal" },
        );

        liveMessages.push({
          role: "tool", content: output, toolCallId, timestamp: new Date().toISOString(),
        });
      }

      // Update lastText from current turn (assistant may have content alongside toolCalls)
      if (turnResult.content) {
        lastText = turnResult.content;
      }

      // Handle batch exit
      if (batchStopReason === "approval_required") {
        return { text: lastText, toolCallsMade: totalToolCalls, pendingApprovals, stopReason: batchStopReason };
      }
      if (batchStopReason) {
        stopReason = batchStopReason;
        return { text: batchStopOutput ?? lastText, toolCallsMade: totalToolCalls, pendingApprovals, stopReason, stopPayload: batchStopPayload };
      }

      // Normal batch complete — evaluate checkpoint on tool-only paths too
      // (long tool outputs pump the context and text-only gating misses them).
      await maybeRunCheckpoint();
      continue;
    }

    // ── Handle text response ──────────────────────────────────
    if (turnResult.content) {
      lastText = turnResult.content;

      // Deferred save: text-only assistant message
      await saveAssistantMessage(context.sessionId, turnResult.content, null);

      liveMessages.push({
        role: "assistant",
        content: turnResult.content,
        timestamp: new Date().toISOString(),
      });

      // Check checkpoint
      if (await maybeRunCheckpoint()) {
        continue;
      }

      // Active mission RUN: text does NOT end the loop — add continue message.
      // Mission SETUP (sessionKind=mission but no missionRunId) ends on text like chat.
      if (context.missionRunId) {
        await messagesRepo.addEngineMessage(
          context.sessionId,
          "[Engine: continue — no stop condition met. Proceed with next action.]",
          { source: "engine", messageType: "continue", visibility: "internal" },
        );

        liveMessages.push({
          role: "system",
          content: "[Engine: continue — no stop condition met. Proceed with next action.]",
          timestamp: new Date().toISOString(),
        });

        continue;
      }

      // Chat and mission setup: text ends the loop
      break;
    }
  }

  // If loop exhausted without explicit stop during active mission run
  if (!stopReason && context.missionRunId) {
    stopReason = "iteration_limit";
  }

  return { text: lastText, toolCallsMade: totalToolCalls, pendingApprovals, stopReason };
}
