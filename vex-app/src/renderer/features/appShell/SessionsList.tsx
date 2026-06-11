import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowRight01Icon,
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
import { MemoryButton } from "./MemoryButton.js";
import { RuntimeLedger } from "./RuntimeLedger.js";
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
  // Signing-stroke state for the New-session key: SessionCreator drives
  // the transitions; this component only renders ink + glint.
  const signingState = useUiStore((s) => s.signingState);
  const setSigningState = useUiStore((s) => s.setSigningState);
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

  return (
    <aside
      className={cn(
        "relative z-10 flex h-full shrink-0 flex-col border-r border-[var(--vex-line)] bg-[var(--vex-surface-1)] transition-[width] duration-200",
        sidebarOpen ? "w-[296px]" : "w-[72px]",
      )}
      data-vex-area="sessions-sidebar"
      data-vex-sidebar-open={sidebarOpen ? "true" : "false"}
    >
      <header
        className={cn(
          "flex h-12 shrink-0 items-center border-b border-[var(--vex-line)]",
          sidebarOpen ? "justify-between px-4" : "justify-center px-2",
        )}
      >
        <div className={cn("flex min-w-0 items-center gap-2.5", !sidebarOpen && "hidden")}>
          <img
            src="/logo_clean.png"
            alt=""
            draggable={false}
            className="h-[18px] w-auto opacity-90"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-foreground">
            VEX
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

      <div className={cn("p-3", !sidebarOpen && "px-2")}>
        {/* The signing key: a recessed slot (canvas bg) sunk into a full-width
         * plinth hairline that passes visibly behind it — the onboarding
         * KeyButton DNA. The ink stroke draws on hover/focus (globals.css
         * owns the draw) and loops while SessionCreator's mutation is in
         * flight; the glint is the one-shot success light. */}
        <div className="relative">
          <span
            aria-hidden
            className={cn(
              "absolute top-1/2 h-px bg-[var(--vex-line)]",
              sidebarOpen ? "-inset-x-3" : "-inset-x-2",
            )}
          />
          <span
            aria-hidden
            className={cn(
              "absolute top-1/2 h-px bg-[color-mix(in_oklab,var(--vex-accent)_60%,transparent)]",
              // The tick anchors to the plinth's left end, which tracks the
              // wrapper padding (p-3 open / px-2 collapsed).
              sidebarOpen ? "-left-3 w-6" : "-left-2 w-3",
            )}
          />
          <button
            type="button"
            onClick={onCreate}
            aria-label="New session"
            className={cn(
              "vex-sign-key relative flex h-11 items-center justify-center gap-2 rounded-lg border border-[var(--vex-line-strong)] bg-[var(--vex-surface-0)] text-[13px] font-medium text-[var(--vex-text-2)] transition-colors duration-150",
              "hover:border-[var(--vex-accent-border)] hover:text-[var(--vex-accent-text)]",
              "active:scale-[0.99] active:border-[var(--vex-accent-border-strong)] active:bg-[var(--vex-accent-fill-8)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vex-surface-1)]",
              sidebarOpen ? "w-full px-3" : "mx-auto w-10",
            )}
          >
            <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden />
            {sidebarOpen ? <span>New session</span> : null}
            <span
              aria-hidden
              className={cn(
                "vex-sign-stroke absolute bottom-[7px] h-[1.5px] rounded-full bg-[var(--vex-accent)]",
                sidebarOpen ? "inset-x-3.5" : "inset-x-2.5",
                signingState === "signing" && "vex-sign-stroke--signing",
              )}
            />
            {signingState === "signed" ? (
              <span
                aria-hidden
                onAnimationEnd={() => setSigningState("idle")}
                className="vex-intro-glint absolute bottom-[4px] right-3 h-1.5 w-1.5 rounded-full bg-[var(--vex-accent-text)]"
              />
            ) : null}
          </button>
        </div>
      </div>

      {sidebarOpen ? (
        <div
          role="tablist"
          aria-label="Filter sessions"
          className="flex items-end gap-5 border-b border-[var(--vex-line)] px-3"
        >
          {SESSION_MODE_FILTERS.map((filter) => {
            const active = sessionModeFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSessionModeFilter(filter.value)}
                className={cn(
                  "relative pb-2 pt-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
                  active
                    ? "text-foreground"
                    : "text-[var(--vex-text-3)] hover:text-foreground",
                )}
              >
                {filter.label}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--vex-accent)]"
                  />
                ) : null}
              </button>
            );
          })}
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
        // Ledger row, never blue-filled: the row itself is the touch target
        // (no inner padding box), hairline-separated like the rows above it.
        <div className="border-t border-[var(--vex-line)]">
          <button
            type="button"
            onClick={handleBrowseAll}
            aria-label={
              hiddenCount > 0
                ? `Browse all ${totalRows} sessions (${hiddenCount} hidden)`
                : "Open sessions library"
            }
            className={cn(
              "flex h-9 w-full items-center font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--vex-text-2)] transition-colors hover:bg-white/[0.035] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--vex-accent)]",
              sidebarOpen ? "justify-between px-3" : "justify-center px-0",
            )}
          >
            {sidebarOpen ? (
              <span className="truncate">
                {hiddenCount > 0 ? `Browse all · ${hiddenCount} more` : "Browse all"}
              </span>
            ) : null}
            <HugeiconsIcon icon={ArrowRight01Icon} size={12} aria-hidden />
          </button>
        </div>
      ) : null}

      <footer
        className={cn(
          "flex flex-col border-t border-[var(--vex-line)]",
          sidebarOpen ? "" : "items-stretch",
        )}
      >
        <MemoryButton compact={!sidebarOpen} />
        <SettingsButton compact={!sidebarOpen} />
        {/* Report issue intentionally hidden for now; ReportIssueButton/Dialog retained for re-enable. */}
        <RuntimeLedger sidebarOpen={sidebarOpen} />
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
