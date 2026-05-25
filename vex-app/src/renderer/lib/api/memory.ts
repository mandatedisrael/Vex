/**
 * Session-memory management query hooks (stage 7-2a). Read-only per-session
 * list + stats; both gate on a non-empty session id so the no-active-session
 * state never issues a session-scoped query.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import {
  SESSION_MEMORY_LIST_DEFAULT_LIMIT,
  type MemoryStatsResult,
  type SessionMemoryListResult,
} from "@shared/schemas/memory.js";
import { memoryKeys } from "./queryKeys.js";

const STALE_MS = 10_000;

export function useSessionMemories(
  sessionId: string | null,
): UseQueryResult<Result<SessionMemoryListResult>> {
  const id = sessionId ?? "";
  return useQuery({
    queryKey: memoryKeys.sessionList(id),
    queryFn: () =>
      window.vex.memory.listSession({
        sessionId: id,
        limit: SESSION_MEMORY_LIST_DEFAULT_LIMIT,
      }),
    staleTime: STALE_MS,
    enabled: id.length > 0,
  });
}

export function useMemoryStats(
  sessionId: string | null,
): UseQueryResult<Result<MemoryStatsResult>> {
  const id = sessionId ?? "";
  return useQuery({
    queryKey: memoryKeys.stats(id),
    queryFn: () => window.vex.memory.getStats({ sessionId: id }),
    staleTime: STALE_MS,
    enabled: id.length > 0,
  });
}
