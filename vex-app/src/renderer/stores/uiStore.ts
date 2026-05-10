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
  | "placeholder";

export interface UiLogEntry {
  readonly id: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
  readonly ts: number;
}

interface UiState {
  readonly sidebarOpen: boolean;
  readonly currentView: View;
  readonly logBuffer: ReadonlyArray<UiLogEntry>;
  readonly setSidebarOpen: (value: boolean) => void;
  readonly setCurrentView: (value: View) => void;
  readonly appendLog: (entry: UiLogEntry) => void;
  readonly clearLogs: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      currentView: "splash",
      logBuffer: [],
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setCurrentView: (currentView) => set({ currentView }),
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
