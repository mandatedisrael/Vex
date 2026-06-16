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
 *
 * S3 entry settle: only rows appended LIVE after the session's first completed
 * render get the one-shot `.vex-entry-settle` print animation. Historical rows
 * (initial load + load-older prepends) enter with a hard cut.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type JSX } from "react";
import type { Result } from "@shared/ipc/result.js";
import type { MessagePage, SessionMessageDto } from "@shared/schemas/messages.js";
import { usePendingApprovals } from "../../lib/api/approvals.js";
import {
  flattenTranscriptPages,
  useTranscriptInfinite,
} from "../../lib/api/messages.js";
import { DotmHex3 } from "../../components/ui/dotm-hex-3.js";
import { cn } from "../../lib/utils.js";
import { useStreamPreview } from "../../stores/streamStore.js";
import { StreamingBubble } from "./StreamingBubble.js";
import { TranscriptMessage } from "./TranscriptMessage.js";
import {
  groupTranscriptRows,
  toTranscriptRows,
  type TranscriptEntry,
} from "./transcriptRowModel.js";

const PINNED_THRESHOLD_PX = 48;
const LOAD_OLDER_THRESHOLD_PX = 64;
// Same cadence as ApprovalsRegion — both observers share one query, so this
// adds no IPC load; it only keeps the act-ledger stamps as fresh as the cards.
const PENDING_APPROVALS_REFETCH_MS = 5_000;

/**
 * React key for a transcript entry. A `tool_group` reuses its first call
 * row's message id, and that same row may ALSO pass through as a prose-only
 * row — prefixing the group key keeps the two distinct.
 */
function entryKey(entry: TranscriptEntry): string {
  return entry.variant === "tool_group" ? `tg-${entry.id}` : String(entry.id);
}

/**
 * Ids that must NOT animate: everything visible at the session's first
 * completed render plus every page later added via load-older (an older page
 * is history, not a live arrival). Tracked per session; `pageCount` detects
 * fetchNextPage appends (a live refetch replaces pages without growing the
 * array). Mutated during render — safe because the bookkeeping is idempotent,
 * which also makes StrictMode's double render/mount a no-op.
 */
interface SettledIdsTracker {
  readonly sessionId: string;
  readonly ids: Set<number>;
  pageCount: number;
}

function trackSettledIds(
  tracker: SettledIdsTracker | null,
  sessionId: string,
  pages: readonly Result<MessagePage>[] | undefined,
): SettledIdsTracker | null {
  if (pages === undefined) {
    // Nothing fetched yet for this session — keep waiting (a stale tracker
    // from the previous session is dropped so its ids can't leak across).
    return tracker !== null && tracker.sessionId === sessionId ? tracker : null;
  }
  if (tracker === null || tracker.sessionId !== sessionId) {
    const ids = new Set<number>();
    for (const page of pages) {
      if (!page.ok) continue;
      for (const item of page.data.items) ids.add(item.id);
    }
    return { sessionId, ids, pageCount: pages.length };
  }
  if (pages.length > tracker.pageCount) {
    // Pages appended by fetchNextPage are older history → absorb as settled.
    for (const page of pages.slice(tracker.pageCount)) {
      if (!page.ok) continue;
      for (const item of page.data.items) tracker.ids.add(item.id);
    }
    tracker.pageCount = pages.length;
  }
  return tracker;
}

