/**
 * SlashCommandMenu (stage 8-6a) — presentational autocomplete listbox shown
 * above the composer when the draft is a slash query. Selection is explicit
 * (click or Enter); hover only moves the highlight, so there is no
 * hover-only action. Renders nothing when closed. ≤8px radius, no
 * card-in-card. All state/keyboard logic lives in `useSlashMenu`.
 */

import type { JSX } from "react";
import { cn } from "../../lib/utils.js";
import type { SlashCatalogEntry } from "./slash/catalog.js";

export function SlashCommandMenu({
  open,
  items,
  activeIndex,
  listboxId,
  getOptionId,
  onSelect,
  onActivate,
}: {
  readonly open: boolean;
  readonly items: readonly SlashCatalogEntry[];
  readonly activeIndex: number;
  readonly listboxId: string;
  readonly getOptionId: (index: number) => string;
  readonly onSelect: (entry: SlashCatalogEntry) => void;
  readonly onActivate: (index: number) => void;
}): JSX.Element | null {
  if (!open || items.length === 0) return null;
  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label="Slash commands"
      data-vex-area="slash-menu"
      className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-64 overflow-y-auto rounded-lg border border-[#3275f8]/30 bg-[#061026]/95 p-1 shadow-[0_0_40px_rgba(15,40,110,0.45)] backdrop-blur-2xl"
    >
      {items.map((entry, index) => {
        const active = index === activeIndex;
        return (
          <li
            key={entry.kind}
            id={getOptionId(index)}
            role="option"
            aria-selected={active}
            // mousedown (not click) + preventDefault keeps the textarea
            // focused so the insert + caret-to-end behaves.
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(entry);
            }}
            onMouseEnter={() => onActivate(index)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5",
              active ? "bg-[#3275f8]/18" : "bg-transparent",
            )}
          >
            <span className="shrink-0 font-mono text-sm text-[#8da5ff]">
              {entry.template.trim()}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-muted)]">
              {entry.hint}
            </span>
            {entry.destructive ? (
              <span className="shrink-0 rounded-sm bg-[#f0b23a]/12 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#f0b23a]">
                confirm
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
