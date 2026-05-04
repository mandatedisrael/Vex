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

import type { EngineContext, StopReason } from "../types.js";
import type { InferenceProvider, InferenceConfig, ToolDefinition } from "@vex-agent/inference/types.js";
import type { Message } from "@vex-agent/db/repos/messages.js";
import type { PromptStackOptions } from "../prompts/index.js";
import { executeTurn, saveAssistantMessage } from "./turn.js";
import type { ParsedToolCall } from "@vex-agent/inference/types.js";
import { evaluateRuntimeStopConditions } from "./stop-conditions.js";
import { shouldCheckpoint, executeCheckpoint } from "./checkpoint.js";
import { computeBand, type ContextUsageBand } from "./context-band.js";
import { persistToolResultWithOverflow } from "./tool-output-overflow.js";
import { dispatchTool } from "@vex-agent/tools/dispatcher.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as fullAutonomousRunsRepo from "@vex-agent/db/repos/full-autonomous-runs.js";
import * as approvalsRepo from "@vex-agent/db/repos/approvals.js";
import {
  appendPendingOperatorInstructions,
  maxOperatorInstructionId,
} from "./operator-instructions.js";

export interface TurnLoopConfig {
  maxIterations: number;
  timeoutMs: number;
  contextLimit: number;
  buildToolsForBand?: (band: ContextUsageBand) => ToolDefinition[];
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
  // Tracks whether the for-loop exited via natural text-break (chat / mission-setup).
  // Used to distinguish "model finished cleanly" (break on text → stopReason stays
  // null) from "loop exhausted without resolution" (for exits via `iteration <
  // maxIterations` becoming false → iteration_limit fallback below).
  let stoppedOnText = false;
  const startTime = Date.now();
  let currentTokenCount = tokenCount;
  let currentSummary = summary;

  // Mutable copy of messages for turn history
  const liveMessages = [...messages];
  let lastSeenOperatorMessageId = maxOperatorInstructionId(messages);

  /**
   * Evaluate the checkpoint trigger against the freshest known token count
   * and run `executeCheckpoint` if we're over the threshold. Returns `true`
   * only when a real compaction happened (prefix or giant_tool) — the caller
   * uses that to short-circuit normal turn bookkeeping (e.g. mission
   * `[Engine: continue]` injection). A `noop` outcome (cooldown, empty
   * session, no compactable content) leaves the loop on its normal path so
   * the mission protocol stays consistent with any other text turn.
   */
  async function maybeRunCheckpoint(): Promise<boolean> {
    const freshSession = await sessionsRepo.getSession(context.sessionId);
    if (typeof freshSession?.tokenCount === "number" && Number.isFinite(freshSession.tokenCount)) {
      currentTokenCount = Math.max(currentTokenCount, freshSession.tokenCount);
    }
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
    if (context.fullAutonomousRunId) {
      await fullAutonomousRunsRepo.setLastCheckpoint(context.fullAutonomousRunId);
    }

    liveMessages.length = 0;
    const freshMessages = await messagesRepo.getLiveMessages(context.sessionId);
    liveMessages.push(...freshMessages);

    return true;
  }

  async function mergeOperatorInstructions(): Promise<void> {
    lastSeenOperatorMessageId = await appendPendingOperatorInstructions({
      sessionId: context.sessionId,
      afterId: lastSeenOperatorMessageId,
      liveMessages,
    });
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
    } else if (context.fullAutonomousRunId) {
      await fullAutonomousRunsRepo.incrementIterations(context.fullAutonomousRunId);
    }

    const turnBand = computeBand(currentTokenCount, loopConfig.contextLimit);
    const turnTools = loopConfig.buildToolsForBand?.(turnBand) ?? tools;

    // Execute turn
    const turnResult = await executeTurn(
      context, liveMessages, currentSummary, provider, config, turnTools, promptOptions,
    );
    currentTokenCount = turnResult.promptTokens;

    if (abortSignal?.aborted) {
      stopReason = "user_stopped";
      break;
    }

