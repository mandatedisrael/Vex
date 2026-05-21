/**
 * Post-batch handling for `waiting_for_wake` engine signal. Extracted
 * from `turn-loop.ts` for scaling.
 *
 * Ordering matters and is preserved bit-for-bit:
 *
 *   1. Read fresh session token count (best-effort).
 *   2. If the fresh band is `critical`, run forced-compact-before-wait.
 *      On committed compact, call `handlePostCompactBookkeeping`
 *      (caller-provided callback because it closes over the loop's
 *      mutable state). On noop, proceed with stale state — the next
 *      resume will see critical and re-evaluate.
 *   3. Flip `mission_runs` status to `paused_wake` with
 *      `waiting_for_wake` stop reason (mission run only).
 *
 * The mission run stays in `running` until the fallback finishes —
 * keeps a concurrent wake claim (status='paused_wake' lookup) or
 * user preempt from racing the compact rewrite of the transcript.
 */

import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import { maybeRunForcedCompactFallback } from "@vex-agent/engine/compact-jobs/forced-fallback.js";
import { computeBand } from "./context-band.js";

export async function applyWaitingForWakePostBatch(args: {
  readonly sessionId: string;
  readonly missionRunId: string | null;
  readonly currentTokenCount: number;
  readonly contextLimit: number;
  readonly handlePostCompactBookkeeping: () => Promise<void>;
}): Promise<void> {
  const freshSession = await sessionsRepo.getSession(args.sessionId);
  const tokenCountAtWait = freshSession?.tokenCount ?? args.currentTokenCount;
  if (computeBand(tokenCountAtWait, args.contextLimit) === "critical") {
    const fallback = await maybeRunForcedCompactFallback(args.sessionId);
    if (fallback.kind === "committed") {
      await args.handlePostCompactBookkeeping();
    }
  }
  if (args.missionRunId !== null) {
    await missionRunsRepo.updateStatus(
      args.missionRunId,
      "paused_wake",
      "waiting_for_wake",
    );
  }
}
