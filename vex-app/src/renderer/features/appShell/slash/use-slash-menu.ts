/**
 * useSlashMenu (stage 8-6a) — owns the discoverable slash-command menu's
 * open/active/dismiss state + keyboard handling for the composer, so
 * `SessionComposer` stays lean. Pure matching lives in `catalog.ts`; dispatch
 * + confirmation stay in the composer + `dispatch.ts`.
 *
 * Open rule: the draft is a slash query with matches AND has not been
 * dismissed at its current value. Selecting inserts the template and
 * suppresses reopen against that NEW value (so picking `/retry` from `/re`
 * does not immediately reopen); Escape suppresses against the current value
 * until the next edit. Arrow/Enter/Escape are handled (and `preventDefault`d)
 * ONLY while open, so a closed menu never changes textarea/submit behavior.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { filterSlashCatalog, type SlashCatalogEntry } from "./catalog.js";

export interface SlashMenuController {
  readonly open: boolean;
  readonly items: readonly SlashCatalogEntry[];
  readonly activeIndex: number;
  readonly listboxId: string;
  readonly activeOptionId: string | undefined;
  readonly getOptionId: (index: number) => string;
  readonly setActiveIndex: (index: number) => void;
  readonly select: (entry: SlashCatalogEntry) => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function useSlashMenu(args: {
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}): SlashMenuController {
  const { draft, setDraft, textareaRef } = args;
  const listboxId = useId();
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const [rawActiveIndex, setActiveIndex] = useState(0);
  const [selectionToken, setSelectionToken] = useState(0);

  const items = filterSlashCatalog(draft);
  const open = items.length > 0 && draft !== dismissedAt;
  // Clamp so a shrunk list never points aria-activedescendant out of range
  // in the render before the reset effect runs.
  const activeIndex =
    items.length === 0 ? 0 : Math.min(rawActiveIndex, items.length - 1);

  // New query → highlight the first match. Arrow keys move the highlight
  // without changing the draft, so they survive between keystrokes.
  useEffect(() => {
    setActiveIndex(0);
  }, [draft]);

  // After a selection, refocus the textarea and drop the caret at the end so
  // an arg-taking template (e.g. `/rewind `) is ready for its value.
  useLayoutEffect(() => {
    if (selectionToken === 0) return;
    const el = textareaRef.current;
    if (el === null) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [selectionToken, textareaRef]);

  const select = useCallback(
    (entry: SlashCatalogEntry): void => {
      setDraft(entry.template);
      setDismissedAt(entry.template); // suppress reopen against the NEW value
      setSelectionToken((token) => token + 1);
    },
    [setDraft],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (!open) return;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setActiveIndex((index) => (index + 1) % items.length);
          break;
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex(
            (index) => (index - 1 + items.length) % items.length,
          );
          break;
        case "Enter": {
          event.preventDefault();
          const entry = items[activeIndex];
          if (entry !== undefined) select(entry);
          break;
        }
        case "Escape":
          event.preventDefault();
          setDismissedAt(draft);
          break;
        default:
          break;
      }
    },
    [open, items, activeIndex, select, draft],
  );

  const getOptionId = useCallback(
    (index: number): string => `${listboxId}-option-${index}`,
    [listboxId],
  );

  return {
    open,
    items,
    activeIndex,
    listboxId,
    activeOptionId: open ? getOptionId(activeIndex) : undefined,
    getOptionId,
    setActiveIndex,
    select,
    handleKeyDown,
  };
}
