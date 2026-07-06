/**
 * Main app shell — THE SIGNAL DESK (the landing's design language, opened
 * for business).
 *
 * Onboarding proved identity in a dark room (one light, one signature);
 * the shell is the working register that signature unlocked. Same ink
 * canvas (#0a0d18 via --vex-surface-0), zero photography, zero resting
 * glow: depth comes from the three solid luminance steps defined by the
 * [data-vex-shell] scope in globals.css, separated by hairlines. The one
 * sanctioned gradient is the selection beam (.vex-select-beam).
 *
 * Phase 5 (Signal Sky): the room's back wall is the landing's procedural
 * WebGL dither sky (SignalSky, z-0 — no imagery), running FULL on the
 * welcome/idle stage and DIMMED behind an active session transcript. The
 * columns float above it: the center section carries `relative z-10`; the
 * two side rails (SessionsList / BookPanel) are guard-whitelisted soft ink
 * (--vex-rail over a blurred backdrop, edge-fading seams instead of border
 * walls) so the sky reads through them and the shell stays ONE canvas.
 *
 * Layout: sidebar rail (SessionsList) | content column under the DESK RULE
 * | optional on-demand BOOK panel (right <aside>, gated on bookOpen). The
 * DESK RULE (h-12 header) is a 3-zone grid: the live tape-state word (left),
 * the MISSION/PLAN badge cluster (`MissionRail`, center — session view only),
 * and an empty right flank (the BOOK toggle + version stamp both live in
 * BookPanel's collapse header — single-toggle owner review). Its
 * bottom-hairline accent tick sits over the left-anchored transcript spine.
 *
 * `data-vex-shell="true"` scopes the Protocol Desk tokens (sibling of
 * data-vex-onboarding); `data-vex-screen="appShell"` stays the e2e/test
 * selector. The window keeps its native OS frame, so no -webkit-app-region
 * drag strip is mounted (S0 decision — revisit only if the frame goes
 * custom).
 */

import type { JSX } from "react";
import { useUiStore } from "../../stores/uiStore.js";
import { BookPanel } from "./BookPanel.js";
import { DeskRuleTapeState } from "./DeskRuleTapeState.js";
import { MissionRail } from "./MissionRail.js";
import { useAutoCollapseBook } from "./useAutoCollapseBook.js";
import { SessionCreator } from "./SessionCreator.js";
import { SessionPanel } from "./SessionPanel.js";
import { SessionsLibrary } from "./SessionsLibrary.js";
import { SessionsList } from "./SessionsList.js";
import { MemoryPanel } from "./MemoryPanel.js";
import { SignalSky } from "./SignalSky.js";

/** Sky strength behind an active session transcript — dimmed so the tape
 * stays the protagonist; the welcome/idle stage runs the sky at full 1. */
const SKY_DIM_INTENSITY = 0.35;

export function AppShell(): JSX.Element {
  const appShellView = useUiStore((s) => s.appShellView);
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const theme = useUiStore((s) => s.theme);
  const bookOpen = useUiStore((s) => s.bookOpen);
  const toggleBook = useUiStore((s) => s.toggleBook);
  const createSessionOpen = useUiStore((s) => s.createSessionOpen);
  const openCreateSession = useUiStore((s) => s.openCreateSession);
  const closeCreateSession = useUiStore((s) => s.closeCreateSession);

  // Stage F responsive: below ~1360px the three columns (sidebar + chat +
  // BOOK) no longer fit, so auto-collapse BOOK on the narrowing edge. One-way on
  // the transition (not continuously enforced) so a user can still re-open BOOK
  // inside a narrow window — we don't fight a manual toggle.
  useAutoCollapseBook();

  // Sky intensity is derived from state AppShell already subscribes to —
  // full on welcome/idle (no active session, or a non-session sub-view),
  // dimmed behind an active session transcript. The uniform itself eases
  // inside SignalSky, so this can flip freely.
  const skyIntensity =
    activeSessionId === null || appShellView !== "session"
      ? 1
      : SKY_DIM_INTENSITY;

  return (
    // `relative isolate`: anchors the absolutely-positioned Signal Sky and
    // traps the shell's z-layering in one stacking context.
    <main
      className="relative isolate flex h-screen w-screen overflow-hidden bg-[var(--vex-surface-0)] text-foreground"
      data-vex-shell="true"
      data-vex-theme={theme}
      data-vex-screen="appShell"
    >
      <SignalSky intensity={skyIntensity} theme={theme} />
      <SessionsList onCreate={() => openCreateSession()} />

      <section className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* DESK RULE — the working header datum and the head of the tape. The
         * full-width bottom hairline was removed so the header and main content
         * read as one seamless surface (owner review); only the short accent
         * tick that heads the left-anchored transcript spine remains. Three
         * zones on a 1fr/auto/1fr grid (equal flanks keep the center truly
         * centered): live tape state (left), MISSION/PLAN badge cluster
         * (center), and an intentionally-empty right flank (the BOOK toggle
         * lives ONLY in BookPanel's collapse header since the single-toggle
         * owner review — the empty cell keeps the center truly centered). The
         * rule itself never moves; only the tape-state word and the cluster's
         * badge states change. */}
        <header className="relative grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-6">
          <span
            aria-hidden
            className="absolute -bottom-px left-6 h-px w-6 bg-[var(--vex-accent)]"
          />
          <div className="flex min-w-0 items-center justify-start">
            <DeskRuleTapeState />
          </div>
          {/* Center cell is a stable grid child so the BOOK toggle stays in
           * column 3 even when the cluster gates itself away (MissionRail
           * renders nothing for a plain agent session with plan-mode off). */}
          <div className="flex min-w-0 items-center justify-center">
            {appShellView === "session" ? (
              <MissionRail activeSessionId={activeSessionId} />
            ) : null}
          </div>
          <div aria-hidden className="flex items-center justify-end gap-3" />
        </header>

        <div className="min-h-0 flex-1">
          {appShellView === "sessionsLibrary" ? (
            <SessionsLibrary />
          ) : appShellView === "memory" ? (
            <MemoryPanel />
          ) : (
            <SessionPanel />
          )}
        </div>
      </section>

      {appShellView === "session" ? (
        // Always mounted in session view — the panel owns its collapsed state
        // (a thin spine + version stamp) so toggling never remounts it or
        // replays the slide-in keyframe.
        <BookPanel
          activeSessionId={activeSessionId}
          bookOpen={bookOpen}
          onToggle={toggleBook}
        />
      ) : null}

      <SessionCreator
        open={createSessionOpen}
        onOpenChange={(next) => {
          if (!next) closeCreateSession();
        }}
      />
    </main>
  );
}
