import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowRight01Icon,
  FilterHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "@hugeicons/core-free-icons";
import type {
  SessionDeleteOutcome,
  SessionListItem,
} from "@shared/schemas/sessions.js";
import { cn } from "../../lib/utils.js";
import {
  useDeleteSession,
  useSessionsList,
  useSetSessionPinned,
} from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";
import { SessionDeleteDialog } from "./SessionDeleteDialog.js";
import { KnowledgeButton } from "./KnowledgeButton.js";
import { SettingsButton } from "./SettingsButton.js";
import {
  SessionGroups,
  SessionsEmptyPlaceholder,
  SessionsErrorPlaceholder,
  SessionsLoadingPlaceholder,
  SidebarIconButton,
} from "./SessionRows.js";
import {
  filterSessionsByMode,
  groupSessions,
  SESSION_MODE_FILTERS,
} from "./sessionListModel.js";
import { computeVisibleGroups } from "./sessionListLayout.js";

interface SessionsListProps {
  readonly onCreate: () => void;
}

export function SessionsList({ onCreate }: SessionsListProps): JSX.Element {
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const sessionModeFilter = useUiStore((s) => s.sessionModeFilter);
  const setSessionModeFilter = useUiStore((s) => s.setSessionModeFilter);
  const query = useSessionsList();
  const pinMutation = useSetSessionPinned();
  const deleteMutation = useDeleteSession();
  // TanStack Query exposes the last variables sent to the mutation; we
  // use it to disable the star button on the in-flight row only.
  const pendingPinId =
    pinMutation.isPending && pinMutation.variables
      ? pinMutation.variables.id
      : null;
  const [removeTarget, setRemoveTarget] = useState<SessionListItem | null>(null);
  const [removeBlocked, setRemoveBlocked] =
    useState<SessionDeleteOutcome | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState<number>(0);

  useEffect((): (() => void) | undefined => {
    const el = scrollContainerRef.current;
    if (el === null) return undefined;
    // jsdom (tests) does not implement ResizeObserver. We leave
    // containerHeight at 0 so computeVisibleGroups returns the full list.
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      setContainerHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visibleRows = useMemo(() => {
    if (!query.data?.ok) return [];
    return filterSessionsByMode(query.data.data, sessionModeFilter);
  }, [query.data, sessionModeFilter]);

  const groups = useMemo(() => groupSessions(visibleRows), [visibleRows]);

  const { visible: visibleGroups, hiddenCount } = useMemo(
    () => computeVisibleGroups(groups, containerHeight),
    [groups, containerHeight],
  );

  const handleSelect = useCallback(
    (id: string): void => {
      setActiveSessionId(id);
      // Selecting from the sidebar should ALWAYS return the panel area
      // to the session view, even if the user was browsing the library.
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
    // blocked_active_mission | blocked_pending_approval | state_changed
    setRemoveBlocked(outcome);
  }, [deleteMutation, removeTarget]);

  const handleBrowseAll = useCallback((): void => {
    setAppShellView("sessionsLibrary");
  }, [setAppShellView]);

  const toggleSidebar = useCallback((): void => {
    setSidebarOpen(!sidebarOpen);
  }, [setSidebarOpen, sidebarOpen]);

  const totalRows = visibleRows.length;
  const browseAllLabel = sidebarOpen
    ? hiddenCount > 0
      ? `Browse all sessions (${hiddenCount} more)`
      : "Browse all sessions"
    : "Browse all sessions";

  return (
    <aside
      className={cn(
        "relative z-10 flex h-full shrink-0 flex-col border-r border-white/[0.045] bg-[#030916]/[0.16] pb-12 shadow-[inset_-1px_0_0_rgba(255,255,255,0.025),0_0_48px_rgba(0,0,0,0.16)] backdrop-blur-xl backdrop-saturate-150 transition-[width] duration-300",
        sidebarOpen ? "w-[296px]" : "w-[72px]",
      )}
      data-vex-area="sessions-sidebar"
      data-vex-sidebar-open={sidebarOpen ? "true" : "false"}
    >
      <header
        className={cn(
          "flex h-16 items-center border-b border-white/[0.045]",
          sidebarOpen ? "justify-between px-4" : "justify-center px-2",
        )}
      >
        <div className={cn("flex min-w-0 items-center gap-3", !sidebarOpen && "hidden")}>
          <img
            src="/vex.jpg"
            alt=""
            draggable={false}
            className="h-9 w-9 rounded-full object-cover ring-1 ring-[#3275f8]/42"
          />
          <span className="truncate text-sm font-semibold tracking-tight">
            Vex
          </span>
        </div>
        <SidebarIconButton
          label={sidebarOpen ? "Collapse sessions sidebar" : "Expand sessions sidebar"}
          onClick={toggleSidebar}
        >
          <HugeiconsIcon
            icon={sidebarOpen ? PanelLeftCloseIcon : PanelLeftOpenIcon}
            size={17}
            aria-hidden
          />
        </SidebarIconButton>
      </header>

      <div className={cn("border-b border-white/[0.045] p-3", !sidebarOpen && "px-2")}>
        <button
          type="button"
          onClick={onCreate}
          className={cn(
            "flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#3275f8]/32 bg-[#3275f8]/10 text-sm font-medium text-[#6f91ff] transition-colors hover:bg-[#3275f8]/16 hover:text-[#9bb2ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]",
            sidebarOpen ? "px-3" : "px-0",
          )}
          aria-label="New session"
        >
          <HugeiconsIcon icon={Add01Icon} size={17} aria-hidden />
          {sidebarOpen ? <span>New session</span> : null}
        </button>
      </div>

      {sidebarOpen ? (
        <div className="border-b border-white/[0.045] px-3 py-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
            <HugeiconsIcon icon={FilterHorizontalIcon} size={13} aria-hidden />
            <span>Sessions</span>
          </div>
          <div
            role="tablist"
            aria-label="Filter sessions"
            className="grid grid-cols-3 rounded-lg border border-white/[0.045] bg-white/[0.025] p-1"
          >
            {SESSION_MODE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                role="tab"
                aria-selected={sessionModeFilter === filter.value}
                onClick={() => setSessionModeFilter(filter.value)}
                className={cn(
                  "h-8 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]",
                  sessionModeFilter === filter.value
                    ? "bg-[#3275f8]/18 text-foreground shadow-[0_0_18px_rgba(50,117,248,0.12)]"
                    : "text-[var(--color-text-secondary)] hover:bg-white/[0.055] hover:text-foreground",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-hidden px-2 py-3"
      >
        {query.isLoading ? (
          <SessionsLoadingPlaceholder sidebarOpen={sidebarOpen} />
        ) : query.data && query.data.ok === false ? (
          <SessionsErrorPlaceholder
            sidebarOpen={sidebarOpen}
            message={query.data.error.message}
          />
        ) : query.data && query.data.ok ? (
          visibleRows.length === 0 ? (
            <SessionsEmptyPlaceholder sidebarOpen={sidebarOpen} />
          ) : (
            <SessionGroups
              groups={visibleGroups}
              activeSessionId={activeSessionId}
              sidebarOpen={sidebarOpen}
              onSelect={handleSelect}
              onTogglePin={handleTogglePin}
              onRequestRemove={handleRequestRemove}
              pendingPinId={pendingPinId}
              idPrefix="sidebar-sessions"
            />
          )
        ) : null}
      </div>

      {totalRows > 0 ? (
        <div
          className={cn(
            "border-t border-white/[0.045] px-3 py-3",
            !sidebarOpen && "px-2",
          )}
        >
          <button
            type="button"
            onClick={handleBrowseAll}
            aria-label={
              hiddenCount > 0
                ? `Browse all ${totalRows} sessions (${hiddenCount} hidden)`
                : "Open sessions library"
            }
            className={cn(
              "flex h-10 w-full items-center justify-center gap-2 rounded-lg border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]",
              hiddenCount > 0
                ? "border-[#3275f8]/32 bg-[#3275f8]/10 text-[#8da5ff] hover:bg-[#3275f8]/16 hover:text-[#adc0ff]"
                : "border-white/[0.045] bg-transparent text-[var(--color-text-muted)] hover:bg-white/[0.035] hover:text-foreground",
            )}
          >
            {sidebarOpen ? <span className="truncate">{browseAllLabel}</span> : null}
            <HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden />
          </button>
        </div>
      ) : null}

      <footer
        className={cn(
          "flex border-t border-white/[0.045] p-3",
          sidebarOpen ? "items-center justify-between gap-2" : "flex-col gap-2 px-2",
        )}
      >
        <KnowledgeButton compact={!sidebarOpen} />
        <SettingsButton compact={!sidebarOpen} />
        {/* Report issue intentionally hidden for now; ReportIssueButton/Dialog retained for re-enable. */}
      </footer>

      <SessionDeleteDialog
        session={removeTarget}
        blockedOutcome={removeBlocked}
        pending={deleteMutation.isPending}
        onCancel={handleCancelRemove}
        onConfirm={() => {
          void handleConfirmRemove();
        }}
      />
    </aside>
  );
}
