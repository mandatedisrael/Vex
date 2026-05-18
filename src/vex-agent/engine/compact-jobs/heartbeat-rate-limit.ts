/**
 * Rate-limit for `compact-worker.heartbeat_failed` log events.
 *
 * The setInterval-driven heartbeat in compact-jobs/executor runs every
 * WORKER_HEARTBEAT_INTERVAL_MS. A transient DB failure (network blip, slow
 * connection) would otherwise produce one log per tick across the outage
 * window. Operators only need to know "this worker is hitting transient DB
 * errors" — one log per minute per workerId is enough signal.
 *
 * Per-workerId granularity is the right grain: a worker processes at most one
 * job at a time, so the failure pattern is shared across that worker's
 * heartbeat loop, not job-specific.
 */

const RATE_LIMIT_WINDOW_MS = 60_000;
const lastEmitByWorker = new Map<string, number>();

export function shouldEmitHeartbeatFailure(
  workerId: string,
  now: number = Date.now(),
): boolean {
  const last = lastEmitByWorker.get(workerId);
  if (last !== undefined && now - last < RATE_LIMIT_WINDOW_MS) {
    return false;
  }
  lastEmitByWorker.set(workerId, now);
  return true;
}

export function _resetHeartbeatRateLimitForTesting(): void {
  lastEmitByWorker.clear();
}
