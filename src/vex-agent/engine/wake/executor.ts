/**
 * Wake executor — single-process scheduler that drives `loop_defer` wakes.
 *
 * Contract:
 *   - Exactly ONE process runs the executor per deployment. Race safety
 *     across ticks is provided by `loopWakeRepo.claimDue` (FOR UPDATE SKIP
 *     LOCKED). Mission-run wake resumes also claim the run row with a CAS
 *     before injecting the wake banner, so `/retry` and wake cannot both
 *     resume the same stale `paused_wake` snapshot.
 *   - The desktop-agent host should start one process-local executor with
 *     hardcoded defaults (interval=2000ms, batchSize=10) after DB bootstrap.
 *     Wake is an installed-runtime concern, not a renderer concern.
 *
 * Tick semantics:
 *   1. `claimDue(now, batchSize)` — atomically flips the pending rows to
 *      `consumed` and returns them. Rows the executor cannot handle (e.g.
 *      session status drifted to `running` because a user preempted) are
 *      SKIPPED but NOT unclaimed — the row is terminal once consumed, and
 *      the race is accepted (the user already resumed the session, so no
 *      banner needs to be injected).
 *   2. For every claimed row, the executor re-checks the mission run state
 *      and either (a) injects a `wake_due` banner + triggers the resume
 *      path or (b) logs the drift and skips. Every outcome is reported on
 *      the returned `ClaimedWake` so tests and operators can see the result.
 *
 * Post-M12 simplification: `full_autonomous` mode is gone. Every wake row
 * targets a mission run; the executor no longer branches on `wake.kind`.
 */

import type { LoopWakeRequest } from "@vex-agent/db/repos/loop-wake.js";
import type { MissionRun } from "@vex-agent/db/repos/mission-runs.js";
import type { MissionRunStatus } from "../types.js";
import { AUTO_RETRY_WAKE_TRIGGER } from "../core/runner/mission-auto-retry-policy.js";
import logger from "@utils/logger.js";

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

/**
 * Dependencies hoisted out of concrete imports so tests can inject fakes
 * without loading the real DB / engine stack. The production factory
 * (`buildProductionDeps`) builds a `WakeDeps` from the repos + engine
 * entrypoints.
 */
