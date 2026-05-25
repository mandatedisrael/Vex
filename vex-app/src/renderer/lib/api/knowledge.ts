/**
 * Knowledge management query hook (stage 7-2a). Read-only list of the global
 * knowledge store, sanitized metadata only. Status `undefined` = all.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import {
  KNOWLEDGE_LIST_DEFAULT_LIMIT,
  type KnowledgeListResult,
  type KnowledgeStatusDto,
  type KnowledgeUpdateStatusInput,
  type KnowledgeUpdateStatusResult,
} from "@shared/schemas/knowledge.js";
import { knowledgeKeys } from "./queryKeys.js";

const STALE_MS = 10_000;

export function useKnowledgeList(
  status?: KnowledgeStatusDto,
): UseQueryResult<Result<KnowledgeListResult>> {
  return useQuery({
    queryKey: knowledgeKeys.list(status ?? "all"),
    queryFn: () =>
      window.vex.knowledge.list(
        status === undefined
          ? { limit: KNOWLEDGE_LIST_DEFAULT_LIMIT }
          : { status, limit: KNOWLEDGE_LIST_DEFAULT_LIMIT },
      ),
    staleTime: STALE_MS,
  });
}

/**
 * Disable/archive a knowledge entry (stage 7-2b). One-way; invalidates the
 * whole knowledge cache on success so the row reflects its new status (and
 * leaves the active filter). A `not_found`/`invalid_state` outcome resolves
 * with `ok:false` and does NOT refetch.
 */
export function useUpdateKnowledgeStatus(): UseMutationResult<
  Result<KnowledgeUpdateStatusResult>,
  Error,
  KnowledgeUpdateStatusInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: KnowledgeUpdateStatusInput) =>
      window.vex.knowledge.updateStatus(input),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
      }
    },
  });
}
