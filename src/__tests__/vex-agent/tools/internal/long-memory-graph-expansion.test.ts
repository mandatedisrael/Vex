/**
 * Unit tests for `expandViaGraph` (S8 / D-EXPAND) — the 1-hop graph expansion
 * behind `long_memory_search`. ALL repo IO is injected via `GraphExpansionDeps`
 * stubs (no module mocks, no DB): these tests pin the pure orchestration —
 * seed selection + the ≤0-score guard, the hard caps (seeds / entities /
 * results), dedupe vs already-returned ids, slot-filling (never more than the
 * free slots), scoring strictly below the seed, and the empty-graph shortcut.
 */

import { describe, it, expect, vi } from "vitest";

import {
  expandViaGraph,
  type GraphExpansionDeps,
} from "@vex-agent/tools/internal/long-memory/search.js";
import {
  GRAPH_EXPANSION_MAX_ENTITIES,
  GRAPH_EXPANSION_MAX_RESULTS,
  GRAPH_EXPANSION_MAX_SEEDS,
  GRAPH_VIA_ENTITY_MAX,
  type LongMemoryResult,
  type LongMemoryKnowledgeResult,
  type LongMemoryCandidateResult,
} from "@vex-agent/memory/long-memory-retrieval-policy.js";
import type { GraphNeighborEntry } from "@vex-agent/db/repos/knowledge.js";
import type {
  EntryEntityLink,
  EntityEntryRef,
} from "@vex-agent/db/repos/memory-entry-entities/index.js";
import type { MemoryEdge } from "@vex-agent/db/repos/memory-edges/index.js";

// ── Builders ──────────────────────────────────────────────────────

function seed(id: number, score: number): LongMemoryKnowledgeResult {
  return {
    source: "long_memory",
    id,
    kind: "trade_lesson",
    title: `Seed ${id}`,
    summary: "s",
    contentMd: "",
    similarity: 0.8,
    score,
    sourceTier: "observed",
    maturityState: "established",
    activationStrength: 1,
    tags: [],
    validUntil: null,
    evidenceRefs: {},
    rerankScore: score,
  };
}

function candidateResult(score: number): LongMemoryCandidateResult {
  return {
    source: "memory_candidate",
    id: "11111111-1111-1111-1111-111111111111",
    kind: "trade_lesson",
    title: "C",
    summary: "s",
    contentMd: "",
    similarity: 0.8,
    score,
    notConsolidated: true,
    sourceTier: "observed",
    tags: [],
    evidenceRefs: [],
    retrievalUntil: null,
  };
}

function neighborEntry(id: number, overrides: Partial<GraphNeighborEntry> = {}): GraphNeighborEntry {
  return {
    id,
    kind: "trade_lesson",
    title: `Neighbor ${id}`,
    summary: "s",
    source: "observed",
    maturityState: "established",
    activationStrength: 1,
    validUntil: null,
    ...overrides,
  };
}

/** A fully-typed ACTIVE edge — the expansion reads only the endpoint ids. */
function edge(sourceEntityId: string, targetEntityId: string): MemoryEdge {
  const now = new Date().toISOString();
  return {
    id: `edge-${sourceEntityId}-${targetEntityId}`,
    sourceEntityId,
    targetEntityId,
    relation: "related_to",
    fact: "",
    embeddingModel: null,
    embeddingDim: null,
    originEntryId: null,
    validFrom: now,
    validUntil: null,
    invalidatedAt: null,
    supersededByEdgeId: null,
    createdAt: now,
    updatedAt: now,
  };
}

interface StubGraph {
  links?: EntryEntityLink[];
  edges?: MemoryEdge[];
  refs?: EntityEntryRef[];
  entries?: GraphNeighborEntry[];
}

function stubDeps(graph: StubGraph = {}) {
  const listEntityIdsForEntries = vi.fn(
    async (_entryIds: readonly number[]): Promise<EntryEntityLink[]> => graph.links ?? [],
  );
  const listActiveEdgesForEntities = vi.fn(
    async (_entityIds: readonly string[], _limitPerSide: number): Promise<MemoryEdge[]> =>
      graph.edges ?? [],
  );
  const listEntryIdsForEntities = vi.fn(
    async (_entityIds: readonly string[], _limit: number): Promise<EntityEntryRef[]> =>
      graph.refs ?? [],
  );
  // Faithful to the SQL contract: returns ONLY rows whose id was requested.
  const getActiveEntriesByIds = vi.fn(
    async (ids: readonly number[]): Promise<GraphNeighborEntry[]> =>
      (graph.entries ?? []).filter((e) => ids.includes(e.id)),
  );
  const deps: GraphExpansionDeps = {
    listEntityIdsForEntries,
    listActiveEdgesForEntities,
    listEntryIdsForEntities,
    getActiveEntriesByIds,
  };
  return {
    deps,
    listEntityIdsForEntries,
    listActiveEdgesForEntities,
    listEntryIdsForEntities,
    getActiveEntriesByIds,
  };
}

