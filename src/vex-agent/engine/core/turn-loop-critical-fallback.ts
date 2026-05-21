/**
 * Critical-band forced compact fallback — proactive runtime safety net
 * invoked at iteration top when `turnBand === "critical"`. Extracted
 * from `turn-loop.ts` for scaling.
 *
 * The helper drives the noop-counter + skip-one-shot state machine and
 * orchestrates the three terminal emit paths (committed log, noop log,
 * escalation: status + log + bug-emit). Caller threads the new
 * state-value back into the loop's closure and, on `committed`, runs
 * `applyPostCompactBookkeeping` + re-observes the band (caller scope
 * because both depend on closure state).
 *
 * Escalation ordering is bit-for-bit preserved with the pre-extraction
 * code (`updateStatus("paused_error") → logger.error → bug-emit`).
 * Codex flagged this ordering in puzzle 03 review — keeping the same
 * order across the helper boundary is a hard requirement.
 */

import { maybeRunForcedCompactFallback } from "@vex-agent/engine/compact-jobs/forced-fallback.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import { pressureFraction, type ContextUsageBand } from "./context-band.js";
import { emitCompactUnableAtCriticalBug } from "./turn-loop-bug-emit.js";
import logger from "@utils/logger.js";

export const COMPACT_MAX_CONSECUTIVE_NOOPS = 2;

export type CriticalBandOutcome =
  | { kind: "below_critical"; nextCriticalNoopCounter: 0 }
  | {
      kind: "skip_one_shot";
      nextSkipCriticalCheckNextIter: false;
      nextCriticalNoopCounter: number;
    }
  | { kind: "committed"; nextCriticalNoopCounter: 0 }
  | {
      kind: "noop";
      nextCriticalNoopCounter: number;
      reason: string;
    }
  | {
      kind: "escalated";
      stopReason: "compact_unable_at_critical";
      consecutiveNoops: number;
      pressureFraction: number;
    };

export async function tryCriticalBandFallback(args: {
  readonly sessionId: string;
  readonly missionRunId: string | null;
  readonly turnBand: ContextUsageBand;
  readonly skipCriticalCheckNextIter: boolean;
  readonly criticalNoopCounter: number;
  readonly currentTokenCount: number;
  readonly contextLimit: number;
}): Promise<CriticalBandOutcome> {
  // Below-critical: noop counter resets the moment band drops out of
  // critical — even if the drop is caused by something other than a
  // compact (e.g. long tool output archived elsewhere). Codex contract.
  if (args.turnBand !== "critical") {
    return { kind: "below_critical", nextCriticalNoopCounter: 0 };
  }

  // One-shot skip: token count is still pre-compact stale; let the next
  // executeTurn refresh it via provider response before re-evaluating.
  if (args.skipCriticalCheckNextIter) {
    return {
      kind: "skip_one_shot",
      nextSkipCriticalCheckNextIter: false,
      nextCriticalNoopCounter: args.criticalNoopCounter,
    };
  }

  const fallback = await maybeRunForcedCompactFallback(args.sessionId);
  if (fallback.kind === "committed") {
    logger.info("compact.forced_fallback.committed", {
      sessionId: args.sessionId,
      generation: fallback.generation,
      jobId: fallback.jobId,
      planMode: fallback.planMode,
    });
    return { kind: "committed", nextCriticalNoopCounter: 0 };
  }

  // Noop path — increment counter, log, maybe escalate.
  const nextCriticalNoopCounter = args.criticalNoopCounter + 1;
  logger.warn("compact.forced_fallback.noop", {
    sessionId: args.sessionId,
    reason: fallback.reason,
    consecutiveCount: nextCriticalNoopCounter,
  });

  if (nextCriticalNoopCounter < COMPACT_MAX_CONSECUTIVE_NOOPS) {
    return {
      kind: "noop",
      nextCriticalNoopCounter,
      reason: fallback.reason,
    };
  }

  // Escalation: paused_error → error log → BUG emit, IN THIS ORDER.
  // Caller sets `stopReason` and breaks the loop; everything else
  // happens here so the emit-sequence stays bit-for-bit identical.
  if (args.missionRunId) {
    await missionRunsRepo.updateStatus(
      args.missionRunId,
      "paused_error",
      "compact_unable_at_critical",
    );
  }
  logger.error("compact.unable_at_critical", {
    sessionId: args.sessionId,
    consecutiveNoops: nextCriticalNoopCounter,
  });
  const pressure = pressureFraction(args.currentTokenCount, args.contextLimit);
  await emitCompactUnableAtCriticalBug({
    sessionId: args.sessionId,
    missionRunId: args.missionRunId,
    consecutiveNoops: nextCriticalNoopCounter,
    pressureFraction: pressure,
    stopReason: "compact_unable_at_critical",
  });
  return {
    kind: "escalated",
    stopReason: "compact_unable_at_critical",
    consecutiveNoops: nextCriticalNoopCounter,
    pressureFraction: pressure,
  };
}
