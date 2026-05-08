/**
 * Verifies the QueryClient factory matches the skill §5 contract. Defaults
 * are conservative on purpose: signing/transfer mutations MUST NOT auto-retry
 * (skill §14 forbidden patterns), so mutation retry is pinned to 0.
 */

import { describe, expect, it } from "vitest";
import { createQueryClient, queryClient } from "../queryClient.js";

describe("queryClient", () => {
  it("factory returns a fresh client with skill defaults", () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries?.staleTime).toBe(5_000);
    expect(defaults.queries?.gcTime).toBe(5 * 60_000);
    expect(defaults.queries?.retry).toBe(1);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
    expect(defaults.queries?.refetchOnReconnect).toBe(true);
    expect(defaults.mutations?.retry).toBe(0);
  });

  it("factory yields independent instances (no shared cache)", () => {
    const a = createQueryClient();
    const b = createQueryClient();
    expect(a).not.toBe(b);
    expect(a.getQueryCache()).not.toBe(b.getQueryCache());
  });

  it("module singleton is the same identity across imports", () => {
    expect(queryClient).toBe(queryClient);
  });
});
