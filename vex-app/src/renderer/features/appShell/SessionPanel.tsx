/**
 * Welcome / session panel — orchestration only.
 *
 * Phase 7 split:
 *   - hero + trust badges → `SessionWelcomeHero`
 *   - context strip       → `SessionContext`
 *   - mission card        → `MissionContractCard` (renders only when
 *     `session.mode === "mission"` and a draft exists)
 *   - composer + slash    → `SessionComposer`
 *
 * Keeps the file small enough that adding a new orchestration concern
 * (a banner, a status header, a sidebar peek) doesn't push the parent
 * over the 350-LOC budget.
 */

import { useMemo } from "react";
import type { JSX } from "react";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { useTranscriptLiveSync } from "../../lib/api/messages.js";
import { useUsageLiveSync } from "../../lib/api/usage.js";
import { useSession } from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";
import { MissionContractCard } from "./MissionContractCard.js";
import { SessionComposer } from "./SessionComposer.js";
import { SessionContext } from "./SessionContext.js";
import { SessionWelcomeHero } from "./SessionWelcomeHero.js";

export function SessionPanel(): JSX.Element {
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  // Agent integration puzzle 2: subscribe the active session to the
  // engine transcript event spine + 30s fallback poll. Pure side
  // effect — no UI surface here. Visible transcript UI lands in
  // puzzle 08 (chat panel).
  useTranscriptLiveSync(activeSessionId);
  // Puzzle 06: keep the runtime bar's usage + context-window queries
  // fresh after each turn (transcript-append event + 30s fallback poll).
  useUsageLiveSync(activeSessionId);
  const detailQuery = useSession(activeSessionId);

  const activeSession = useMemo((): SessionListItem | null => {
    if (activeSessionId === null) return null;
    if (!detailQuery.data?.ok) return null;
    return detailQuery.data.data;
  }, [activeSessionId, detailQuery.data]);

  const showMissionCard =
    activeSession !== null && activeSession.mode === "mission";

  return (
    <div
      data-vex-area="session-panel"
      data-vex-state={resolvePanelState(activeSessionId, activeSession, detailQuery)}
      className="flex h-full min-h-0 w-full items-center px-8 py-10 sm:px-12 lg:px-20"
    >
      <div className="w-full max-w-[780px]">
        <SessionWelcomeHero />

        <SessionContext
          activeSession={activeSession}
          activeSessionId={activeSessionId}
          loading={activeSessionId !== null && detailQuery.isLoading}
          error={
            detailQuery.data && detailQuery.data.ok === false
              ? detailQuery.data.error.message
              : null
          }
        />

        {showMissionCard && activeSession !== null ? (
          <MissionContractCard sessionId={activeSession.id} />
        ) : null}

        <SessionComposer activeSession={activeSession} />
      </div>
    </div>
  );
}

function resolvePanelState(
  activeSessionId: string | null,
  activeSession: SessionListItem | null,
  detailQuery: ReturnType<typeof useSession>,
): "no-session" | "selected" | "loading" | "error" {
  if (activeSessionId === null) return "no-session";
  if (detailQuery.isLoading) return "loading";
  if (detailQuery.data && detailQuery.data.ok === false) return "error";
  if (activeSession !== null) return "selected";
  return "error";
}
