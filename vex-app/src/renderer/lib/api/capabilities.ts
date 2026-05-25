/**
 * Capabilities query hook — feature-flag gate for the renderer.
 *
 * Mirrors the inline `window.vex.capabilities.get()` query used at app boot
 * and in the wizard review step, centralised so feature gates
 * (`memory`, …) read from one place.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { Capabilities } from "@shared/schemas/capabilities.js";

const STALE_MS = 60_000;

export function useCapabilities(): UseQueryResult<Result<Capabilities>> {
  return useQuery({
    queryKey: ["capabilities"] as const,
    queryFn: () => window.vex.capabilities.get(),
    staleTime: STALE_MS,
  });
}

/** `true` only when the capabilities query resolved with `features.memory`. */
export function useMemoryFeatureEnabled(): boolean {
  const query = useCapabilities();
  return query.data?.ok === true && query.data.data.features.memory === true;
}
