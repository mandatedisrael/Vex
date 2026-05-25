/**
 * Compaction TanStack Query hooks (agent integration stage 7-1).
 *
 * Read-only Track-2 worker status for the runtime-bar chip. The renderer
 * never controls the executor (owned by Electron main) — it only reflects
 * the session's `compact_jobs` state.
 *
 * Two freshness layers:
 *  - **poll** (`refetchInterval`): Track-2 runs in a background worker and
 *    its completion fires no transcript event, so we poll — fast while a job
 *    is active, slow when idle. Bounded + cleared on unmount by TanStack.
 *  - **transcript-append invalidation** (`useCompactionLiveSync`): a Track-1
 *    compaction enqueues its Track-2 job mid-turn, so a committed transcript
 *    append flips the chip to "queued" immediately rather than next poll.
 */

import { useEffect } from "react";
import {
  queryOptions,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import {
  COMPACTION_HISTORY_DEFAULT_LIMIT,
  type CompactionHistoryResult,
  type CompactionStatusResult,
} from "@shared/schemas/compaction.js";
import { compactionKeys } from "./queryKeys.js";

const STALE_MS = 5_000;

/** Fast poll while a compaction job is in flight. Exported for tests. */
export const COMPACTION_ACTIVE_POLL_MS = 5_000;
/** Slow poll when idle (nothing queued/running). Exported for tests. */
export const COMPACTION_IDLE_POLL_MS = 30_000;

/**
 * A session is "active" when it has at least one job still expected to
 * produce work (`activeCount > 0`). `permanently_failed` is terminal and
 * does NOT count as active (no point fast-polling a dead job).
 */
export function isCompactionActive(
  result: Result<CompactionStatusResult> | undefined,
): boolean {
  if (result === undefined || !result.ok || result.data === null) return false;
  return result.data.activeCount > 0;
}

function compactionStatusOptions(sessionId: string) {
  return queryOptions({
    queryKey: compactionKeys.status(sessionId),
    queryFn: () => window.vex.compaction.getStatus({ sessionId }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
    refetchInterval: (query) =>
      isCompactionActive(query.state.data)
        ? COMPACTION_ACTIVE_POLL_MS
        : COMPACTION_IDLE_POLL_MS,
  });
}

export function useCompactionStatus(
  sessionId: string | null,
): UseQueryResult<Result<CompactionStatusResult>> {
  return useQuery(compactionStatusOptions(sessionId ?? ""));
}

/**
 * Invalidate the session's compaction status on each committed transcript
 * append. Pure side effect — mount once per active session (in
 * `SessionRuntimeBar`, alongside the chip). Background Track-2 completion is
 * covered by the query's poll; this just makes the in-turn "queued"
 * transition immediate.
 */
export function useCompactionLiveSync(sessionId: string | null): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (sessionId === null || sessionId.length === 0) return;

    const off = window.vex.engine.onTranscriptAppend((event) => {
      if (event.sessionId !== sessionId) return;
      void queryClient.invalidateQueries({
        queryKey: compactionKeys.status(sessionId),
      });
    });

    return () => {
      off();
    };
  }, [sessionId, queryClient]);
}

/**
 * Compaction-generation history for a session (stage 7-2a). Read-only
 * timeline for the knowledge/memory panel; gates on a non-empty session id.
 */
export function useCompactionHistory(
  sessionId: string | null,
): UseQueryResult<Result<CompactionHistoryResult>> {
  const id = sessionId ?? "";
  return useQuery({
    queryKey: compactionKeys.history(id),
    queryFn: () =>
      window.vex.compaction.listHistory({
        sessionId: id,
        limit: COMPACTION_HISTORY_DEFAULT_LIMIT,
      }),
    staleTime: STALE_MS,
    enabled: id.length > 0,
  });
}