/** One seed (entry 1) → entity e1 —edge→ entity e2 → entries `neighborIds`. */
function oneHopGraph(neighborIds: number[], entityName = "SOL"): StubGraph {
  return {
    links: [{ entryId: 1, entityId: "e1" }],
    edges: [edge("e1", "e2")],
    refs: neighborIds.map((id) => ({ entryId: id, entityId: "e2", entityName })),
    entries: neighborIds.map((id) => neighborEntry(id)),
  };
}

const NO_RETURNED = new Set<number>();

// ── Guards ────────────────────────────────────────────────────────

describe("expandViaGraph — guards", () => {
  it("returns empty without touching the graph when remainingSlots ≤ 0", async () => {
    const s = stubDeps(oneHopGraph([2]));
    for (const slots of [0, -1]) {
      const out = await expandViaGraph([seed(1, 0.8)], NO_RETURNED, slots, s.deps);
      expect(out).toEqual({ results: [], dropped: 0, seedCount: 0 });
    }
    expect(s.listEntityIdsForEntries).not.toHaveBeenCalled();
  });

  it("skips seeds with score ≤ 0 entirely (Codex R1 guard — strict inequality needs positive seeds)", async () => {
    const s = stubDeps(oneHopGraph([2]));
    const out = await expandViaGraph([seed(1, 0), seed(3, -0.5)], NO_RETURNED, 5, s.deps);
    expect(out).toEqual({ results: [], dropped: 0, seedCount: 0 });
    expect(s.listEntityIdsForEntries).not.toHaveBeenCalled();
  });

  it("ignores candidate results as seeds (only knowledge entries seed the graph)", async () => {
    const s = stubDeps(oneHopGraph([2]));
    const out = await expandViaGraph([candidateResult(0.9)], NO_RETURNED, 5, s.deps);
    expect(out).toEqual({ results: [], dropped: 0, seedCount: 0 });
    expect(s.listEntityIdsForEntries).not.toHaveBeenCalled();
  });

  it("returns [] on an empty graph (no entity links) — pre-S8 behavior preserved", async () => {
    const s = stubDeps({});
    const out = await expandViaGraph([seed(1, 0.8)], NO_RETURNED, 5, s.deps);
    expect(out).toEqual({ results: [], dropped: 0, seedCount: 1 });
    expect(s.listActiveEdgesForEntities).not.toHaveBeenCalled();
  });

  it("returns [] when edges only connect seed entities to each other (no NEW neighbor)", async () => {
    const s = stubDeps({
      links: [
        { entryId: 1, entityId: "e1" },
        { entryId: 1, entityId: "e2" },
      ],
      edges: [edge("e1", "e2")],
    });
    const out = await expandViaGraph([seed(1, 0.8)], NO_RETURNED, 5, s.deps);
    expect(out).toEqual({ results: [], dropped: 0, seedCount: 1 });
    expect(s.listEntryIdsForEntities).not.toHaveBeenCalled();
  });
});

// ── Caps ──────────────────────────────────────────────────────────

describe("expandViaGraph — hard caps", () => {
  it("uses at most GRAPH_EXPANSION_MAX_SEEDS top results as seeds", async () => {
    const s = stubDeps({});
    const seeds: LongMemoryResult[] = Array.from({ length: GRAPH_EXPANSION_MAX_SEEDS + 3 }, (_, i) =>
      seed(i + 1, 1 - i * 0.05),
    );
    const out = await expandViaGraph(seeds, NO_RETURNED, 5, s.deps);
    expect(out.seedCount).toBe(GRAPH_EXPANSION_MAX_SEEDS);
    const queriedEntryIds = s.listEntityIdsForEntries.mock.calls[0]![0];
    expect(queriedEntryIds).toHaveLength(GRAPH_EXPANSION_MAX_SEEDS);
    expect(queriedEntryIds).toEqual([1, 2, 3, 4, 5]);
  });

  it("caps the seed entities handed to the edge query at GRAPH_EXPANSION_MAX_ENTITIES", async () => {
    const links: EntryEntityLink[] = Array.from(
      { length: GRAPH_EXPANSION_MAX_ENTITIES + 4 },
      (_, i) => ({ entryId: 1, entityId: `e${i}` }),
    );
    const s = stubDeps({ links });
    await expandViaGraph([seed(1, 0.8)], NO_RETURNED, 5, s.deps);
    const queriedEntityIds = s.listActiveEdgesForEntities.mock.calls[0]![0];
    expect(queriedEntityIds).toHaveLength(GRAPH_EXPANSION_MAX_ENTITIES);
  });

  it("caps results at min(remainingSlots, GRAPH_EXPANSION_MAX_RESULTS) and counts the drop", async () => {
    const neighborIds = Array.from({ length: GRAPH_EXPANSION_MAX_RESULTS + 3 }, (_, i) => 100 + i);
    const s = stubDeps(oneHopGraph(neighborIds));

    // Plenty of slots → MAX_RESULTS caps.
    const wide = await expandViaGraph([seed(1, 0.8)], NO_RETURNED, 100, s.deps);
    expect(wide.results).toHaveLength(GRAPH_EXPANSION_MAX_RESULTS);
    expect(wide.dropped).toBe(3);

    // Fewer free slots than MAX_RESULTS → slots cap (fills, never evicts).
    const narrow = await expandViaGraph([seed(1, 0.8)], NO_RETURNED, 2, s.deps);
    expect(narrow.results).toHaveLength(2);
    expect(narrow.dropped).toBe(GRAPH_EXPANSION_MAX_RESULTS + 3 - 2);
  });
});

