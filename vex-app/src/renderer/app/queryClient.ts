/**
 * TanStack Query client per skill §5 — single source of truth for async/IPC
 * state. Defaults are conservative: short stale window + manual mutation
 * retries (signing/transfers MUST NOT auto-retry per skill §14).
 *
 * Exports both a factory (createQueryClient) and an app-level singleton
 * (queryClient). Tests use the factory to get a fresh client per test.
 */

import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export const queryClient = createQueryClient();
