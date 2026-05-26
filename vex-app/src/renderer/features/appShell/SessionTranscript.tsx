/**
 * Session transcript surface (stage 8-1 + 8-2b load-older).
 *
 * Pages backward through `useTranscriptInfinite` (newest page first). Renders
 * loading (dotmatrix) / error / empty / list, bottom-anchored: jumps to newest
 * on session change and follows new arrivals only while pinned to the bottom.
 * Scrolling near the top loads the next older page (capped at
 * `MAX_TRANSCRIPT_PAGES` until 8-2c adds virtualization); the viewport is held
 * steady across that prepend by restoring the scrollHeight delta — and ONLY
 * for that intentional prepend, never for a live refetch or a new bottom
 * message.
 *
 * Error handling is split: an initial (newest-page) failure shows the
 * transcript error state; an older-page failure keeps the loaded messages and
 * shows a top "couldn't load older" banner. Content rendering is delegated to
 * `TranscriptMessage` (assistant = safe markdown, others = plain text).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type JSX } from "react";
import type { SessionMessageDto } from "@shared/schemas/messages.js";
import {
  flattenTranscriptPages,
  useTranscriptInfinite,
} from "../../lib/api/messages.js";
import { DotmHex3 } from "../../components/ui/dotm-hex-3.js";
import { TranscriptMessage } from "./TranscriptMessage.js";
import { toTranscriptRow } from "./transcriptRowModel.js";

const PINNED_THRESHOLD_PX = 48;
const LOAD_OLDER_THRESHOLD_PX = 64;

export function SessionTranscript({
  sessionId,
}: {
  readonly sessionId: string;
}): JSX.Element {
  const query = useTranscriptInfinite(sessionId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  // Set ONLY by an intentional load-older fetch; consumed by the settle effect
  // below for scroll restoration. It never gates fetching or bottom-follow, so
  // it cannot wedge the transcript even if the older fetch fails.
  const prependAnchor = useRef<{
    readonly prevHeight: number;
    readonly prevOldestId: number;
  } | null>(null);

  const pages = query.data?.pages;
  const items = useMemo<SessionMessageDto[]>(
    () => (pages === undefined ? [] : flattenTranscriptPages(pages)),
    [pages],
  );
  const newestId = items.at(-1)?.id ?? 0;
  const oldestId = items.at(0)?.id ?? 0;
  const firstPage = pages?.[0];
  const olderError =
    items.length > 0 &&
    ((pages?.some((page) => !page.ok) ?? false) || query.isError);

  // Session change → jump to the newest message.
  useEffect(() => {
    pinnedToBottom.current = true;
    prependAnchor.current = null;
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [sessionId]);

  // New newest message while pinned → follow to the bottom. A load-older
  // prepend never changes `newestId`, so this stays quiet during one.
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [newestId]);

  // After an intentional older-page fetch settles, hold the viewport if a page
  // was actually prepended (oldest id changed); clear the anchor either way —
  // success OR failure — so it can never gate a later load or bottom-follow.
  useLayoutEffect(() => {
    if (query.isFetchingNextPage) return;
    const anchor = prependAnchor.current;
    if (anchor === null) return;
    const el = scrollRef.current;
    if (el !== null && oldestId !== anchor.prevOldestId) {
      el.scrollTop += el.scrollHeight - anchor.prevHeight;
    }
    prependAnchor.current = null;
  }, [query.isFetchingNextPage, oldestId]);

  const onScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottom.current = distanceFromBottom < PINNED_THRESHOLD_PX;
    if (
      el.scrollTop < LOAD_OLDER_THRESHOLD_PX &&
      query.hasNextPage &&
      !query.isFetchingNextPage
    ) {
      prependAnchor.current = {
        prevHeight: el.scrollHeight,
        prevOldestId: oldestId,
      };
      void query.fetchNextPage();
    }
  }, [query, oldestId]);

  if (query.isLoading) {
    return (
      <div
        data-vex-area="chat-transcript"
        data-state="loading"
        className="flex min-h-0 flex-1 items-center justify-center"
      >
        <DotmHex3
          size={28}
          dotSize={4}
          color="#6f91ff"
          ariaLabel="Loading conversation"
        />
      </div>
    );
  }

  if (items.length === 0) {
    if (query.isError || (firstPage !== undefined && !firstPage.ok)) {
      const message =
        firstPage !== undefined && !firstPage.ok
          ? firstPage.error.message
          : "Unable to load this conversation.";
      return (
        <div
          data-vex-area="chat-transcript"
          data-state="error"
          className="flex min-h-0 flex-1 items-center justify-center px-4"
        >
          <div
            role="alert"
            className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {message}
          </div>
        </div>
      );
    }
    return (
      <div
        data-vex-area="chat-transcript"
        data-state="empty"
        className="flex min-h-0 flex-1 items-center justify-center px-4"
      >
        <p className="text-center text-sm text-[var(--color-text-muted)]">
          Start the conversation — your messages and Vex&apos;s replies appear
          here.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      data-vex-area="chat-transcript"
      data-state="ready"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-4"
    >
      {query.isFetchingNextPage ? (
        <div className="flex justify-center py-1">
          <DotmHex3 size={18} dotSize={3} color="#6f91ff" ariaLabel="Loading older messages" />
        </div>
      ) : null}
      {olderError ? (
        <div
          role="alert"
          className="mx-auto rounded-md border border-destructive/35 bg-destructive/10 px-2.5 py-1 text-[11px] text-destructive"
        >
          Couldn&apos;t load older messages.
        </div>
      ) : null}
      {items.map((m) => (
        <TranscriptMessage key={m.id} row={toTranscriptRow(m)} />
      ))}
    </div>
  );
}