// ── Dedupe + mapping + scoring ────────────────────────────────────

describe("expandViaGraph — dedupe, mapping, scoring", () => {
  it("never returns an entry that was already returned directly", async () => {
    const s = stubDeps(oneHopGraph([2, 3]));
    const out = await expandViaGraph([seed(1, 0.8)], new Set([3]), 5, s.deps);
    expect(out.results.map((r) => r.id)).toEqual([2]);
  });

  it("marks every result via:'graph' with the via-entity name, truncated to GRAPH_VIA_ENTITY_MAX", async () => {
    const longName = "X".repeat(GRAPH_VIA_ENTITY_MAX + 30);
    const s = stubDeps(oneHopGraph([2], longName));
    const out = await expandViaGraph([seed(1, 0.8)], NO_RETURNED, 5, s.deps);
    expect(out.results).toHaveLength(1);
    const r = out.results[0]!;
    expect(r.via).toBe("graph");
    expect(r.viaEntity).toBe("X".repeat(GRAPH_VIA_ENTITY_MAX));
    expect(r.contentMd).toBe(""); // bounded pointer — never inlines content
  });

  it("scores every neighbor STRICTLY below its seed and sorts score-DESC", async () => {
    const seedScore = 0.9;
    const s = stubDeps({
      links: [{ entryId: 1, entityId: "e1" }],
      edges: [edge("e1", "e2")],
      refs: [
        { entryId: 2, entityId: "e2", entityName: "SOL" },
        { entryId: 3, entityId: "e2", entityName: "SOL" },
      ],
      entries: [
        neighborEntry(2, { source: "hypothesis", activationStrength: 0.2 }),
        neighborEntry(3, { source: "observed", activationStrength: 1 }),
      ],
    });
    const out = await expandViaGraph([seed(1, seedScore)], NO_RETURNED, 5, s.deps);
    expect(out.results).toHaveLength(2);
    for (const r of out.results) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThan(seedScore);
    }
    // The credible neighbor (observed, full activation) outranks the weak one.
    expect(out.results.map((r) => r.id)).toEqual([3, 2]);
  });

  it("propagates the BEST seed score when a neighbor is reachable from several seeds", async () => {
    const s = stubDeps({
      links: [
        { entryId: 1, entityId: "e1" },
        { entryId: 4, entityId: "e3" },
      ],
      edges: [edge("e1", "e2"), edge("e3", "e2")],
      refs: [{ entryId: 2, entityId: "e2", entityName: "SOL" }],
      entries: [neighborEntry(2)],
    });
    const weak = seed(4, 0.2);
    const strong = seed(1, 0.9);
    const out = await expandViaGraph([strong, weak], NO_RETURNED, 5, s.deps);
    expect(out.results).toHaveLength(1);
    // observed + activation 1 → graphScore = bestSeed × GRAPH_HOP_DECAY × 1 × 1.
    expect(out.results[0]!.score).toBeCloseTo(0.9 * 0.5, 10);
  });

  it("follows edges in BOTH directions (neighbor as edge source)", async () => {
    const s = stubDeps({
      links: [{ entryId: 1, entityId: "e1" }],
      // The neighbor entity is the SOURCE; the seed entity is the target.
      edges: [edge("e2", "e1")],
      refs: [{ entryId: 2, entityId: "e2", entityName: "SOL" }],
      entries: [neighborEntry(2)],
    });
    const out = await expandViaGraph([seed(1, 0.8)], NO_RETURNED, 5, s.deps);
    expect(out.results.map((r) => r.id)).toEqual([2]);
  });

  it("drops neighbors the active-entry fetch filtered out (inactive/expired in SQL)", async () => {
    const graph = oneHopGraph([2, 3]);
    graph.entries = [neighborEntry(2)]; // entry 3 not active → absent from the DTO fetch
    const s = stubDeps(graph);
    const out = await expandViaGraph([seed(1, 0.8)], NO_RETURNED, 5, s.deps);
    expect(out.results.map((r) => r.id)).toEqual([2]);
  });
});
