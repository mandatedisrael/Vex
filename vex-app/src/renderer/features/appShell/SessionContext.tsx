/**
 * Selected-session context strip (puzzle 04 phase 7 extract).
 *
 * Lifted from `SessionPanel.tsx` to keep the parent file under the
 * 350-LOC budget. Shows the active session's title + mode/permission/
 * missionStatus chips, plus a loading skeleton and a "Session not
 * found" empty state.
 */

import type { JSX } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { AiChat01Icon, Target02Icon } from "@hugeicons/core-free-icons";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { DotmHex3 } from "../../components/ui/dotm-hex-3.js";
import { SessionRuntimeBar } from "./SessionRuntimeBar.js";
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
      <div className="mt-7 inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs text-[var(--color-text-secondary)] backdrop-blur-xl">
        <DotmHex3
          size={18}
          dotSize={3}
          color="#6f91ff"
          ariaLabel="Loading session"
        />
        Loading session
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="mt-7 rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive backdrop-blur-xl">
        {error}
      </div>
    );
  }

  if (activeSessionId !== null && activeSession === null) {
    return (
      <div className="mt-7 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-sm text-[var(--color-text-secondary)] backdrop-blur-xl">
        Session not found
      </div>
    );
  }

  if (activeSession !== null) {
    const icon: IconSvgElement =
      activeSession.mode === "mission" ? Target02Icon : AiChat01Icon;
    const title = getSessionTitle(activeSession);
    return (
      <div className="mt-7 flex flex-col gap-2">
        <div
          data-vex-area="session-header"
          role="group"
          aria-label={`Session: ${title}`}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs text-[var(--color-text-secondary)] backdrop-blur-xl"
        >
          <span className="flex h-8 w-8 items-center justify-center text-[#8da5ff]">
            <HugeiconsIcon icon={icon} size={16} aria-hidden />
          </span>
          <span className="min-w-[180px] flex-1 truncate text-sm text-foreground">
            {title}
          </span>
          <ContextPill>{activeSession.mode}</ContextPill>
          <ContextPill>{activeSession.permission}</ContextPill>
          {activeSession.missionStatus !== null ? (
            <ContextPill>{activeSession.missionStatus}</ContextPill>
          ) : null}
        </div>
        <SessionRuntimeBar sessionId={activeSession.id} />
      </div>
    );
  }

  // Sessions-list sidebar owns the "New session" CTA. The welcome
  // panel keeps the layout spacer so the chat input position is
  // identical in the empty-state and the has-sessions empty-active state.
  return <div className="mt-7 h-0" aria-hidden />;
}

function ContextPill({ children }: { readonly children: string }): JSX.Element {
  return (
    <span className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
      {children}
    </span>
  );
}