export function SessionTranscript({
  sessionId,
}: {
  readonly sessionId: string;
}): JSX.Element {
  const query = useTranscriptInfinite(sessionId);
  const preview = useStreamPreview(sessionId);
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
  // One pass that correlates each tool_result row to its call's name, then
  // the S5 act-ledger post-pass: merge outputs into call acts and collapse
  // runs of ≥3 calls into one group entry.
  const rows = useMemo(
    () => groupTranscriptRows(toTranscriptRows(items)),
    [items],
  );

  // S5 — pending approvals drive two quiet signals: per-act "Awaiting
  // signature" stamps (matched by toolCallId) and the working strip's
  // circuit-break. Shares ApprovalsRegion's query key: no new IPC.
  const pendingQuery = usePendingApprovals(sessionId, {
    refetchInterval: PENDING_APPROVALS_REFETCH_MS,
  });
  const pendingApprovals = useMemo<ReadonlyMap<string, string>>(() => {
    const byToolCallId = new Map<string, string>();
    const result = pendingQuery.data;
    if (result === undefined || !result.ok) return byToolCallId;
    for (const approval of result.data) {
      // Defensive status check — listPending should only return pendings.
      if (approval.status !== "pending" || approval.toolCallId === null) continue;
      if (!byToolCallId.has(approval.toolCallId)) {
        byToolCallId.set(approval.toolCallId, approval.id);
      }
    }
    return byToolCallId;
  }, [pendingQuery.data]);
  const hasPendingApproval =
    pendingQuery.data !== undefined &&
    pendingQuery.data.ok &&
    pendingQuery.data.data.length > 0;

  // Render-time bookkeeping (not an effect): the settle class must be present
  // on a live row's FIRST paint or the animation start is visibly late.
  const settledRef = useRef<SettledIdsTracker | null>(null);
  settledRef.current = trackSettledIds(settledRef.current, sessionId, pages);
  const settledIds = settledRef.current?.ids ?? null;
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

  // The growing preview bubble must keep the view pinned too. Follow on ANY
  // visible preview change (new stream, new text, tool name, phase) so a
  // tool-only or error bubble can't appear off-screen — not just on text.
  const previewSig =
    preview === null
      ? null
      : `${preview.streamId}:${preview.phase}:${preview.toolName ?? ""}:${preview.text.length}`;
  useEffect(() => {
    if (previewSig === null) return;
    const el = scrollRef.current;
    if (el !== null && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [previewSig]);

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
          color="var(--vex-accent)"
          ariaLabel="Loading conversation"
        />
      </div>
    );
  }

  // Empty/error copy only when there is also no live preview — otherwise the
  // first streamed reply in a brand-new session would be invisible. A preview
  // falls through to the scroll container below.
  if (items.length === 0 && preview === null) {
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
            className="rounded-[6px] border border-[color-mix(in_oklab,var(--color-destructive)_40%,transparent)] bg-destructive/10 px-3 py-2 text-xs text-destructive"
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
        <p className="text-center text-sm text-[var(--vex-text-2)]">
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
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 py-4"
    >
      {/* SIGNAL TAPE content wrapper — holds the single monotonic spine the
          whole session hangs off. It sizes to content, so the outer scroll
          math is unchanged: scrollHeight still equals total row height + py-4
          (the bottom-follow + load-older anchoring on scrollRef are untouched). */}
      <div className="relative flex flex-col gap-3">
        {/* The spine: a quiet hairline time/sequence axis at the gutter x
            (left-[9px] = the 9px gutter centre; px-1 on the scroll parent puts
            it 13px from the panel edge). Accent is rationed OUT of the resting
            axis — the live/pending node (StreamingBubble) is the only blue that
            ever lights on it. aria-hidden: pure structure. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-[9px] top-0 bottom-0 w-px bg-[var(--vex-line)]"
        />
        {query.isFetchingNextPage ? (
          <div className="flex justify-center py-1">
            <DotmHex3 size={18} dotSize={3} color="var(--vex-accent)" ariaLabel="Loading older messages" />
          </div>
        ) : null}
        {olderError ? (
          <div
            role="alert"
            className="mx-auto rounded-[6px] border border-[color-mix(in_oklab,var(--color-destructive)_40%,transparent)] bg-destructive/10 px-2.5 py-1 text-[11px] text-destructive"
          >
            Couldn&apos;t load older messages.
          </div>
        ) : null}
        {rows.map((row) => (
          // Turn rhythm: the list gap is the 12px intra-turn beat; a USER row
          // starts a new turn, so its extra mt-4 totals the 28px turn spacing.
          // Live-appended rows (id outside the settled set) print with the
          // one-shot entry settle; historical rows hard-cut. A tool group keeps
          // its first call row's id, so its settle status matches its members'.
          <div
            key={entryKey(row)}
            className={cn(
              row.variant === "user" && "mt-4",
              settledIds !== null && !settledIds.has(row.id) && "vex-entry-settle",
            )}
          >
            <TranscriptMessage row={row} pendingApprovals={pendingApprovals} />
          </div>
        ))}
        {preview !== null ? (
          <StreamingBubble
            preview={preview}
            awaitingApproval={hasPendingApproval}
          />
        ) : null}
      </div>
    </div>
  );
}
