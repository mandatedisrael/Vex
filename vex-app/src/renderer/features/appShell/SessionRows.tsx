/**
 * Public session-list building blocks for the sidebar and the library view:
 * the grouped list (`SessionGroups`), the loading / error / empty placeholders,
 * and the small `SidebarIconButton`. The presentational internals — a single
 * ledger row, its trash/pin actions, the exception stamp, and the shared
 * placeholder strip — live as co-located subcomponents under `./SessionRows/`.
 *
 * This file keeps the existing public export surface; importers are unchanged.
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Archive02Icon, StopCircleIcon } from "@hugeicons/core-free-icons";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { DotmSquare3 } from "../../components/ui/dotm-square-3.js";
import { type SessionGroup } from "./sessionListModel.js";
import { ListPlaceholder } from "./SessionRows/ListPlaceholder.js";
import { SessionRow } from "./SessionRows/SessionRow.js";

interface SessionGroupsProps {
  readonly groups: readonly SessionGroup[];
  readonly activeSessionId: string | null;
  readonly sidebarOpen: boolean;
  readonly onSelect: (id: string) => void;
  readonly onTogglePin: (id: string, nextPinned: boolean) => void;
  readonly onRequestRemove: (row: SessionListItem) => void;
  readonly pendingPinId: string | null;
  /**
   * Namespace for `<section aria-labelledby>` / `<h2 id>` pairs so the
   * sidebar and the library view can coexist on the same page without
   * duplicate IDs. Required because both screens render `SessionGroups`
   * with the same group keys (pinned/today/yesterday/older).
   */
  readonly idPrefix: string;
}

export function SessionGroups({
  groups,
  activeSessionId,
  sidebarOpen,
  onSelect,
  onTogglePin,
  onRequestRemove,
  pendingPinId,
  idPrefix,
}: SessionGroupsProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        if (group.rows.length === 0) return null;
        // When the sidebar is collapsed we hide the <h2>, so referring
        // back to it via aria-labelledby would point at nothing. Fall
        // back to an aria-label that names the section directly.
        const sectionId = `${idPrefix}-${group.key}`;
        return (
          <section
            key={group.key}
            aria-labelledby={sidebarOpen ? sectionId : undefined}
            aria-label={sidebarOpen ? undefined : group.title}
          >
            {sidebarOpen ? (
              <h2
                id={sectionId}
                className="mb-1 flex h-7 items-center px-2 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--vex-text-3)]"
              >
                {group.title}
              </h2>
            ) : null}
            {/* Rows are hairline-separated (border-b on each <li>), not
             * gapped — SIDEBAR_ROW_GAP_PX = 0 must stay in lockstep. */}
            <ol className="flex flex-col">
              {group.rows.map((row) => (
                <SessionRow
                  key={row.id}
                  row={row}
                  selected={row.id === activeSessionId}
                  sidebarOpen={sidebarOpen}
                  onSelect={onSelect}
                  onTogglePin={onTogglePin}
                  onRequestRemove={onRequestRemove}
                  pinPending={pendingPinId === row.id}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

export function SessionsLoadingPlaceholder({
  sidebarOpen,
}: {
  readonly sidebarOpen: boolean;
}): JSX.Element {
  return (
    <ListPlaceholder
      sidebarOpen={sidebarOpen}
      text="Loading sessions"
      icon={
        <DotmSquare3
          size={26}
          dotSize={4}
          color="var(--vex-accent)"
          ariaLabel="Loading sessions"
        />
      }
    />
  );
}

export function SessionsErrorPlaceholder({
  sidebarOpen,
  message,
}: {
  readonly sidebarOpen: boolean;
  readonly message: string;
}): JSX.Element {
  return (
    <ListPlaceholder
      sidebarOpen={sidebarOpen}
      text={message}
      tone="error"
      icon={<HugeiconsIcon icon={StopCircleIcon} size={18} aria-hidden />}
    />
  );
}

export function SessionsEmptyPlaceholder({
  sidebarOpen,
}: {
  readonly sidebarOpen: boolean;
}): JSX.Element {
  return (
    <ListPlaceholder
      sidebarOpen={sidebarOpen}
      text="No sessions"
      icon={<HugeiconsIcon icon={Archive02Icon} size={18} aria-hidden />}
    />
  );
}

export function SidebarIconButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--vex-text-2)] transition-colors hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
    >
      {children}
    </button>
  );
}
