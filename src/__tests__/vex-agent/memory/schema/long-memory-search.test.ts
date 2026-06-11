/**
 * Boundary tests for the `long_memory_search` input schema — pins the S8 (F3)
 * default flip: `expandGraph` defaults to TRUE (graph expansion is on unless
 * the agent explicitly disables it), alongside the other defaults the handler
 * relies on. Pure Zod — no DB, no handler.
 */

import { describe, it, expect } from "vitest";

import {
  longMemorySearchInputSchema,
} from "@vex-agent/memory/schema/long-memory-search.js";
import { LONG_MEMORY_DEFAULT_K } from "@vex-agent/memory/long-memory-retrieval-policy.js";

describe("longMemorySearchInputSchema — defaults", () => {
  it("defaults expandGraph to TRUE (S8 / F3 — graph expansion is opt-out)", () => {
    const parsed = longMemorySearchInputSchema.parse({ query: "risk rules" });
    expect(parsed.expandGraph).toBe(true);
    // Companion defaults the handler relies on (unchanged by S8).
    expect(parsed.includeCandidates).toBe(true);
    expect(parsed.responseFormat).toBe("concise");
    expect(parsed.k).toBe(LONG_MEMORY_DEFAULT_K);
  });

  it("respects an explicit expandGraph=false opt-out", () => {
    const parsed = longMemorySearchInputSchema.parse({ query: "x", expandGraph: false });
    expect(parsed.expandGraph).toBe(false);
  });

  it("rejects a non-boolean expandGraph", () => {
    expect(
      longMemorySearchInputSchema.safeParse({ query: "x", expandGraph: "yes" }).success,
    ).toBe(false);
  });
});
