/**
 * Zustand UI-only store per skill §5.
 *
 * Layer rules:
 *  - Domain/IPC data lives in TanStack Query, NEVER here.
 *  - Persist whitelist is intentionally narrow (sidebarOpen). currentView
 *    is recomputed on launch; logBuffer is in-memory only.
 *  - logBuffer is bounded to MAX_RENDER_LOGS to honor skill §11 (no
 *    unbounded buffers).
 *
 * Theme is intentionally NOT in M1 — applying it requires DOM root sync
 * + prefers-color-scheme listener + Settings UI to mutate it. Phase 2
 * adds it properly. Storing dead state today only invites drift.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const MAX_RENDER_LOGS = 500;

export type View =
  | "splash"
  | "systemCheck"
  | "dockerBootstrap"
  | "composeBootstrap"
  | "migrations"
  | "wizard"
  | "unlock"
  | "appShell";

export type WizardEntryMode = "setup" | "reconfigure";
export type UnlockReturnView = "wizard" | "appShell";
export type SessionModeFilter = "all" | "agent" | "mission";
/**
 * Sub-view of the app shell panel area. `session` is the default chat/
 * welcome panel; `sessionsLibrary` is the dedicated "browse all sessions"
 * screen; `knowledge` is the read-only knowledge + session-memory panel.
 * Settings is NOT a sub-view — the Settings button opens the onboarding
 * wizard (reconfigure). NOT persisted — launch-ephemeral, like activeSessionId.
 */
export type AppShellView =
  | "session"
  | "sessionsLibrary"
  // Read-only knowledge + session-memory management panel (stage 7-2a).
  | "knowledge";

export interface UiLogEntry {
  readonly id: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
  readonly ts: number;
}

/**
 * A first message handed off from the welcome→create flow to the just-created
 * session's composer, which owns the actual `chat.submit` (and its success/
 * failure UX) so a failed first send is visible + recoverable, never lost.
 */
export interface PendingFirstMessage {
  readonly sessionId: string;
  readonly message: string;
}

interface UiState {
  readonly sidebarOpen: boolean;
  readonly currentView: View;
  readonly wizardEntryMode: WizardEntryMode;
  readonly unlockReturnView: UnlockReturnView;
  readonly logBuffer: ReadonlyArray<UiLogEntry>;
  readonly sessionModeFilter: SessionModeFilter;
  /**
   * Currently-selected session in the app shell sidebar. `null` means
   * the welcome state is shown (no session opened yet). NOT persisted —
   * session selection is launch-ephemeral; domain data still lives in
   * TanStack Query.
   */
  readonly activeSessionId: string | null;
  readonly appShellView: AppShellView;
  /**
   * New-session modal state + the first message typed in the welcome
   * composer that should seed creation. NOT persisted (see partialize).
   */
  readonly createSessionOpen: boolean;
  readonly createSessionInitialMessage: string | null;
  readonly pendingFirstMessage: PendingFirstMessage | null;
  readonly setSidebarOpen: (value: boolean) => void;
  readonly setSessionModeFilter: (value: SessionModeFilter) => void;
  readonly setCurrentView: (value: View) => void;
  readonly openWizard: (mode: WizardEntryMode) => void;
  readonly openUnlock: (returnView: UnlockReturnView) => void;
  readonly setActiveSessionId: (value: string | null) => void;
  readonly setAppShellView: (value: AppShellView) => void;
  /** Open the new-session modal, optionally seeding the first message. */
  readonly openCreateSession: (initialMessage?: string | null) => void;
  /** Close the modal + clear its draft. Does NOT touch pendingFirstMessage. */
  readonly closeCreateSession: () => void;
  readonly setPendingFirstMessage: (value: PendingFirstMessage) => void;
  readonly clearPendingFirstMessage: () => void;
  readonly appendLog: (entry: UiLogEntry) => void;
  readonly clearLogs: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      currentView: "splash",
      wizardEntryMode: "setup",
      unlockReturnView: "appShell",
      logBuffer: [],
      sessionModeFilter: "all",
      activeSessionId: null,
      appShellView: "session",
      createSessionOpen: false,
      createSessionInitialMessage: null,
      pendingFirstMessage: null,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSessionModeFilter: (sessionModeFilter) => set({ sessionModeFilter }),
      setCurrentView: (currentView) => set({ currentView }),
      openWizard: (wizardEntryMode) =>
        set({ currentView: "wizard", wizardEntryMode }),
      openUnlock: (unlockReturnView) =>
        set({ currentView: "unlock", unlockReturnView }),
      setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
      setAppShellView: (appShellView) => set({ appShellView }),
      openCreateSession: (initialMessage = null) => {
        const trimmed =
          typeof initialMessage === "string" ? initialMessage.trim() : "";
        set({
          createSessionOpen: true,
          createSessionInitialMessage: trimmed.length > 0 ? trimmed : null,
        });
      },
      closeCreateSession: () =>
        set({ createSessionOpen: false, createSessionInitialMessage: null }),
      setPendingFirstMessage: (pendingFirstMessage) =>
        set({ pendingFirstMessage }),
      clearPendingFirstMessage: () => set({ pendingFirstMessage: null }),
      appendLog: (entry) =>
        set((state) => ({
          logBuffer: [...state.logBuffer, entry].slice(-MAX_RENDER_LOGS),
        })),
      clearLogs: () => set({ logBuffer: [] }),
    }),
    {
      name: "vex-ui",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
);
