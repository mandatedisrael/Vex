/**
 * SessionPlanCard — session-scoped plan display (the agent-authored "HOW").
 *
 * Shown for BOTH agent and mission sessions (plan-mode is session-scoped). The
 * engine is the authority: this card is UX only. The on/off control lives in
 * the composer's PLAN switch (S2) — this card only displays:
 *   - the plan-mode description line (when enabled),
 *   - the active plan markdown (when present),
 *   - an "Accept plan" action when a plan is pending acceptance (the gate that
 *     unblocks execution / resumes a paused mission run),
 *   - a "Resume mission" recovery action.
 *
 * Invalidate-based hooks (no optimistic write): a server refusal snaps back.
 * The card itself never mutates plan mode (S2 moved toggling to the composer),
 * so the old blocked-pending-acceptance hint was unreachable and was removed.
 */

import type { JSX } from "react";
import { MarkdownContent } from "../../lib/markdown/MarkdownContent.js";
import { useSessionPlan, useAcceptPlan } from "../../lib/api/sessions.js";
import { useRequestResume } from "../../lib/api/runtime.js";
import { Stamp } from "./SessionRows/Stamp.js";

/** Accent-hairline action key (Accept/Resume) — quiet until hovered. */
const ACTION_KEY =
  "rounded-md border border-[var(--vex-accent-border)] px-3 py-1.5 text-xs font-medium text-[var(--vex-accent-text)] transition-colors hover:bg-[var(--vex-accent-fill-8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] disabled:cursor-not-allowed disabled:opacity-50";

export function SessionPlanCard({
  sessionId,
  missionStatus,
}: {
  sessionId: string;
  /** Active mission-run status (from the session detail), or null. */
  missionStatus?: string | null;
}): JSX.Element | null {
  const planQuery = useSessionPlan(sessionId);
  const acceptPlan = useAcceptPlan();
  const requestResume = useRequestResume();

  const plan = planQuery.data?.ok ? planQuery.data.data : null;
  const enabled = plan?.enabled ?? false;
  const hasPlan = enabled && (plan?.planMd?.length ?? 0) > 0;
  const pending = hasPlan && plan?.accepted === false;
  // Accepted but the mission run is still parked for acceptance — the accept's
  // resume did not launch. Recoverable: the accepted plan makes a plain resume
  // valid (the server gate allows an accepted paused run).
  const awaitingResume =
    hasPlan && plan?.accepted === true && missionStatus === "paused_plan_acceptance";

  const acceptBusy = acceptPlan.isPending;
  const resumeBusy = requestResume.isPending;

  return (
    <section className="mb-3 rounded-lg border border-[var(--vex-line-strong)] bg-[var(--vex-surface-1)] px-4 py-3 text-sm">
      <header className="flex items-center gap-2">
        <span className="font-medium text-foreground">Plan mode</span>
        <Stamp tone="accent">recommended</Stamp>
      </header>

      {enabled ? (
        <p className="mt-1 text-xs text-[var(--vex-text-2)]">
          The agent researches first, writes an action plan (the “HOW”), and waits for
          your acceptance before executing.
        </p>
      ) : null}

      {hasPlan ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-2)]">
              Action plan
            </span>
            <span
              className={
                pending
                  ? "text-[11px] font-medium text-warning"
                  : "text-[11px] font-medium text-success"
              }
            >
              {pending ? "Pending your acceptance" : "Accepted"}
            </span>
          </div>
          {/* Recessed well — the plan reads like a filed document. */}
          <div className="max-h-72 overflow-auto rounded-[6px] border border-[var(--vex-line)] bg-[var(--vex-surface-down)] px-3 py-2">
            <MarkdownContent text={plan?.planMd ?? ""} />
          </div>
          {pending ? (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                disabled={acceptBusy}
                onClick={() =>
                  acceptPlan.mutate({ sessionId, expectedPlanMd: plan?.planMd ?? "" })
                }
                className={ACTION_KEY}
              >
                {acceptBusy ? "Accepting…" : "Accept plan"}
              </button>
            </div>
          ) : null}
          {awaitingResume ? (
            <div className="mt-2 flex items-center justify-end gap-2">
              <span className="text-[11px] text-warning">Accepted, but the run didn’t resume.</span>
              <button
                type="button"
                disabled={resumeBusy}
                onClick={() => requestResume.mutate({ sessionId })}
                className={ACTION_KEY}
              >
                {resumeBusy ? "Resuming…" : "Resume mission"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
