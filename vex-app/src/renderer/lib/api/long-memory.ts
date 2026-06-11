/**
 * Long-memory query hook (memory-system S9 rewire). Read-only list of the
 * global long-term memory store, sanitized metadata only. Status `undefined`
 * = all. No mutation hooks — the lifecycle is owned by the agent's memory
 * manager.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import {
  LONG_MEMORY_LIST_DEFAULT_LIMIT,
  type LongMemoryListResult,
  type LongMemoryStatusDto,
} from "@shared/schemas/long-memory.js";
import { longMemoryKeys } from "./queryKeys.js";

const STALE_MS = 10_000;

export function useLongMemoryList(
  status?: LongMemoryStatusDto,
): UseQueryResult<Result<LongMemoryListResult>> {
  return useQuery({
    queryKey: longMemoryKeys.list(status ?? "all"),
    queryFn: () =>
      window.vex.longMemory.list(
        status === undefined
          ? { limit: LONG_MEMORY_LIST_DEFAULT_LIMIT }
          : { status, limit: LONG_MEMORY_LIST_DEFAULT_LIMIT },
      ),
    staleTime: STALE_MS,
  });
}
