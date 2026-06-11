/**
 * Welcome / session panel — orchestration only.
 *
 * Two layouts, branched on whether a session is active:
 *   - no active session → centered welcome hero + composer (onboarding feel);
 *   - active session → full-height chat shell: header (`SessionContext`) +
 *     optional mission contract card + live transcript (`SessionTranscript`,
 *     stage 8-1) + bottom composer. The hero is hidden so a selected session's
 *     loading/error/empty states never sit under onboarding copy.
 *
 * Sub-components keep this file small:
 *   - hero (register head; trust line lives in the composer) → `SessionWelcomeHero`
 *   - context strip/header → `SessionContext` (+ `SessionRuntimeBar`)
 *   - mission card        → `MissionContractCard` (mission sessions only)
 *   - transcript          → `SessionTranscript`
 *   - composer + slash    → `SessionComposer`
 */

import { useMemo } from "react";
import type { JSX } from "react";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { useTranscriptLiveSync } from "../../lib/api/messages.js";
import { useControlStateLiveSync } from "../../lib/api/runtime.js";
import { useStreamPreviewSync } from "../../lib/api/streams.js";
import { useUsageLiveSync } from "../../lib/api/usage.js";
import { useSession } from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";
import { ApprovalsRegion } from "./ApprovalsRegion.js";
import { MissionContractCard } from "./MissionContractCard.js";
import { MissionControls } from "./MissionControls.js";
import { SessionPlanCard } from "./SessionPlanCard.js";
import { SessionComposer } from "./SessionComposer.js";
import { SessionContext } from "./SessionContext.js";
import { SessionTranscript } from "./SessionTranscript.js";
import { SessionWelcomeHero } from "./SessionWelcomeHero.js";

export function SessionPanel(): JSX.Element {
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  // Puzzle 02/06: keep the active session's transcript + usage queries fresh
  // (transcript-append event + 30s fallback poll). Puzzle 09: drive the
  // ephemeral streaming preview from the engine stream spine. F5: push
  // runtime-state + pending-approval refresh from the control-state event.
  // Pure side effects.
  useTranscriptLiveSync(activeSessionId);
  useUsageLiveSync(activeSessionId);
  useStreamPreviewSync(activeSessionId);
  useControlStateLiveSync(activeSessionId);
  const detailQuery = useSession(activeSessionId);

  const activeSession = useMemo((): SessionListItem | null => {
    if (activeSessionId === null) return null;
    if (!detailQuery.data?.ok) return null;
    return detailQuery.data.data;
  }, [activeSessionId, detailQuery.data]);

  const detailError =
    detailQuery.data && detailQuery.data.ok === false
      ? detailQuery.data.error.message
      : null;
  const panelState = resolvePanelState(
    activeSessionId,
    activeSession,
    detailQuery,
  );

  // No active session → centered onboarding hero + composer.
  if (activeSessionId === null) {
    return (
      <div
        data-vex-area="session-panel"
        data-vex-state={panelState}
        className="flex h-full min-h-0 w-full items-center px-8 py-10 sm:px-12 lg:px-20"
      >
        <div className="w-full max-w-[680px]">
          <SessionWelcomeHero />
          <SessionContext
            activeSession={null}
            activeSessionId={null}
            loading={false}
            error={null}
          />
          <SessionComposer activeSession={null} activeSessionId={null} />
        </div>
      </div>
    );
  }

  // Active session → full-height chat shell (header + mission + transcript +
  // composer). Loading/error/not-found are surfaced by `SessionContext`, never
  // the hero; the transcript renders once the session row resolves.
  const showMissionCard =
    activeSession !== null && activeSession.mode === "mission";
  return (
    <div
      data-vex-area="session-panel"
      data-vex-state={panelState}
      className="flex h-full min-h-0 w-full justify-center"
    >
      <div className="flex h-full min-h-0 w-full max-w-[860px] flex-col px-6 py-4">
        <SessionContext
          activeSession={activeSession}
          activeSessionId={activeSessionId}
          loading={detailQuery.isLoading}
          error={detailError}
        />
        {showMissionCard && activeSession !== null ? (
          <MissionContractCard
            sessionId={activeSession.id}
            permission={activeSession.permission}
          />
        ) : null}
        {activeSession !== null ? (
          <SessionPlanCard
            sessionId={activeSession.id}
            missionStatus={activeSession.missionStatus}
          />
        ) : null}
        {activeSession !== null ? (
          <SessionTranscript sessionId={activeSession.id} />
        ) : null}
        {activeSession !== null ? (
          <ApprovalsRegion sessionId={activeSession.id} />
        ) : null}
        {showMissionCard && activeSession !== null ? (
          <MissionControls sessionId={activeSession.id} />
        ) : null}
        <SessionComposer activeSession={activeSession} activeSessionId={activeSessionId} />
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
