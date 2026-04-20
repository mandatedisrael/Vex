/**
 * Wake executor — single-process scheduler that drives `loop_defer` wakes.
 *
 * Contract (documented in ADR 001):
 *   - Exactly ONE process runs the executor per deployment. Race safety
 *     across ticks is provided by `loopWakeRepo.claimDue` (FOR UPDATE SKIP
 *     LOCKED), but mission-run-level status transitions are NOT serialized
 *     between processes. Scale-out would need an extra run-level claim.
 *   - The executor is started exclusively from the MCP binary
 *     (`src/mcp/index.ts`) after the transport bind. It is NOT started by
 *     `runBootstrapChecks` because the same function is used by CLI readiness
 *     checks (`src/cli/echo/system.ts`) — starting there would create a
 *     second executor on every CLI invocation.
 *
 * Tick semantics:
 *   1. `claimDue(now, batchSize)` — atomically flips the pending rows to
 *      `consumed` and returns them. Rows the executor cannot handle (e.g.
 *      session status drifted to `running` because a user preempted) are
 *      SKIPPED but NOT unclaimed — the row is terminal once consumed, and
 *      the race is accepted (the user already resumed the session, so no
 *      banner needs to be injected).
 *   2. For every claimed row, the executor re-checks the target state and
 *      either (a) injects a `wake_due` banner + triggers the resume path or
 *      (b) logs the drift and skips. Every outcome is reported on the
 *      returned `ClaimedWake` so tests and operators can see the result.
 */

import type { LoopWakeRequest } from "@echo-agent/db/repos/loop-wake.js";
import type { MissionRun } from "@echo-agent/db/repos/mission-runs.js";
import logger from "@utils/logger.js";

// ── Types ──────────────────────────────────────────────────────────

export type ClaimedWakeOutcome =
  | { kind: "resumed"; runId: string | null }
  | { kind: "skipped_stale_status"; currentStatus: string }
  | { kind: "skipped_mission_run_missing" }
  | { kind: "skipped_session_kind_mismatch"; currentKind: string }
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
  /** Flip a run's status (used to exit `paused_wake` before resume). */
  updateMissionRunStatus(runId: string, status: string): Promise<void>;
  /** Return the `kind` column of a session, or `null` when missing. */
  getSessionKind(sessionId: string): Promise<string | null>;
  /** Persist a `wake_due` banner for the resume path to pick up. */
  injectWakeBanner(sessionId: string, reason: string | null, dueAt: string): Promise<void>;
  /** Resume a mission run. */
  resumeMissionRun(runId: string): Promise<void>;
  /** Resume a full_autonomous session (real runner lands in PR-10). */
  resumeFullAutonomousSession(sessionId: string): Promise<void>;
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
        kind: wake.kind,
        error: message,
      });
      results.push({ wake, outcome: { kind: "error", message } });
    }
  }

  return results;
}

async function handleClaimed(
  wake: LoopWakeRequest,
  deps: WakeDeps,
): Promise<ClaimedWakeOutcome> {
  if (wake.kind === "mission_run") {
    if (!wake.missionRunId) {
      return { kind: "skipped_mission_run_missing" };
    }
    const run = await deps.getMissionRun(wake.missionRunId);
    if (!run) {
      return { kind: "skipped_mission_run_missing" };
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

    await deps.injectWakeBanner(wake.sessionId, wake.reason, wake.dueAt);
    await deps.updateMissionRunStatus(run.id, "running");
    await deps.resumeMissionRun(run.id);
    return { kind: "resumed", runId: run.id };
  }

  // full_autonomous
  const sessionKind = await deps.getSessionKind(wake.sessionId);
  if (sessionKind !== "full_autonomous") {
    logger.info("wake.executor.skip_kind_drift", {
      wakeId: wake.id,
      sessionId: wake.sessionId,
      expected: "full_autonomous",
      actual: sessionKind,
    });
    return { kind: "skipped_session_kind_mismatch", currentKind: sessionKind ?? "<missing>" };
  }

  await deps.injectWakeBanner(wake.sessionId, wake.reason, wake.dueAt);
  await deps.resumeFullAutonomousSession(wake.sessionId);
  return { kind: "resumed", runId: null };
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
 * Start the executor's polling loop. The default interval (2s) + batch size
 * (10) matches the contract documented in ADR 001. Pass `deps`/`now` in
 * tests to inject fakes without touching the real DB.
 *
 * `stop()` drains any currently-running tick before resolving, so callers
 * (e.g. MCP SIGTERM handler) can await a clean shutdown.
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
// only reachable from `src/mcp/index.ts`, which already boots the DB + engine.
// Tests that just want `tick` call it directly with a handcrafted `WakeDeps`.

import * as loopWakeRepo from "@echo-agent/db/repos/loop-wake.js";
import * as missionRunsRepo from "@echo-agent/db/repos/mission-runs.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import * as messagesRepo from "@echo-agent/db/repos/messages.js";

function buildProductionDeps(): WakeDeps {
  return {
    claimDue: (now, limit) => loopWakeRepo.claimDue(now, limit),
    getMissionRun: (runId) => missionRunsRepo.getRun(runId),
    updateMissionRunStatus: (runId, status) => missionRunsRepo.updateStatus(runId, status),
    getSessionKind: async (sessionId) => {
      const session = await sessionsRepo.getSession(sessionId);
      if (!session) return null;
      // Until PR-10's migration adds the `sessions.kind` column, `mapRow`
      // resolves every row to `"chat"` — the executor correctly skips any
      // full_autonomous wake that slips in during that window.
      return session.kind;
    },
    injectWakeBanner: async (sessionId, reason, dueAt) => {
      await messagesRepo.addEngineMessage(
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
      const engine = await import("@echo-agent/engine/index.js");
      await engine.resumeMissionRun(runId);
    },
    resumeFullAutonomousSession: async (_sessionId) => {
      // PR-10 lands the real runner; until then the executor refuses to
      // spin the model for full_autonomous wakes so we don't start an
      // engine loop without a matching entry point.
      throw new Error(
        "wake.executor: full_autonomous resume is unavailable until PR-10",
      );
    },
  };
}
