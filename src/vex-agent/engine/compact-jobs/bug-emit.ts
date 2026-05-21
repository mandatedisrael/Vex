/**
 * Phase 2 BUG-REPORTING emit for compact-worker terminal failures
 * (puzzle 03). Extracted from `executor.ts` so the inline block
 * doesn't pad the already-large worker module.
 *
 * Only TERMINAL `markFailed` outcomes (i.e. `result.terminal === true`,
 * meaning the job hit `WORKER_MAX_ATTEMPTS`) surface here.
 * Non-terminal failures are operational noise — the job will retry on
 * the next poll and emit again only when it permanently gives up.
 *
 * Fail-closed via `emitBugReportSafe` — a support sink failure must
 * never break the worker loop.
 */

export async function emitCompactWorkerPermanentlyFailedBug(args: {
  readonly jobId: number;
  readonly sessionId: string;
  readonly errorMsg: string;
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
      source: "worker",
      category: "compact_unable_at_critical",
      severity: "critical",
      title: "compact-worker.permanently_failed",
      description: args.errorMsg,
      refs: {
        sessionId: args.sessionId,
        compactJobId: args.jobId,
      },
      agentContext: {
        stopReason: "compact_unable_at_critical",
      },
    },
    logger,
  );
}
