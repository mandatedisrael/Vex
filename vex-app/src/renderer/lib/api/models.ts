/**
 * Models TanStack Query hook (global model resolution).
 *
 * Read-only — returns `source: "global_default"` (single env-derived
 * option) or `source: "unconfigured"` (empty list). No network call. A
 * future OpenRouter catalogue fetch could enrich the option metadata.
 */

import {
  queryOptions,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { ModelsListAvailableResult } from "@shared/schemas/models.js";
import { modelsKeys } from "./queryKeys.js";

const STALE_MS = 60_000;

function availableOptions() {
  return queryOptions({
    queryKey: modelsKeys.available(),
    queryFn: () => window.vex.models.listAvailable({}),
    staleTime: STALE_MS,
  });
}

export function useAvailableModels(): UseQueryResult<
  Result<ModelsListAvailableResult>
> {
  return useQuery(availableOptions());
}