export interface WakeDeps {
  /** Claim up to `limit` due rows, atomically flipping them to `consumed`. */
  claimDue(now: Date, limit: number): Promise<LoopWakeRequest[]>;
  /** Fetch a mission run by id (used to re-check status before resume). */
  getMissionRun(runId: string): Promise<MissionRun | null>;
  /** Claim a paused run before injecting a wake banner and resuming. */
  casFlipToRunning(
    runId: string,
    fromStatuses: readonly MissionRunStatus[],
  ): Promise<MissionRunStatus | null>;
  /** Persist a `wake_due` banner for the resume path to pick up. */
  injectWakeBanner(sessionId: string, reason: string | null, dueAt: string): Promise<void>;
  /** Resume a mission run. */
  resumeMissionRun(runId: string): Promise<void>;
  /**
   * Pre-claim provider/config gate. `claimDue` is destructive
   * (pending→consumed) and the subsequent resume runs the agent turn loop,
   * which needs the inference provider. The executor must NOT claim wake rows
   * when provider config is absent (e.g. before the vault injects the key on
   * unlock); production checks OPENROUTER_API_KEY + AGENT_MODEL in env.
   */
  isProviderReady(): boolean;
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
        "../support/bug-report-registry.js"
      );
      const { emitBugReportSafe } = await import(
        "../../../lib/diagnostics/bug-report-sink.js"
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

async function handleClaimed(
  wake: LoopWakeRequest,
  deps: WakeDeps,
): Promise<ClaimedWakeOutcome> {
  const run = await deps.getMissionRun(wake.missionRunId);
  if (!run) {
    return { kind: "skipped_mission_run_missing" };
  }

  // Phase 4d: error-retry wakes resume a `paused_error` run through the
  // auto-retry claim (which re-verifies the full safety state). Routed by the
  // structured payload trigger, NOT the model-influenced `reason` text.
  if (wake.payload?.trigger === AUTO_RETRY_WAKE_TRIGGER) {
    return handleAutoRetryClaimed(wake, run, deps);
  }

  // Preempt-before-resume re-check. Only wake a run that is still
  // `paused_wake` — a user message or terminal transition may have
  // already moved it elsewhere while this tick was spooling up.
  if (run.status !== "paused_wake") {
    logger.info("wake.executor.skip_stale", {
      wakeId: wake.id,
      runId: run.id,
      status: run.status,
    });
    return { kind: "skipped_stale_status", currentStatus: run.status };
  }

  // Puzzle 03 — atomic claim lease + flip status in a single tx.
  // Replaces the non-atomic CAS-then-acquireLease that could leave
  // the run as `running` with no runner if the lease acquire failed
  // (codex blocker). Also handles the `paused_wake → consumed_by_resume`
  // wake cleanup inside the same transaction.
  const ownerId = `wake-executor-${wake.id}`;
  const { claimRunLeaseAndFlipToRunning } = await import(
    "../runtime/lease-and-status.js"
  );
  const claim = await claimRunLeaseAndFlipToRunning({
    sessionId: wake.sessionId,
    missionRunId: run.id,
    fromStatuses: ["paused_wake"],
    ownerId,
    processKind: "electron_main",
    ttlMs: 5 * 60_000,
  });
  if (claim.outcome === "lease_busy") {
    logger.info("wake.executor.skip_lease_busy", {
      wakeId: wake.id,
      runId: run.id,
    });
    return { kind: "skipped_claim_lost" };
  }
  if (claim.outcome === "status_mismatch") {
    logger.info("wake.executor.skip_claim_lost", {
      wakeId: wake.id,
      runId: run.id,
      currentStatus: claim.currentStatus,
    });
    return { kind: "skipped_claim_lost" };
  }

  const { createLeaseHandle } = await import("../runtime/lease-handle.js");
  const handle = createLeaseHandle({
    lease: claim.lease,
    ownerId,
    ttlMs: 5 * 60_000,
  });
  try {
    await deps.injectWakeBanner(wake.sessionId, wake.reason, wake.dueAt);
    await deps.resumeMissionRun(run.id);
    return { kind: "resumed", runId: run.id };
  } finally {
    const { releaseLeaseAndEmitControlState } = await import(
      "../runtime/release-and-emit.js"
    );
    await releaseLeaseAndEmitControlState(handle, wake.sessionId, {
      missionRunId: run.id,
    });
  }
}

/**
 * Phase 4d auto-retry resume. The wake was scheduled for a `paused_error` run;
 * `claimRunForAutoRetry` re-verifies the ENTIRE safety state under a row lock
 * (status, unsafe stamp, stop_reason, attempt epoch, live full-mode permission,
 * snapshot opt-in) before flipping to running — so a human Recover that mutated
 * + stamped unsafe between claimDue and here makes this claim skip.
 */
async function handleAutoRetryClaimed(
  wake: LoopWakeRequest,
  run: MissionRun,
  deps: WakeDeps,
): Promise<ClaimedWakeOutcome> {
  if (run.status !== "paused_error") {
    logger.info("wake.executor.auto_retry_skip_stale", {
      wakeId: wake.id,
      runId: run.id,
      status: run.status,
    });
    return { kind: "skipped_stale_status", currentStatus: run.status };
  }

  const attempt =
    typeof wake.payload?.attempt === "number" ? wake.payload.attempt : -1;
  const ownerId = `auto-retry-${wake.id}`;
  const { claimRunForAutoRetry } = await import(
    "../runtime/lease-and-status.js"
  );
  const claim = await claimRunForAutoRetry({
    sessionId: wake.sessionId,
    missionRunId: run.id,
    expectedAttempt: attempt,
    ownerId,
    processKind: "electron_main",
    ttlMs: 5 * 60_000,
  });
  if (claim.outcome === "lease_busy") {
    logger.info("wake.executor.auto_retry_skip_lease_busy", {
      wakeId: wake.id,
      runId: run.id,
    });
    return { kind: "skipped_claim_lost" };
  }
  if (claim.outcome === "ineligible") {
    // A human Recover / terminal transition / opt-out / attempt drift won the
    // race; the consumed wake is dropped without resuming.
    logger.info("wake.executor.auto_retry_ineligible", {
      wakeId: wake.id,
      runId: run.id,
      reason: claim.reason,
    });
    return { kind: "skipped_claim_lost" };
  }

  const { createLeaseHandle } = await import("../runtime/lease-handle.js");
  const handle = createLeaseHandle({
    lease: claim.lease,
    ownerId,
    ttlMs: 5 * 60_000,
  });
  try {
    await deps.injectWakeBanner(wake.sessionId, wake.reason, wake.dueAt);
    await deps.resumeMissionRun(run.id);
    return { kind: "resumed", runId: run.id };
  } finally {
    const { releaseLeaseAndEmitControlState } = await import(
      "../runtime/release-and-emit.js"
    );
    await releaseLeaseAndEmitControlState(handle, wake.sessionId, {
      missionRunId: run.id,
    });
  }
}

// ── Scheduler ──────────────────────────────────────────────────────

export interface WakeExecutorHandle {
  /** Stop the executor. Resolves after the in-flight tick (if any) settles. */
  stop(): Promise<void>;
}

export interface StartOptions {
  intervalMs?: number;
  batchSize?: number;
  deps?: WakeDeps;
  now?: () => Date;
}

/**
 * Start the executor's polling loop. Defaults: interval 2000ms, batch 10.
 * Defaults are hardcoded — no env-driven override — so a stale
 * `AGENT_WAKE_ENABLED=false` from an older install cannot disable wake.
 * Pass `deps`/`now` in tests to inject fakes without touching the real DB.
 *
 * `stop()` drains any currently-running tick before resolving, so hosts can
 * await a clean shutdown.
 */
export function startWakeExecutor(options: StartOptions = {}): WakeExecutorHandle {
  const interval = options.intervalMs ?? 2000;
  const limit = options.batchSize ?? 10;
  const now = options.now ?? (() => new Date());
  const deps = options.deps ?? buildProductionDeps();

  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;

  const runOne = async (): Promise<void> => {
    try {
      await tick(now(), limit, deps);
    } catch (err) {
      logger.error("wake.executor.tick_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    inFlight = runOne().finally(() => {
      inFlight = null;
      if (!stopped) {
        timer = setTimeout(schedule, interval);
      }
    });
  };

  timer = setTimeout(schedule, interval);
  logger.info("wake.executor.started", { intervalMs: interval, batchSize: limit });

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          // Already logged inside runOne — swallow so shutdown doesn't throw.
        }
      }
      logger.info("wake.executor.stopped");
    },
  };
}

