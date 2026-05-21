/**
 * Iteration-entry guards — runs the three checks at the top of every
 * loop iteration in this order:
 *
 *   1. Abort signal (user_stopped)
 *   2. Pending control request (paused_user / stopped via puzzle-03
 *      observe-and-apply)
 *   3. Runtime stop conditions (iteration_limit, timeout)
 *
 * The order is contract: abort wins over a pending control request,
 * and the control request wins over a runtime stop so a user-pause
 * always lands cleanly even at the iteration that would have hit
 * iteration_limit anyway.
 *
 * The helper RETURNS the outcome and never increments the mission-run
 * iteration counter — caller increments AFTER the `proceed` outcome
 * so the counter only ticks for iterations that actually run a turn.
 *
 * `emitTurnLoopControlState` stays in the caller (matches the
 * v4-codex contract: "emit at the loop boundary, decisions in the
 * helper"). The helper just surfaces the discriminated `control_*`
 * outcomes so the caller can run the canonical emit.
 */

import type { RuntimeStopReason } from "../types.js";
import { evaluateRuntimeStopConditions } from "./stop-conditions.js";
import { observePendingControlRequest } from "./turn-loop-observe.js";

export type IterationEntryOutcome =
  | { kind: "proceed" }
  | { kind: "abort_user_stopped" }
  | { kind: "control_paused_user"; correlationId: string | null }
  | { kind: "control_stopped"; correlationId: string | null }
  | { kind: "runtime_stop"; stopReason: RuntimeStopReason };

export async function runIterationEntryGuards(args: {
  readonly sessionId: string;
  readonly missionRunId: string | null;
  readonly abortSignal?: AbortSignal;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly elapsedMs: number;
  readonly timeoutMs: number;
}): Promise<IterationEntryOutcome> {
  if (args.abortSignal?.aborted) {
    return { kind: "abort_user_stopped" };
  }

  if (args.missionRunId !== null) {
    const observeOutcome = await observePendingControlRequest({
      sessionId: args.sessionId,
      missionRunId: args.missionRunId,
    });
    if (observeOutcome.kind === "paused_user_applied") {
      return {
        kind: "control_paused_user",
        correlationId: observeOutcome.correlationId,
      };
    }
    if (observeOutcome.kind === "stop_applied") {
      return {
        kind: "control_stopped",
        correlationId: observeOutcome.correlationId,
      };
    }
    // `no_request` / `observe_error` — fall through; helper already logged
    // the error case via `turn-loop.observe_control_failed`.
  }

  const runtimeStop = evaluateRuntimeStopConditions({
    iterationCount: args.iteration,
    maxIterations: args.maxIterations,
    elapsedMs: args.elapsedMs,
    timeoutMs: args.timeoutMs,
  });
  if (runtimeStop) {
    return { kind: "runtime_stop", stopReason: runtimeStop };
  }

  return { kind: "proceed" };
}
