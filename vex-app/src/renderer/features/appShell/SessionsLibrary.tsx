/**
 * Browse-all view for the sessions sidebar (Phase 1).
 *
 * Replaces `SessionPanel` in the panel area when
 * `uiStore.appShellView === "sessionsLibrary"`. Renders the full session
 * list (DB cap 100) inside a custom-scrollbar container — sidebar
 * fit-to-height hides anything past the visible budget, so this view is
 * the canonical way to reach an older session that did not make the cut.
 *
 * Re-uses `SessionGroups` so stamps, mission status, and pin toggles
 * stay visually consistent with the sidebar rows.
 *
 * S7 reskin: a REGISTER PAGE, not a glass box — the ledger rows sit
 * directly on the canvas under an h-12 header rule (mirrors the desk
 * rule), with the session count as a mono microtype counter on the right.
 */

import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
} from "@hugeicons/core-free-icons";
import type {
  SessionDeleteOutcome,
  SessionListItem,
} from "@shared/schemas/sessions.js";
import {
  useDeleteSession,
  useSessionsList,
  useSetSessionPinned,
} from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";
import { SessionDeleteDialog } from "./SessionDeleteDialog.js";
import { SessionGroups } from "./SessionRows.js";
import {
  filterSessionsByMode,
  groupSessions,
} from "./sessionListModel.js";

export function SessionsLibrary(): JSX.Element {
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const sessionModeFilter = useUiStore((s) => s.sessionModeFilter);
  const query = useSessionsList();
  const pinMutation = useSetSessionPinned();
  const deleteMutation = useDeleteSession();
  const pendingPinId =
    pinMutation.isPending && pinMutation.variables
      ? pinMutation.variables.id
      : null;
  const [removeTarget, setRemoveTarget] = useState<SessionListItem | null>(null);
  const [removeBlocked, setRemoveBlocked] =
    useState<SessionDeleteOutcome | null>(null);

  const groups = useMemo(() => {
    if (!query.data?.ok) return [];
    return groupSessions(
      filterSessionsByMode(query.data.data, sessionModeFilter),
    );
  }, [query.data, sessionModeFilter]);

  const totalRows = useMemo(
    () => groups.reduce((sum, g) => sum + g.rows.length, 0),
    [groups],
  );

  const handleBack = useCallback((): void => {
    setAppShellView("session");
  }, [setAppShellView]);

  const handleSelect = useCallback(
    (id: string): void => {
      setActiveSessionId(id);
      setAppShellView("session");
    },
    [setActiveSessionId, setAppShellView],
  );

  const handleTogglePin = useCallback(
    (id: string, nextPinned: boolean): void => {
      pinMutation.mutate({ id, pinned: nextPinned });
    },
    [pinMutation],
  );

  const handleRequestRemove = useCallback((row: SessionListItem): void => {
    setRemoveTarget(row);
    setRemoveBlocked(null);
  }, []);

  const handleCancelRemove = useCallback((): void => {
    setRemoveTarget(null);
    setRemoveBlocked(null);
  }, []);

  const handleConfirmRemove = useCallback(async (): Promise<void> => {
    if (removeTarget === null) return;
    const result = await deleteMutation.mutateAsync({ id: removeTarget.id });
    if (!result.ok) {
      setRemoveBlocked("state_changed");
      return;
    }
    const outcome = result.data.outcome;
    if (
      outcome === "removed" ||
      outcome === "not_found" ||
      outcome === "already_removed"
    ) {
      setRemoveTarget(null);
      setRemoveBlocked(null);
      return;
    }
    setRemoveBlocked(outcome);
  }, [deleteMutation, removeTarget]);

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col"
      data-vex-screen="sessions-library"
    >
      {/* Register header — same h-12 datum as the desk rule, so the library
       * reads as another page of the same ledger, not a separate app. */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--vex-line)] px-6">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back to session panel"
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--vex-text-2)] transition-colors hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={17} aria-hidden />
        </button>
        <h1 className="font-mono text-[13px] font-medium uppercase tracking-[0.3em] text-foreground">
          All sessions
        </h1>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-2)]">
          {totalRows === 0
            ? "No sessions yet"
            : `${totalRows} session${totalRows === 1 ? "" : "s"} stored locally`}
        </span>
      </header>

      <section
        aria-label="Sessions library"
        className="vex-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6"
      >
        <div className="mx-auto w-full max-w-[760px]">
          {query.isLoading ? (
            <p className="text-sm text-[var(--vex-text-2)]">
              Loading sessions…
            </p>
          ) : query.data && query.data.ok === false ? (
            <div className="flex items-center gap-2 rounded-[6px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <HugeiconsIcon icon={AlertCircleIcon} size={15} aria-hidden />
              <span>{query.data.error.message}</span>
            </div>
          ) : totalRows === 0 ? (
            <p className="text-sm text-[var(--vex-text-3)]">
              Create a session from the sidebar to get started.
            </p>
          ) : (
            <SessionGroups
              groups={groups}
              activeSessionId={activeSessionId}
              sidebarOpen
              onSelect={handleSelect}
              onTogglePin={handleTogglePin}
              onRequestRemove={handleRequestRemove}
              pendingPinId={pendingPinId}
              idPrefix="library-sessions"
            />
          )}
        </div>
      </section>

      <SessionDeleteDialog
        session={removeTarget}
        blockedOutcome={removeBlocked}
        pending={deleteMutation.isPending}
        onCancel={handleCancelRemove}
        onConfirm={() => {
          void handleConfirmRemove();
        }}
      />
    </div>
  );
}
