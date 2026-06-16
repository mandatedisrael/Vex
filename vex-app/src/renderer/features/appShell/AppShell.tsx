/**
 * Main app shell — THE PROTOCOL DESK (Countersign, opened for business).
 *
 * Onboarding proved identity in a dark room (one light, one signature);
 * the shell is the working register that signature unlocked. Same canvas
 * (#04060f via --vex-surface-0), zero photography, zero gradients, zero
 * resting glow: depth comes from the three solid luminance steps defined
 * by the [data-vex-shell] scope in globals.css, separated by hairlines.
 *
 * Layout: sidebar rail (SessionsList) | content column under the DESK
 * RULE — an h-12 header datum whose bottom hairline carries the onboarding
 * plinth language (24px accent tick at the content column's left edge).
 * Runtime status now lives in the sidebar registry footer (RuntimeLedger,
 * S1); the rule carries only the version stamp on its right side.
 *
 * `data-vex-shell="true"` scopes the Protocol Desk tokens (sibling of
 * data-vex-onboarding); `data-vex-screen="appShell"` stays the e2e/test
 * selector. The window keeps its native OS frame, so no -webkit-app-region
 * drag strip is mounted (S0 decision — revisit only if the frame goes
 * custom).
 */

import type { JSX } from "react";
import { useUiStore } from "../../stores/uiStore.js";
import { DeskRuleTapeState } from "./DeskRuleTapeState.js";
import { SessionCreator } from "./SessionCreator.js";
import { SessionPanel } from "./SessionPanel.js";
import { SessionsLibrary } from "./SessionsLibrary.js";
import { SessionsList } from "./SessionsList.js";
import { MemoryPanel } from "./MemoryPanel.js";

export function AppShell(): JSX.Element {
  const appShellView = useUiStore((s) => s.appShellView);
  const createSessionOpen = useUiStore((s) => s.createSessionOpen);
  const openCreateSession = useUiStore((s) => s.openCreateSession);
  const closeCreateSession = useUiStore((s) => s.closeCreateSession);

  return (
    <main
      className="flex h-screen w-screen overflow-hidden bg-[var(--vex-surface-0)] text-foreground"
      data-vex-shell="true"
      data-vex-screen="appShell"
    >
      <SessionsList onCreate={() => openCreateSession()} />

      <section className="flex min-w-0 flex-1 flex-col">
        {/* DESK RULE — the working header datum and the head of the tape: its
         * accent tick sits over the left-anchored spine, with the live tape
         * state on the left and the version stamp pinned right. The rule itself
         * never moves; only the tape-state word changes. */}
        <header className="relative flex h-12 shrink-0 items-center gap-3 border-b border-[var(--vex-line)] px-6">
          <span
            aria-hidden
            className="absolute -bottom-px left-6 h-px w-6 bg-[var(--vex-accent)]"
          />
          <DeskRuleTapeState />
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--vex-text-3)]">
            v{__VEX_APP_VERSION__}
          </span>
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

      <SessionCreator
        open={createSessionOpen}
        onOpenChange={(next) => {
          if (!next) closeCreateSession();
        }}
      />
    </main>
  );
}
