import type { LoopWakeRequest } from "@vex-agent/db/repos/loop-wake.js";
import logger from "@utils/logger.js";

import type { WakeDeps } from "./deps.js";
import { handleClaimed } from "./claimed.js";

// ── Types ──────────────────────────────────────────────────────────

export type ClaimedWakeOutcome =
  | { kind: "resumed"; runId: string }
  | { kind: "skipped_stale_status"; currentStatus: string }
  | { kind: "skipped_claim_lost" }
  | { kind: "skipped_mission_run_missing" }
  | { kind: "error"; message: string };

export interface ClaimedWake {
  wake: LoopWakeRequest;
  outcome: ClaimedWakeOutcome;
}

// ── Pure tick ──────────────────────────────────────────────────────

/**
 * Run a single executor pass. Returns every claimed row with its outcome so
 * callers (scheduler loop, tests, health endpoints) can observe what the
 * executor actually did.
 */
export async function tick(
  now: Date,
  limit: number,
  deps: WakeDeps,
): Promise<ClaimedWake[]> {
  // Pre-claim provider/config gate. `claimDue` is destructive
  // (pending→consumed) and the resume below needs the inference provider, so
  // skip the entire pass (no row consumed) when provider config is absent.
  if (!deps.isProviderReady()) return [];

  const claimed = await deps.claimDue(now, limit);
  const results: ClaimedWake[] = [];

  for (const wake of claimed) {
    try {
      const outcome = await handleClaimed(wake, deps);
      results.push({ wake, outcome });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("wake.executor.handle_failed", {
        wakeId: wake.id,
        sessionId: wake.sessionId,
        missionRunId: wake.missionRunId,
        error: message,
      });
      // Phase 2 BUG-REPORTING emit (puzzle 03): wake resume failures
      // surface as `wake_resume_failure` automatic reports. Fail-closed
      // through `emitBugReportSafe` — a support DB outage cannot break
      // the wake executor.
      const { getBugReportSink } = await import(
        "../../support/bug-report-registry.js"
      );
      const { emitBugReportSafe } = await import(
        "../../../../lib/diagnostics/bug-report-sink.js"
      );
      await emitBugReportSafe(
        getBugReportSink(),
        {
          source: "agent",
          category: "wake_resume_failure",
          severity: "error",
          title: "wake.executor.handle_failed",
          description: message,
          refs: {
            sessionId: wake.sessionId,
            missionRunId: wake.missionRunId,
          },
          agentContext: {
            stopReason: "system_error",
          },
        },
        logger,
      );
      results.push({ wake, outcome: { kind: "error", message } });
    }
  }

  return results;
}
