/**
 * Per-turn tool-batch processor — owns the dispatch loop, deferred
 * save, and all engine-signal handling for a single turn that
 * returned tool calls. Extracted from `turn-loop.ts` for scaling.
 *
 * Deferred-save invariant preserved bit-for-bit:
 *   - `saveAssistantMessage` is called with the canonical batch
 *     prefix (only calls that entered dispatch).
 *   - Each `executedCalls[i]` has 0 or 1 matching `executedResults`
 *     entry (0 only when pendingApproval was returned).
 *   - On `compact_committed` engine signal: remaining calls in the
 *     batch are drained with synthetic `batch_aborted_by_compact`
 *     tool results so the persisted assistant message's `tool_calls`
 *     JSONB still reflects the full emitted batch and the provider's
 *     tool_call/tool_result pairing stays balanced on reload.
 *
 * Caller-orchestrated post-batch state:
 *   - `approval_break` → caller returns immediately.
 *   - `waiting_for_wake` → caller runs forced-compact-before-wait +
 *     `missionRunsRepo.updateStatus("paused_wake")` + returns.
 *   - `engine_stop` (stop_mission, complete_subagent, waiting_for_parent)
 *     → caller returns.
 *   - `compact_committed` → caller runs `handlePostCompactBookkeeping`
 *     then continues to the next iteration.
 *   - `normal_complete` → caller runs `mergeOperatorInstructions` then
 *     continues to the next iteration.
 *
 * Helper mutates `args.liveMessages` directly (push of assistant
 * message + tool results) — matches the pre-extraction site where the
 * mutation lived inline. This is the only side-effect on caller state
 * besides DB writes via `dispatchTool` / `saveAssistantMessage` /
 * `persistToolResultWithOverflow` / `approvalsRepo.enqueue` /
 * `missionRunsRepo.updateStatus("paused_approval")`.
 */

import type { EngineContext, StopReason } from "../types.js";
import type { Message } from "@vex-agent/db/repos/messages.js";
import type {
  ParsedToolCall,
} from "@vex-agent/inference/types.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";
import { buildSessionWalletResolution } from "./hydrate.js";
import { saveAssistantMessage } from "./turn.js";
import { dispatchTool } from "@vex-agent/tools/dispatcher.js";
import { computeBand } from "./context-band.js";
import { persistToolResultWithOverflow } from "./tool-output-overflow.js";
import * as approvalsRepo from "@vex-agent/db/repos/approvals.js";
import * as approvalIntentsRepo from "@vex-agent/db/repos/approval-intents.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import { withTransaction } from "@vex-agent/db/client.js";
import { riskLevelFromActionKind } from "@vex-agent/tools/risk-level.js";
import { buildIntentPreview, buildPolicySnapshot } from "./approval-intent-preview.js";

/** Synthetic tool-result emitted for batch tool calls skipped after a `compact_committed` signal. */
const BATCH_ABORTED_BY_COMPACT_OUTPUT =
  "batch_aborted_by_compact: this tool call was emitted in the same batch as compact_now and was not dispatched. "
  + "The conversation has been compacted; re-emit this call on the next turn if it is still relevant.";

/**
 * Puzzle 5 phase 3 — TTL stamped at enqueue (not at approve). The approve
 * gate (`prepareApprove` snapshot) and the scheduled sweep both rely on a
 * DB-visible `expires_at` so a stale approval gets auto-rejected even
 * without operator action. Single 1h default for all action kinds; phase 7
 * will introduce per-kind TTLs if real workloads need them.
 */
const APPROVAL_TTL_MS = 60 * 60 * 1000;

interface BatchTurnResult {
  readonly content: string | null;
  readonly toolCalls: ParsedToolCall[];
}

export interface StopPayload {
  readonly summary?: string;
  readonly evidence?: Record<string, unknown>;
}

export type ToolBatchOutcome =
  | {
      readonly kind: "approval_break";
      readonly pendingApprovalId: string;
      readonly toolCallsExecuted: number;
      readonly lastText: string | null;
    }
  | {
      readonly kind: "waiting_for_wake";
      readonly text: string | null;
      readonly stopPayload: StopPayload;
      readonly toolCallsExecuted: number;
      readonly lastText: string | null;
    }
  | {
      readonly kind: "engine_stop";
      readonly stopReason: StopReason;
      readonly text: string | null;
      readonly stopPayload?: StopPayload;
      readonly toolCallsExecuted: number;
      readonly lastText: string | null;
    }
  | {
      readonly kind: "compact_committed";
      readonly toolCallsExecuted: number;
      readonly lastText: string | null;
    }
  | {
      readonly kind: "normal_complete";
      readonly toolCallsExecuted: number;
      readonly lastText: string | null;
    };