// ── Production dep wiring ──────────────────────────────────────────

// Production wiring lives inline (top-level imports) because this module is
// only reachable after the host has booted the DB + engine.
// Tests that just want `tick` call it directly with a handcrafted `WakeDeps`.

import * as loopWakeRepo from "@vex-agent/db/repos/loop-wake.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import { appendEngineMessage } from "@vex-agent/engine/events/index.js";

/**
 * Production provider/config gate. Wake resumes run the agent turn loop, which
 * needs the OpenRouter provider (OPENROUTER_API_KEY) and a model (AGENT_MODEL).
 * Mirrors the compact executor's pre-claim gate so a wake never consumes a row
 * it cannot service (e.g. before the vault injects the key at unlock).
 */
export function isWakeProviderConfigured(): boolean {
  return (
    Boolean(process.env.OPENROUTER_API_KEY) && Boolean(process.env.AGENT_MODEL)
  );
}

function buildProductionDeps(): WakeDeps {
  return {
    claimDue: (now, limit) => loopWakeRepo.claimDue(now, limit),
    getMissionRun: (runId) => missionRunsRepo.getRun(runId),
    casFlipToRunning: (runId, fromStatuses) =>
      missionRunsRepo.casFlipToRunning(runId, fromStatuses),
    injectWakeBanner: async (sessionId, reason, dueAt) => {
      await appendEngineMessage(
        sessionId,
        `[Engine: wake_due — ${reason ?? "no reason provided"} (scheduled: ${dueAt})]`,
        {
          source: "engine",
          messageType: "wake_due",
          visibility: "internal",
          payload: { reason: reason ?? null, dueAt },
        },
      );
    },
    resumeMissionRun: async (runId) => {
      // Lazy dynamic import so wake/executor.ts doesn't introduce a circular
      // dependency through the engine barrel. The ESM runtime caches the
      // promise after the first resolve, so there's no per-tick cost.
      // Blob TTL refresh is done inside `resumeMissionRun` itself
      // so every caller — wake executor, ingress preempt, approval resume —
      // gets it idempotently.
      const engine = await import("@vex-agent/engine/index.js");
      await engine.resumeMissionRun(runId);
    },
    isProviderReady: isWakeProviderConfigured,
  };
}
