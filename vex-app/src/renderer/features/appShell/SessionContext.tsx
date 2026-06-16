/**
 * Selected-session register line (S3 — the desk rule).
 *
 * One slim hairline-ruled line above the transcript: session title plus
 * EXCEPTION stamps only (silence-by-default — `restricted` permission and
 * `mission` mode deviate from the defaults; agent/full earn no chrome).
 * Loading/error/not-found states are boxless lines on the same rule height.
 *
 * Stage 4: the runtime bar (model/usage/context/compaction) moved OUT of this
 * header — it now lives solely in the BOOK panel's RUNTIME & COST block, so the
 * desk rule stays a single quiet title line.
 */

import type { JSX } from "react";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { DotmHex3 } from "../../components/ui/dotm-hex-3.js";
import { Stamp } from "./SessionRows/Stamp.js";
import { getSessionTitle } from "./sessionListModel.js";

export interface SessionContextProps {
  readonly activeSession: SessionListItem | null;
  readonly activeSessionId: string | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export function SessionContext({
  activeSession,
  activeSessionId,
  loading,
  error,
}: SessionContextProps): JSX.Element {
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
        {activeSession.mode === "mission" ? (
          <Stamp tone="accent">mission</Stamp>
        ) : null}
      </div>
    );
  }

  // Sessions-list sidebar owns the "New session" CTA. The welcome
  // panel keeps the layout spacer so the chat input position is
  // identical in the empty-state and the has-sessions empty-active state.
  return <div className="mt-7 h-0" aria-hidden />;
}
