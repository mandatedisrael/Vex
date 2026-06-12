/**
 * Memory-inspector query hooks (memory-system S10). Read-only window into the
 * memory manager's pipeline: candidate buffer, decision audit, and job queue.
 * Sanitized metadata only. No mutation hooks — the memory lifecycle is
 * exclusively owned by the agent's memory manager (S9).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import {
  MEMORY_INSPECTOR_LIST_DEFAULT_LIMIT,
  MEMORY_INSPECTOR_RECENT_JOBS_DEFAULT_LIMIT,
  type MemoryCandidateStatusDto,
  type MemoryDecisionTypeDto,
  type MemoryInspectorListCandidatesResult,
  type MemoryInspectorListDecisionsResult,
  type MemoryJobsSummaryDto,
} from "@shared/schemas/memory-inspector.js";
import { memoryInspectorKeys } from "./queryKeys.js";

const STALE_MS = 10_000;

export function useInspectorCandidates(
  status?: MemoryCandidateStatusDto,
): UseQueryResult<Result<MemoryInspectorListCandidatesResult>> {
  return useQuery({
    queryKey: memoryInspectorKeys.candidates(status ?? "all"),
    queryFn: () =>
      window.vex.memoryInspector.listCandidates(
        status === undefined
          ? { limit: MEMORY_INSPECTOR_LIST_DEFAULT_LIMIT }
          : { status, limit: MEMORY_INSPECTOR_LIST_DEFAULT_LIMIT },
      ),
    staleTime: STALE_MS,
  });
}

export function useInspectorDecisions(
  decisionType?: MemoryDecisionTypeDto,
): UseQueryResult<Result<MemoryInspectorListDecisionsResult>> {
  return useQuery({
    queryKey: memoryInspectorKeys.decisions(decisionType ?? "all"),
    queryFn: () =>
      window.vex.memoryInspector.listDecisions(
        decisionType === undefined
          ? { limit: MEMORY_INSPECTOR_LIST_DEFAULT_LIMIT }
          : { decisionType, limit: MEMORY_INSPECTOR_LIST_DEFAULT_LIMIT },
      ),
    staleTime: STALE_MS,
  });
}

export function useJobsSummary(): UseQueryResult<Result<MemoryJobsSummaryDto>> {
  return useQuery({
    queryKey: memoryInspectorKeys.jobsSummary(),
    queryFn: () =>
      window.vex.memoryInspector.jobsSummary({
        recentLimit: MEMORY_INSPECTOR_RECENT_JOBS_DEFAULT_LIMIT,
      }),
    staleTime: STALE_MS,
  });
}