export async function processTurnToolBatch(args: {
  readonly context: EngineContext;
  readonly turnResult: BatchTurnResult;
  /** MUTATED: pushed with assistant message + tool result messages. */
  readonly liveMessages: Message[];
  readonly currentTokenCount: number;
  readonly contextLimit: number;
  readonly lastTextSoFar: string | null;
}): Promise<ToolBatchOutcome> {
  const { context, turnResult, liveMessages } = args;
  const executedCalls: ParsedToolCall[] = [];
  const executedResults: Array<{
    toolCallId: string;
    toolName: string;
    output: string;
    success: boolean;
  }> = [];

  let toolCallsExecuted = 0;
  let batchStopReason: StopReason | null = null;
  let batchStopOutput: string | null = null;
  let batchStopPayload: StopPayload | undefined;
  let compactCommittedThisBatch = false;
  let approvalId: string | null = null;

  const dispatchBand = computeBand(args.currentTokenCount, args.contextLimit);

  for (let i = 0; i < turnResult.toolCalls.length; i++) {
    const toolCall = turnResult.toolCalls[i];
    toolCallsExecuted++;

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
      walletResolution: buildSessionWalletResolution(context),
      walletPolicy: context.walletPolicy,
    };

    const result = await dispatchTool(
      { name: toolCall.name, args: toolCall.arguments, toolCallId: toolCall.id },
      toolContext,
    );

    // ── Approval break: call was dispatched but has no result in messages ──
    // "awaiting approval" state lives in approval_queue, not in transcript.
    if (result.pendingApproval) {
      // Puzzle 5 phase 2: approval_intents.action_kind is NOT NULL with a
      // CHECK constraint over the 8 canonical ActionKind variants. The
      // dispatcher's `withActionKindFallback` MUST have stamped a kind
      // before this branch — a missing stamp here is a bug in tool
      // registration or in the dispatcher fallback. Fail fast (Codex
      // 2/1B ruling) instead of silently inserting a pseudo-kind or
      // downgrading to a default — neither preserves the policy invariant.
      if (result.actionKind === undefined) {
        throw new Error(
          `Approval intent requires result.actionKind for tool "${toolCall.name}" — ` +
          `dispatcher fallback should have stamped it. ` +
          `Check the tool's actionKind classification in tools/registry/ or protocols/.`,
        );
      }

      executedCalls.push(toolCall);

      approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const intentActionKind = result.actionKind;
      const intentRiskLevel = riskLevelFromActionKind(intentActionKind);
      const intentPreview = buildIntentPreview(toolCall.name, toolCall.arguments);
      const intentPolicy = buildPolicySnapshot(toolContext);
      // Phase 3: stamp `expires_at` at enqueue so the approve gate +
      // scheduled sweep have a DB-visible TTL boundary (see APPROVAL_TTL_MS
      // header). `CreateIntentInput.previewJson/policyJson` were widened in
      // phase 3 to accept the structured builder shapes directly — no
      // `as unknown as Record<string, unknown>` cast needed.
      const intentExpiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();

      // Single transaction: queue + intent + mission-status flip. A
      // partial state (queue without intent, or queue+intent without
      // `paused_approval`) is unrepresentable. Codex 2 phase-2 ruling:
      // the existing pattern of "queue insert, then updateStatus outside
      // tx" could leave a pending approval without the run actually
      // paused if the status update fails.
      await withTransaction(async (client) => {
        await approvalsRepo.enqueueWith(
          client,
          approvalId!,
          { command: toolCall.name, args: toolCall.arguments },
          result.output,
          context.sessionId,
          toolCall.id,
          context.sessionPermission,
        );
        await approvalIntentsRepo.createWith(client, {
          approvalId: approvalId!,
          sessionId: context.sessionId,
          missionRunId: context.missionRunId,
          toolCallId: toolCall.id ?? null,
          actionKind: intentActionKind,
          riskLevel: intentRiskLevel,
          previewJson: intentPreview,
          policyJson: intentPolicy,
          expiresAt: intentExpiresAt,
        });
        if (context.missionRunId) {
          await missionRunsRepo.updateStatus(
            context.missionRunId,
            "paused_approval",
            "approval_required",
            undefined,
            client,
          );
        }
      });
      batchStopReason = "approval_required";
      break; // remaining calls are NOT dispatched
    }

    // Track executed call + result
    executedCalls.push(toolCall);
    executedResults.push({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      output: result.output,
      success: result.success,
    });

    // ── Engine signals: result tracked, then stop ──
    if (result.engineSignal) {
      const sig = result.engineSignal;
      if (sig.type === "stop_mission" || sig.type === "complete_subagent") {
        batchStopReason = sig.reason as StopReason;
        batchStopOutput = result.output;
        batchStopPayload = { summary: sig.summary, evidence: sig.evidence };
        break;
      }
      if (sig.type === "wait_for_parent") {
        batchStopReason = "waiting_for_parent";
        batchStopOutput = result.output;
        break;
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
        break;
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
        break;
      }
    }
  }

  // ── DEFERRED SAVE: assistant message with canonical calls only ──
  await saveAssistantMessage(context.sessionId, turnResult.content, executedCalls);

  liveMessages.push({
    role: "assistant",
    content: turnResult.content ?? "",
    toolCalls: executedCalls.map((tc) => ({
      id: tc.id,
      command: tc.name,
      args: tc.arguments,
    })),
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
  const lastText = turnResult.content ?? args.lastTextSoFar;

  if (batchStopReason === "approval_required") {
    // Helper invariant: approval_required path always set approvalId before break.
    if (approvalId === null) {
      throw new Error("turn-loop-tool-batch: approval_required without approvalId");
    }
    return {
      kind: "approval_break",
      pendingApprovalId: approvalId,
      toolCallsExecuted,
      lastText,
    };
  }
  if (batchStopReason === "waiting_for_wake") {
    return {
      kind: "waiting_for_wake",
      text: batchStopOutput ?? lastText,
      stopPayload: batchStopPayload ?? {},
      toolCallsExecuted,
      lastText,
    };
  }
  if (batchStopReason) {
    return {
      kind: "engine_stop",
      stopReason: batchStopReason,
      text: batchStopOutput ?? lastText,
      stopPayload: batchStopPayload,
      toolCallsExecuted,
      lastText,
    };
  }

  if (compactCommittedThisBatch) {
    return { kind: "compact_committed", toolCallsExecuted, lastText };
  }

  return { kind: "normal_complete", toolCallsExecuted, lastText };
}