    // ── Handle tool calls ─────────────────────────────────────
    // Deferred save: collect dispatched calls + results, then save the
    // canonical batch prefix (only calls that actually entered dispatch).
    if (turnResult.toolCalls && turnResult.toolCalls.length > 0) {
      const executedCalls: ParsedToolCall[] = [];
      const executedResults: Array<{ toolCallId: string; toolName: string; output: string; success: boolean }> = [];
      let batchStopReason: StopReason | null = null;
      let batchStopOutput: string | null = null;
      let batchStopPayload: { summary?: string; evidence?: Record<string, unknown> } | undefined;
      const dispatchBand = computeBand(currentTokenCount, loopConfig.contextLimit);

      for (const toolCall of turnResult.toolCalls) {
        totalToolCalls++;

        const toolContext: InternalToolContext = {
          sessionId: context.sessionId,
          loadedDocuments: context.loadedDocuments,
          loopMode: context.loopMode,
          approved: false,
          role: context.isSubagent ? "subagent" : "parent",
          missionRunId: context.missionRunId,
          missionId: context.missionId,
          sessionKind: context.sessionKind,
          contextUsageBand: dispatchBand,
          sourceSurface: "vex_agent",
          sourceSession: context.sessionId,
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
        executedResults.push({ toolCallId: toolCall.id, toolName: toolCall.name, output: result.output, success: result.success });

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
          if (sig.type === "defer_until") {
            // `loop_defer` handler already persisted the pending wake row.
            // Turn-loop parks the mission run in `paused_wake` and exits.
            // Evidence carries dueAt + reason so PR-7 executor / PR-10 ingress
            // have the hints they need without re-reading the wake row.
            batchStopReason = "waiting_for_wake";
            batchStopOutput = result.output;
            batchStopPayload = {
              summary: sig.summary,
              evidence: {
                dueAt: sig.dueAt ?? null,
                reason: sig.reason,
              },
            };
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

      // Save tool results (only for fully-executed, non-approval calls).
      // Oversized outputs are externalised into tool_output_blobs (PR-11) —
      // transcript gets a short stub with `metadata.payload.blob_key` so
      // archive-aware checkpoint and resume paths can keep the pointer alive.
      for (const { toolCallId, toolName, output, success } of executedResults) {
        const persisted = await persistToolResultWithOverflow(
          context.sessionId,
          toolCallId,
          toolName,
          output,
          success,
        );

        liveMessages.push({
          role: "tool",
          content: persisted.content,
          toolCallId,
          timestamp: new Date().toISOString(),
          metadata: persisted.metadata,
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
      if (batchStopReason === "waiting_for_wake") {
        // Checkpoint-before-wait FIRST, status flip AFTER. Ordering matters:
        // if we flipped to `paused_wake` before the checkpoint completes,
        // the wake executor (claimDue re-check) and the ingress router
        // (`routeUserMessage` preempt) would both see the run as ready to
        // resume during a window when the checkpoint is still re-shaping
        // the transcript. That window is closed by keeping the run in
        // `running` until checkpoint finishes: a user preempt in that
        // interval is routed as a plain interrupt, a concurrent wake claim
        // hits `status != 'paused_wake'` and skips banner injection.
        const freshSession = await sessionsRepo.getSession(context.sessionId);
        const tokenCountAtWait = freshSession?.tokenCount ?? currentTokenCount;
        if (computeBand(tokenCountAtWait, loopConfig.contextLimit) === "critical") {
          await maybeRunCheckpoint();
        }
        if (context.missionRunId) {
          await missionRunsRepo.updateStatus(context.missionRunId, "paused_wake", "waiting_for_wake");
        }
        stopReason = batchStopReason;
        return { text: batchStopOutput ?? lastText, toolCallsMade: totalToolCalls, pendingApprovals, stopReason, stopPayload: batchStopPayload };
      }
      if (batchStopReason) {
        stopReason = batchStopReason;
        return { text: batchStopOutput ?? lastText, toolCallsMade: totalToolCalls, pendingApprovals, stopReason, stopPayload: batchStopPayload };
      }

      // Normal batch complete — evaluate checkpoint on tool-only paths too
      // (long tool outputs pump the context and text-only gating misses them).
      await maybeRunCheckpoint();
      await mergeOperatorInstructions();
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
        await mergeOperatorInstructions();
        continue;
      }

      // Active mission RUN or full-autonomous session: text does NOT end the
      // loop — inject a continue marker so the next iteration has the
      // protocol cue. Mission SETUP (`sessionKind=mission` but no
      // missionRunId) ends on text like chat. Full autonomous never has a
      // missionRunId but still needs to iterate.
      if (context.missionRunId || context.sessionKind === "full_autonomous") {
        await mergeOperatorInstructions();

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

      // Chat and mission setup: text ends the loop cleanly.
      stoppedOnText = true;
      break;
    }
  }

  // If the for-loop exhausted maxIterations without either an explicit stop OR
  // a natural text-break (chat/setup), surface it as `iteration_limit` so every
  // transport can see why. Chat/setup that ended on text keep stopReason=null
  // (that's the "model replied, we're done" signal). Mission-run and
  // full_autonomous never break on text; their runners treat this as a
  // per-slice yield, not a business stop.
  if (!stopReason && !stoppedOnText) {
    stopReason = "iteration_limit";
  }

  return { text: lastText, toolCallsMade: totalToolCalls, pendingApprovals, stopReason };
}
