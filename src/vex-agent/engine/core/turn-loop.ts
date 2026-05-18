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
 *   (with the explicit exception of the `compact_committed` batch-abort
 *   path: skipped trailing calls are persisted so the assistant.tool_calls
 *   JSONB matches the LLM's emitted batch, but their tool results are
 *   synthesized `batch_aborted_by_compact` errors)
 * - Each toolCall has 0 or 1 tool_result in messages (0 = approval pending)
 * - "awaiting approval" state lives in approval_queue, not in messages
 * - liveMessages always has assistant msg BEFORE tool results
 *
 * Semantics per iteration:
 * 1. Check abort + runtime stop conditions
 * 2. Compute pressure band from currentTokenCount + contextLimit
 * 3. Critical-band forced fallback (PR2):
 *    - if band='critical' AND skipCriticalCheckNextIter is false:
 *      run `maybeRunForcedCompactFallback`; on committed → post-compact
 *      bookkeeping + skip-next-iter; on noop → counter++; ≥2 noops →
 *      stop with `compact_unable_at_critical`
 * 4. Build promptOptions: contextPressureBanner + (if bridge>0) resumePacket
 * 5. executeTurn() → model returns text and/or toolCalls (no save yet)
 * 6. If toolCalls → dispatch + deferred save:
 *    - dispatch returns pendingApproval → enqueue, trim batch, break
 *    - dispatch returns engineSignal=compact_committed → drain remaining
 *      tool calls in batch with synthetic batch_aborted_by_compact results;
 *      assistant message still carries the FULL emitted batch in tool_calls
 *    - dispatch returns engineSignal=stop_mission/etc → track result, break
 *    - dispatch OK → track result → next call
 *    - After batch: save assistant[canonical] + results (in original order)
 *    - If compact_committed observed → post-compact bookkeeping
 * 7. If text → deferred save text-only assistant message; in mission run
 *    inject [Engine: continue] marker; in chat/setup, end the loop
 *
 * Legacy `maybeRunCheckpoint` (auto-compact at threshold) was removed in the
 * PR2 cutover. The only paths into compaction are now:
 *   (a) the `compact_now` tool call producing a `compact_committed` engine
 *       signal (agent-driven), or
 *   (b) the runtime forced-fallback at `critical` band (deterministic safety
 *       net) — invoked both proactively at iter top AND defensively before
 *       a `paused_wake` flip when the wait window opens at critical pressure.
 */

import type { EngineContext, StopReason, RuntimeStopReason } from "../types.js";
import type { InferenceProvider, InferenceConfig, ToolDefinition } from "@vex-agent/inference/types.js";
import type { Message } from "@vex-agent/db/repos/messages.js";
import type { PromptStackOptions } from "../prompts/index.js";
import { executeTurn, saveAssistantMessage } from "./turn.js";
import type { ParsedToolCall } from "@vex-agent/inference/types.js";
import { evaluateRuntimeStopConditions } from "./stop-conditions.js";
import { computeBand, pressureFraction, type ContextUsageBand } from "./context-band.js";
import { persistToolResultWithOverflow } from "./tool-output-overflow.js";
import { dispatchTool } from "@vex-agent/tools/dispatcher.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as approvalsRepo from "@vex-agent/db/repos/approvals.js";
import {
  appendPendingOperatorInstructions,
  maxOperatorInstructionId,
} from "./operator-instructions.js";
import { maybeRunForcedCompactFallback } from "@vex-agent/engine/compact-jobs/forced-fallback.js";
import { buildContextPressureBanner } from "../prompts/context-pressure.js";
import { buildResumePacket } from "../prompts/resume-packet.js";
import { POST_COMPACT_BRIDGE_CYCLES } from "@vex-agent/memory/policy.js";
import logger from "@utils/logger.js";

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

/** Synthetic tool-result emitted for batch tool calls skipped after a `compact_committed` signal. */
const BATCH_ABORTED_BY_COMPACT_OUTPUT =
  "batch_aborted_by_compact: this tool call was emitted in the same batch as compact_now and was not dispatched. "
  + "The conversation has been compacted; re-emit this call on the next turn if it is still relevant.";

