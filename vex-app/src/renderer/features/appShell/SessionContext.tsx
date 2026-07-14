/**
 * Selected-session register line (S3 — the desk rule).
 *
 * One slim hairline-ruled line above the transcript: session title plus the
 * EXCEPTION stamp only (silence-by-default — `restricted` permission deviates
 * from the defaults; agent/full earn no chrome). Mission identity moved to the
 * MISSION RAIL's Mission badge, so the old `mission` mode stamp was removed.
 * Loading/error/not-found states are boxless lines on the same rule height.
 *
 * Stage 4: the runtime bar (model/usage/context/compaction) moved OUT of this
 * header — it now lives solely in the BOOK panel's RUNTIME & COST block, so the
 * desk rule stays a single quiet title line.
 */

import type { JSX, ReactNode } from "react";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { DotmHex3 } from "../../components/ui/dotm-hex-3.js";
import { Stamp } from "./SessionRows/Stamp.js";
import { getSessionTitle } from "./sessionListModel.js";

export interface SessionContextProps {
  readonly activeSession: SessionListItem | null;
  readonly activeSessionId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  /**
   * Optional content-agnostic slot rendered at the trailing (right) edge of the
   * active-session title row. Content-agnostic on purpose: the header stays
   * unaware of what it hosts, so a caller can attach context (e.g. the mission
   * badge cluster in the Hypervexing dock) without this shared component gaining
   * a second reason to change. Absent by default → the shell row is unchanged.
   */
  readonly trailing?: ReactNode;
}

export function SessionContext({
  activeSession,
  activeSessionId,
  loading,
  error,
  trailing,
}: SessionContextProps): JSX.Element | null {
  if (loading) {
    return (
      <div className="flex h-9 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--vex-text-3)]">
        <DotmHex3
          size={14}
          dotSize={2}
          color="var(--vex-accent)"
          ariaLabel="Loading session"
        />
        Loading session
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex h-9 items-center text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (activeSessionId !== null && activeSession === null) {
    return (
      <div className="flex h-9 items-center text-sm text-[var(--vex-text-2)]">
        Session not found
      </div>
    );
  }

  if (activeSession !== null) {
    const title = getSessionTitle(activeSession);
    return (
      <div
        data-vex-area="session-header"
        role="group"
        aria-label={`Session: ${title}`}
        className="flex h-9 items-center gap-3 border-b border-[var(--vex-line)]"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {title}
        </span>
        {activeSession.permission !== "full" ? (
          <Stamp tone="warn">restricted</Stamp>
        ) : null}
        {/* Mission identity now reads from the MISSION RAIL's Mission badge —
            the small header "mission" stamp was removed to avoid double-
            signalling. The `restricted` exception stamp stays. */}
        {/* Trailing slot — right-edge context host (see prop doc). The title
            keeps `flex-1 min-w-0 truncate` so it yields space to the slot and
            still truncates; a slot whose content renders null adds no box, so
            the row reserves no ghost space when empty. */}
        {trailing}
      </div>
    );
  }

  // Unreachable by contract: SessionPanel mounts this header only when a
  // session id is selected (the null-id welcome stage early-returns before
  // rendering it), so activeSessionId === null never lands here.
  return null;
}
