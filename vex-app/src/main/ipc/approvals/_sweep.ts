/**
 * Approvals IPC — scheduled TTL sweep helper.
 *
 * Engine-side `sweepExpiredApprovals` returns prepared continuations; main
 * dispatches them via the shared `_engine-dispatch.ts` background helper.
 * Engine does NOT import main IPC helpers (Codex puzzle-5 phase-3 review
 * point 5) — the cross-boundary contract is "engine returns work, main
 * does work."
 */

import { randomUUID } from "node:crypto";

import { log } from "../../logger/index.js";
import { dispatchPreparedMission } from "../mission/_engine-dispatch.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";

export async function runScheduledSweep(): Promise<void> {
  const correlationId = `sweep-${randomUUID()}`;
  const dbUrlOutcome = await ensureEngineDbUrl(correlationId);
  if (!dbUrlOutcome.ok) {
    log.info(
      `[approvals.sweep] waiting: database url unavailable (will retry next sweep) ` +
        `correlationId=${correlationId}`,
    );
    return;
  }

  try {
    const { sweepExpiredApprovals, runResumeAfterDecision } = await import(
      "@vex-agent/engine/core/approval-runtime.js"
    );
    const result = await sweepExpiredApprovals(new Date());
    for (const cont of result.continuations) {
      dispatchPreparedMission(() => runResumeAfterDecision(cont), {
        sessionId: cont.sessionId,
        missionRunId: cont.missionRunId,
        correlationId,
        channelLabel: "vex:approvals:sweep",
      });
    }
    log.info(
      `[approvals.sweep] correlationId=${correlationId} swept=${result.swept} ` +
        `errored=${result.errored} continuations=${result.continuations.length}`,
    );
  } catch (cause) {
    log.warn(
      `[approvals.sweep] failed correlationId=${correlationId}`,
      cause,
    );
  }
}
