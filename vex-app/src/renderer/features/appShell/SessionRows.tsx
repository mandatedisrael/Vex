import type { JSX, MouseEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AiChat01Icon,
  Archive02Icon,
  Delete02Icon,
  StarIcon,
  StopCircleIcon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { DotmSquare3 } from "../../components/ui/dotm-square-3.js";
import { cn } from "../../lib/utils.js";
import {
  formatSessionTime,
  getMissionActivity,
  getSessionSubtitle,
  getSessionTitle,
  type SessionGroup,
} from "./sessionListModel.js";

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
                className="mb-2 px-2 text-[11px] font-semibold text-[#6f91ff]"
              >
                {group.title}
              </h2>
            ) : null}
            <ol className="flex flex-col gap-1">
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
          color="#6f91ff"
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
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-[var(--color-text-secondary)] transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]"
    >
      {children}
    </button>
  );
}

function ListPlaceholder({
  sidebarOpen,
  text,
  tone,
  icon,
}: {
  readonly sidebarOpen: boolean;
  readonly text: string;
  readonly tone?: "error";
  readonly icon: JSX.Element;
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border border-white/[0.045] bg-white/[0.025] p-3 text-xs",
        tone === "error" ? "text-destructive" : "text-[var(--color-text-secondary)]",
        !sidebarOpen && "justify-center px-0",
      )}
    >
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      {sidebarOpen ? <p className="min-w-0 truncate">{text}</p> : null}
    </div>
  );
}

function SessionRow({
  row,
  selected,
  sidebarOpen,
  onSelect,
  onTogglePin,
  onRequestRemove,
  pinPending,
}: {
  readonly row: SessionListItem;
  readonly selected: boolean;
  readonly sidebarOpen: boolean;
  readonly onSelect: (id: string) => void;
  readonly onTogglePin: (id: string, nextPinned: boolean) => void;
  readonly onRequestRemove: (row: SessionListItem) => void;
  readonly pinPending: boolean;
}): JSX.Element {
  const startedLabel = formatSessionTime(row.startedAt);
  const title = getSessionTitle(row);
  const subtitle = getSessionSubtitle(row);
  const activity = getMissionActivity(row);
  const Icon = row.mode === "mission" ? Target02Icon : AiChat01Icon;
  const isPinned = row.pinnedAt !== null;

  const handlePinClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    if (pinPending) return;
    onTogglePin(row.id, !isPinned);
  };

  const handleRemoveClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    onRequestRemove(row);
  };

  // Row select control and pin toggle are SIBLINGS inside a non-interactive
  // wrapper. This is the only safe layout: a button inside a button is
  // invalid HTML, and a custom `role="button"` parent would let Enter/Space
  // bubble from the pin into a row-level keydown handler. Container holds
  // the visual styling; both children focus / click independently.
  return (
    <li>
      <div
        className={cn(
          "group relative flex w-full rounded-lg border transition-colors",
          selected
            ? "border-[#3275f8]/42 bg-[#3275f8]/13 shadow-[0_0_24px_rgba(50,117,248,0.12)]"
            : "border-transparent hover:border-white/[0.055] hover:bg-white/[0.035]",
          // Fixed height drives the fit-to-height packer; see
          // SIDEBAR_ROW_HEIGHT_PX in sessionListLayout.ts.
          sidebarOpen ? "h-[88px]" : "h-11",
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(row.id)}
          aria-current={selected ? "true" : undefined}
          aria-label={!sidebarOpen ? title : undefined}
          className={cn(
            "flex h-full w-full rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]",
            // pr-16 (sidebarOpen) reserves 64px on the right for the
            // absolutely positioned Trash + Pin sibling cluster so the
            // title flex never paints under them. Collapsed sidebar
            // hides both actions, so no reservation.
            sidebarOpen ? "gap-3 px-3 py-3 pr-16" : "items-center justify-center px-0",
          )}
          title={sidebarOpen ? undefined : title}
        >
          <span
            className={cn(
              "relative flex h-9 w-9 shrink-0 items-center justify-center text-[#8da5ff]",
              selected && "text-[#adc0ff]",
            )}
          >
            <HugeiconsIcon icon={Icon} size={17} aria-hidden />
            {activity !== null ? (
              <span
                aria-hidden
                className={cn(
                  "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-black/60",
                  activity.dotClass,
                )}
              />
            ) : null}
          </span>

          {sidebarOpen ? (
            <span className="min-w-0 flex-1">
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {title}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">
                  {startedLabel}
                </span>
              </span>
              <span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">
                {subtitle}
              </span>
              <span className="mt-2 flex items-center gap-2">
                <Badge tone={row.mode === "mission" ? "mission" : "agent"}>
                  {row.mode}
                </Badge>
                <Badge tone={row.permission === "full" ? "full" : "restricted"}>
                  {row.permission}
                </Badge>
                {activity !== null ? (
                  <Badge tone={activity.tone}>{activity.label}</Badge>
                ) : null}
              </span>
            </span>
          ) : null}
        </button>

        {sidebarOpen ? (
          // Trash + Pin live in a sibling cluster outside the select
          // button. Native buttons inside a non-interactive wrapper —
          // no nested buttons, no role="button" parent, so Enter/Space
          // on either action cannot bubble into a row-select handler.
          <div className="absolute right-3 top-3 flex items-center gap-1">
            <RemoveButton onClick={handleRemoveClick} />
            <PinToggle
              pinned={isPinned}
              pending={pinPending}
              onClick={handlePinClick}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function RemoveButton({
  onClick,
}: {
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove session"
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-[var(--color-text-muted)] transition-colors",
        "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        "hover:bg-destructive/10 hover:text-destructive",
        "focus-visible:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#3275f8]",
      )}
    >
      <HugeiconsIcon icon={Delete02Icon} size={13} aria-hidden />
    </button>
  );
}

function PinToggle({
  pinned,
  pending,
  onClick,
  className,
}: {
  readonly pinned: boolean;
  readonly pending: boolean;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin session" : "Pin session"}
      disabled={pending}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]",
        pinned
          ? "border-[#ffd35c]/40 bg-[#ffd35c]/10 text-[#ffd35c] hover:bg-[#ffd35c]/16"
          : "border-transparent text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-white/[0.06] hover:text-foreground",
        pending && "cursor-wait opacity-60",
        className,
      )}
    >
      <HugeiconsIcon icon={StarIcon} size={13} aria-hidden />
    </button>
  );
}

function Badge({
  tone,
  children,
}: {
  readonly tone:
    | "agent"
    | "mission"
    | "restricted"
    | "full"
    | "active"
    | "paused"
    | "stopped";
  readonly children: string;
}): JSX.Element {
  const cls = {
    // Chat-type badges (mode + permission) render flat — text only, no fill.
    agent: "text-[#8da5ff]",
    mission: "text-[#b2a3ff]",
    restricted: "text-[var(--color-text-secondary)]",
    full: "text-warning",
    // Run-status badges keep their fill so live activity stays scannable.
    active: "bg-success/12 text-success",
    paused: "bg-warning/14 text-warning",
    stopped: "bg-white/[0.05] text-[var(--color-text-muted)]",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        cls,
      )}
    >
      {children}
    </span>
  );
}
