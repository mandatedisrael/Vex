/**
 * Provider API reconfigure-staleness pin (S6 welcome-effort plan, round 2).
 *
 * `useInvalidateEnvStateAfterProviderWrite()` returns the callback
 * `ProviderStep` invokes on a successful `persistProvider` write. Verifies
 * it RESETS (not merely invalidates) `modelsKeys.all` + `sessionModelKeys.all`
 * alongside its existing `onboardingKeys.envState()` invalidation — a
 * provider/model reconfigure must never leave the OLD model's cached
 * reasoning capability visible while a background refetch for the NEW model
 * is in flight (that is what `invalidateQueries` alone would do; `reset`
 * clears the cache first).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import { useInvalidateEnvStateAfterProviderWrite } from "../provider.js";
import { modelsKeys, onboardingKeys, sessionModelKeys } from "../queryKeys.js";

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function makeClient(): {
  readonly client: QueryClient;
  readonly invalidateSpy: ReturnType<typeof vi.spyOn>;
  readonly resetSpy: ReturnType<typeof vi.spyOn>;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const resetSpy = vi.spyOn(client, "resetQueries");
  return { client, invalidateSpy, resetSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useInvalidateEnvStateAfterProviderWrite", () => {
  it("invalidates envState AND resets modelsKeys.all + sessionModelKeys.all", () => {
    const { client, invalidateSpy, resetSpy } = makeClient();
    const { result } = renderHook(() => useInvalidateEnvStateAfterProviderWrite(), {
      wrapper: makeWrapper(client),
    });

    result.current();

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: onboardingKeys.envState(),
    });
    expect(resetSpy).toHaveBeenCalledWith({ queryKey: modelsKeys.all });
    expect(resetSpy).toHaveBeenCalledWith({ queryKey: sessionModelKeys.all });
  });

  it("A→B reconfigure pin: a reset clears model A's cached capability so an immediate read never serves stale data while B refetches", () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useInvalidateEnvStateAfterProviderWrite(), {
      wrapper: makeWrapper(client),
    });

    // Seed the cache as if model A had already resolved its capability.
    client.setQueryData(modelsKeys.available(), {
      source: "global_default",
      fetchedAt: null,
      models: [
        {
          providerId: "openrouter",
          modelId: "model-a",
          displayName: "model-a",
          brand: "openrouter",
          contextLength: null,
          pricingInputPerMillion: null,
          pricingOutputPerMillion: null,
          reasoning: null,
        },
      ],
    });
    expect(client.getQueryData(modelsKeys.available())).not.toBeUndefined();

    // Reconfigure to model B succeeds → the callback fires.
    result.current();

    // `resetQueries` (no active observer here) clears the cache entirely —
    // an immediate read after this write sees NOTHING stale from model A,
    // unlike `invalidateQueries`, which would keep serving A's cached data
    // until B's refetch settles.
    expect(client.getQueryData(modelsKeys.available())).toBeUndefined();
  });
});
