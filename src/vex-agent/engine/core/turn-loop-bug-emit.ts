/**
 * `emitCompactUnableAtCriticalBug` — extracted helper for the
 * Phase-2 BUG-REPORTING emit fired when the turn-loop's
 * critical-band compact escalation hits the consecutive-noop ceiling.
 *
 * Lives in its own module so the inline emit block doesn't pad the
 * already-large turn-loop iteration body. Pure async helper, no
 * closure dependency on loop state — caller threads the contextual
 * fields (sessionId, missionRunId, pressureFraction, noop counter)
 * as plain arguments.
 *
 * Fail-closed via `emitBugReportSafe` — a support sink failure must
 * never break the turn loop.
 */

import type { RuntimeStopReason } from "../types.js";

export async function emitCompactUnableAtCriticalBug(args: {
  readonly sessionId: string;
  readonly missionRunId: string | null;
  readonly consecutiveNoops: number;
  readonly pressureFraction: number;
  readonly stopReason: RuntimeStopReason;
}): Promise<void> {
  const { getBugReportSink } = await import(
    "../support/bug-report-registry.js"
  );
  const { emitBugReportSafe } = await import(
    "../../../lib/diagnostics/bug-report-sink.js"
  );
  const logger = (await import("@utils/logger.js")).default;
  await emitBugReportSafe(
    getBugReportSink(),
    {
      source: "agent",
      category: "compact_unable_at_critical",
      severity: "critical",
      title: "turn-loop.compact_unable_at_critical",
      description: `consecutive_noops=${args.consecutiveNoops}`,
      refs: {
        sessionId: args.sessionId,
        missionRunId: args.missionRunId ?? undefined,
      },
      agentContext: {
        stopReason: args.stopReason,
        runtimeStatus: "paused_error",
        contextPressureBand: "critical",
        contextPressureFraction: args.pressureFraction,
      },
    },
    logger,
  );
}
