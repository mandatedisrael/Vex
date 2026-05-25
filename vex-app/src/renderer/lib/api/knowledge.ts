/**
 * Knowledge management query hook (stage 7-2a). Read-only list of the global
 * knowledge store, sanitized metadata only. Status `undefined` = all.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import {
  KNOWLEDGE_LIST_DEFAULT_LIMIT,
  type KnowledgeListResult,
  type KnowledgeStatusDto,
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
