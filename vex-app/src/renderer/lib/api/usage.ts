/**
 * Usage TanStack Query hooks (agent integration puzzle 1).
 *
 * Read-only. Empty sessions resolve to all-zero totals + `null`
 * last-turn — the renderer renders an empty chip, never an error.
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
  USAGE_DEFAULT_CURRENCY,
  type ContextWindowResult,
  type LastTurnUsageResult,
  type SessionUsageTotalsDto,
} from "@shared/schemas/usage.js";
import { isUsageQueryForSession, usageKeys } from "./queryKeys.js";

const STALE_MS = 5_000;

function sessionTotalsOptions(sessionId: string, currency: string) {
  return queryOptions({
    queryKey: usageKeys.sessionTotals(sessionId, currency),
    queryFn: () =>
      window.vex.usage.getSessionTotals({ sessionId, currency }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
  });
}

function lastTurnOptions(sessionId: string, currency: string) {
  return queryOptions({
    queryKey: usageKeys.lastTurn(sessionId, currency),
    queryFn: () => window.vex.usage.getLastTurn({ sessionId, currency }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
  });
}

export function useSessionUsageTotals(
  sessionId: string | null,
  currency: string = USAGE_DEFAULT_CURRENCY,
): UseQueryResult<Result<SessionUsageTotalsDto>> {
  return useQuery(sessionTotalsOptions(sessionId ?? "", currency));
}

export function useLastTurnUsage(
  sessionId: string | null,
  currency: string = USAGE_DEFAULT_CURRENCY,
): UseQueryResult<Result<LastTurnUsageResult>> {
  return useQuery(lastTurnOptions(sessionId ?? "", currency));
}

function contextWindowOptions(sessionId: string) {
  return queryOptions({
    queryKey: usageKeys.contextWindow(sessionId),
    queryFn: () => window.vex.usage.getContextWindow({ sessionId }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
  });
}

export function useContextWindow(
  sessionId: string | null,
): UseQueryResult<Result<ContextWindowResult>> {
  return useQuery(contextWindowOptions(sessionId ?? ""));
}

/**
 * 30s fallback invalidation cadence — `staleTime` alone only marks the
 * cache stale, it does NOT refetch. Mirrors `useTranscriptLiveSync`.
 * Exported for tests.
 */
export const USAGE_LIVE_FALLBACK_POLL_MS = 30_000;

/**
 * Keep a session's usage + context-window queries fresh after each turn.
 *
 * Usage rows and `sessions.token_count` are written by the engine at
 * turn end — just before the assistant transcript row that fires
 * `EV.engine.transcriptAppend`. Two refresh layers (codex review
 * constraint):
 *  - **event-driven**: a matching `transcriptAppend` invalidates every
 *    usage query for the session (totals, last-turn, context-window) via
 *    the `isUsageQueryForSession` predicate;
 *  - **30s fallback poll**: covers a missed event in an active window.
 *
 * Pure side effect — mount once per active session (in `SessionPanel`,
 * alongside `useTranscriptLiveSync`). The chat-submit mutation also
 * invalidates on success for an immediate interactive refresh.
 */
export function useUsageLiveSync(sessionId: string | null): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (sessionId === null || sessionId.length === 0) return;

    const invalidate = (): void => {
      void queryClient.invalidateQueries({
        predicate: (query) =>
          isUsageQueryForSession(query.queryKey, sessionId),
      });
    };

    const off = window.vex.engine.onTranscriptAppend((event) => {
      if (event.sessionId !== sessionId) return;
      invalidate();
    });

    const intervalId = window.setInterval(
      invalidate,
      USAGE_LIVE_FALLBACK_POLL_MS,
    );

    return () => {
      off();
      window.clearInterval(intervalId);
    };
  }, [sessionId, queryClient]);
}