const COMPACT_MAX_CONSECUTIVE_NOOPS = 2;

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

  // PR2: post-compact bridge counter — drives resume packet injection for the
  // first `POST_COMPACT_BRIDGE_CYCLES` turns after any compact (agent-driven
  // or forced fallback). Set to N at compact time; decremented each turn the
  // packet is built. In-memory only; armed once at loop entry whenever the
  // session has ever been compacted (`sessions.checkpoint_generation > 0`)
  // so a wake-resume or app-restart that lost the in-memory counter still
  // shows the post-compact bridge for the first two turns — without that
  // arm, the agent resumes blind after every `waiting_for_wake` pause whose
  // forced-compact-before-wait fired (codex P2 round 3).
  let postCompactBridgeRemaining = 0;
  try {
    const initialSession = await sessionsRepo.getSession(context.sessionId);
    if (initialSession && initialSession.checkpointGeneration > 0) {
      postCompactBridgeRemaining = POST_COMPACT_BRIDGE_CYCLES;
    }
  } catch (err) {
    logger.warn("turn-loop.bridge_arm_failed", {
      sessionId: context.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // PR2: critical-band noop counter — increments each time forced fallback
  // returns `noop` at critical band. Reset to 0 on any committed compact OR
  // when band drops below critical. Escalates to `compact_unable_at_critical`
  // when it reaches `COMPACT_MAX_CONSECUTIVE_NOOPS`.
  let criticalNoopCounter = 0;

  // PR2: one-shot skip — after a committed compact, the next iteration's
  // band check still reads the stale `currentTokenCount` (updated only after
  // the next executeTurn). Without this guard, the iteration immediately
  // following a successful compact would see "critical" band and fire a
  // redundant forced fallback that almost certainly returns `noop` (nothing
  // left to compact), inflating the counter falsely.
  let skipCriticalCheckNextIter = false;

  async function mergeOperatorInstructions(): Promise<void> {
    lastSeenOperatorMessageId = await appendPendingOperatorInstructions({
      sessionId: context.sessionId,
      afterId: lastSeenOperatorMessageId,
      liveMessages,
    });
  }

  /**
   * Post-compact bookkeeping — applied after ANY committed compact (agent-driven
   * via `compact_committed` engine signal OR runtime-driven via forced fallback).
   * Order matches codex contract:
   *   1. Reload live messages from DB (archive prefix is now committed).
   *   2. Merge any operator-interrupt messages that landed during compact.
   *   3. Update `mission_runs.last_checkpoint_at` (active runs only).
   *   4. Refresh rolling summary from `sessions.summary` (set by compact).
   *   5. Reset `currentTokenCount` so the NEXT iteration's tool-projection /
   *      pressure-banner / forced-fallback check uses a normal-band view —
   *      stale token-count would otherwise keep tools restricted and the
   *      banner stuck on the pressure copy until the next provider response
   *      arrives. The freshly-compacted prompt is almost always far below the
   *      pressure thresholds, so a `0` baseline is the safe interim; the next
   *      executeTurn() overwrites it with the actual post-compact prompt size.
   *   6. Arm bridge counter; reset critical-band noop counter; arm skip flag.
   */
  async function handlePostCompactBookkeeping(): Promise<void> {
    liveMessages.length = 0;
    const freshMessages = await messagesRepo.getLiveMessages(context.sessionId);
    liveMessages.push(...freshMessages);
    await mergeOperatorInstructions();
    if (context.missionRunId) {
      await missionRunsRepo.setLastCheckpoint(context.missionRunId);
    }
    const freshSession = await sessionsRepo.getSession(context.sessionId);
    currentSummary = freshSession?.summary ?? null;
    currentTokenCount = 0;
    postCompactBridgeRemaining = POST_COMPACT_BRIDGE_CYCLES;
    criticalNoopCounter = 0;
    skipCriticalCheckNextIter = true;
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

    // ── Critical-band forced fallback (proactive) ─────────────
    // Compute on entry; may be re-evaluated after a committed fallback so the
    // banner + tool projection below see the post-compact state on the very
    // first provider call after the runtime intervenes.
    let turnBand = computeBand(currentTokenCount, loopConfig.contextLimit);

    if (turnBand !== "critical") {
      // Counter resets the moment the band drops out of critical — even if the
      // drop is caused by something other than a compact (e.g. a long tool
      // output being archived elsewhere). Codex contract.
      criticalNoopCounter = 0;
    }

    if (turnBand === "critical" && skipCriticalCheckNextIter) {
      // One-shot skip: token count is still pre-compact stale; let executeTurn
      // refresh it via the next provider response before re-evaluating.
      skipCriticalCheckNextIter = false;
    } else if (turnBand === "critical") {
      const fallback = await maybeRunForcedCompactFallback(context.sessionId);
      if (fallback.kind === "committed") {
        logger.info("compact.forced_fallback.committed", {
          sessionId: context.sessionId,
          generation: fallback.generation,
          jobId: fallback.jobId,
          planMode: fallback.planMode,
        });
        await handlePostCompactBookkeeping();
        // `handlePostCompactBookkeeping` reset `currentTokenCount = 0` so the
        // recomputed band drops from critical → normal for this very turn.
        // Without this re-read, the pressure banner + tool projection below
        // would still see the stale critical band and either hide every
        // mutating tool the agent now needs OR keep the directive
        // "compact_now is your only option" copy in the prompt — wasting the
        // first post-compact turn. Codex flagged this as P1 #2.
        turnBand = computeBand(currentTokenCount, loopConfig.contextLimit);
      } else {
        criticalNoopCounter++;
        logger.warn("compact.forced_fallback.noop", {
          sessionId: context.sessionId,
          reason: fallback.reason,
          consecutiveCount: criticalNoopCounter,
        });
        if (criticalNoopCounter >= COMPACT_MAX_CONSECUTIVE_NOOPS) {
          const runtimeReason: RuntimeStopReason = "compact_unable_at_critical";
          stopReason = runtimeReason;
          if (context.missionRunId) {
            await missionRunsRepo.updateStatus(
              context.missionRunId,
              "paused_error",
              runtimeReason,
            );
          }
          logger.error("compact.unable_at_critical", {
            sessionId: context.sessionId,
            consecutiveNoops: criticalNoopCounter,
          });
          break;
        }
      }
    }

    // ── Per-turn prompt-stack banner inputs ───────────────────
    // `turnBand` reflects the post-fallback state when a committed compact
    // just landed (currentTokenCount was reset to 0). Fraction is recomputed
    // from the same source so banner + tool catalog + dispatch share one
    // pressure reading per turn.
    const turnFraction = pressureFraction(currentTokenCount, loopConfig.contextLimit);
    const turnPromptOptions: PromptStackOptions = { ...promptOptions };
    turnPromptOptions.contextPressureBanner = buildContextPressureBanner(turnBand, turnFraction);

    if (postCompactBridgeRemaining > 0) {
      try {
        const freshSession = await sessionsRepo.getSession(context.sessionId);
        const generation = freshSession?.checkpointGeneration ?? 0;
        const packet = await buildResumePacket(context.sessionId, generation);
        if (packet.length > 0) {
          turnPromptOptions.resumePacket = packet;
        }
      } catch (err) {
        logger.warn("turn.resume_packet.fetch_failed", {
          sessionId: context.sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      postCompactBridgeRemaining--;
    }

    // ── Tool projection per band ──────────────────────────────
    const turnTools = loopConfig.buildToolsForBand?.(turnBand) ?? tools;

    // Execute turn
    const turnResult = await executeTurn(
      context, liveMessages, currentSummary, provider, config, turnTools, turnPromptOptions,
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
      let compactCommittedThisBatch = false;
      const dispatchBand = computeBand(currentTokenCount, loopConfig.contextLimit);

      for (let i = 0; i < turnResult.toolCalls.length; i++) {
        const toolCall = turnResult.toolCalls[i];
        totalToolCalls++;

        const toolContext: InternalToolContext = {
          sessionId: context.sessionId,
          loadedDocuments: context.loadedDocuments,
          sessionPermission: context.sessionPermission,
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
            context.sessionPermission,
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
          if (sig.type === "compact_committed") {
            // Drain remaining tool calls in this batch with synthetic
            // batch_aborted_by_compact results. The assistant message that
            // gets persisted still carries the FULL emitted batch in its
            // tool_calls JSONB so the provider's tool_call/tool_result
            // pairing stays balanced after reload.
            compactCommittedThisBatch = true;
            for (let j = i + 1; j < turnResult.toolCalls.length; j++) {
              const skipped = turnResult.toolCalls[j];
              executedCalls.push(skipped);
              executedResults.push({
                toolCallId: skipped.id,
                toolName: skipped.name,
                output: BATCH_ABORTED_BY_COMPACT_OUTPUT,
                success: false,
              });
            }
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
        // Forced-compact-before-wait: ordering matters. The mission run stays
        // in `running` until the fallback finishes — keeps a concurrent wake
        // claim (status='paused_wake' lookup) or user preempt from racing the
        // compact rewrite of the transcript. Best-effort: if the fallback
        // commits we apply post-compact bookkeeping; if it noops we proceed
        // to the wake flip with stale state (next resume will see critical
        // and the loop will reevaluate).
        const freshSession = await sessionsRepo.getSession(context.sessionId);
        const tokenCountAtWait = freshSession?.tokenCount ?? currentTokenCount;
        if (computeBand(tokenCountAtWait, loopConfig.contextLimit) === "critical") {
          const fallback = await maybeRunForcedCompactFallback(context.sessionId);
          if (fallback.kind === "committed") {
            await handlePostCompactBookkeeping();
          }
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

      if (compactCommittedThisBatch) {
        await handlePostCompactBookkeeping();
        continue;
      }

      // Normal batch complete
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

      // Active mission RUN: text does NOT end the loop — inject a continue
      // marker so the next iteration has the protocol cue. Mission SETUP
      // (`sessionKind=mission` but no missionRunId) ends on text like agent.
      if (context.missionRunId) {
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
  // a natural text-break (agent/setup), surface it as `iteration_limit` so every
  // transport can see why. Agent/setup that ended on text keep stopReason=null
  // (that's the "model replied, we're done" signal). Mission-run never breaks
  // on text; its runner treats this as a per-slice yield, not a business stop.
  if (!stopReason && !stoppedOnText) {
    stopReason = "iteration_limit";
  }

  return { text: lastText, toolCallsMade: totalToolCalls, pendingApprovals, stopReason };
}
