/**
 * Unit tests for the S8 graph-extraction layer (`entity-extraction.ts`):
 * `$`-canonicalization (pure), the `extractEntities` LLM-call contract
 * (stub provider — brace-JSON, strict schema, fail-loud), and `buildGraphPlan`
 * with fully-stubbed deps — pinning D-FAIL-OPEN (ANY error → null, promotion
 * proceeds), the F2 alias discipline (merge ONLY on the identical normalized
 * identity; existing entity → alias growth, no embed; new → embed stamped from
 * the response), and the edge endpoint/self-loop resolution after
 * canonicalization. No DB, no real OpenRouter, no embeddings sidecar.
 */

import { describe, it, expect, vi } from "vitest";

import {
  buildGraphPlan,
  canonicalizeDollarName,
  extractEntities,
  type ExtractionLesson,
  type GraphLessonCandidate,
  type GraphPlanDeps,
} from "@vex-agent/memory/manager/entity-extraction.js";
import type { EntityExtraction } from "@vex-agent/memory/manager/entity-extraction-schema.js";
import type { JudgeProvider } from "@vex-agent/memory/manager/judge.js";

// ── Builders ──────────────────────────────────────────────────────

const CANDIDATE: GraphLessonCandidate = {
  id: "11111111-1111-1111-1111-111111111111",
  kind: "trade_lesson",
  title: "WIF dips recover on Jupiter routing",
  summary: "A durable lesson about WIF liquidity.",
  contentMd: "Process narrative.",
};

const REGIME = { regimeTags: ["bull"] as const };

function extractionOf(overrides: Partial<EntityExtraction> = {}): EntityExtraction {
  return {
    entities: [
      { name: "WIF", type: "token", aliases: ["dogwifhat"], summary: "memecoin" },
      { name: "Jupiter", type: "protocol", aliases: [], summary: undefined },
    ],
    edges: [{ source: "WIF", target: "Jupiter", relation: "traded_on", fact: "routed via JUP" }],
    ...overrides,
  };
}

function stubGraphDeps(args: {
  extraction?: EntityExtraction | Error;
  activeIds?: Record<string, string>; // `${type}:${normName}` → existing entity id
  embedError?: Error;
}) {
  const extractEntitiesStub = vi.fn(async (_lesson: ExtractionLesson): Promise<EntityExtraction> => {
    if (args.extraction instanceof Error) throw args.extraction;
    return args.extraction ?? extractionOf();
  });
  const findActiveEntity = vi.fn(async (entityType: string, normalizedName: string) => {
    const id = (args.activeIds ?? {})[`${entityType}:${normalizedName}`];
    return id === undefined ? null : { id };
  });
  const embedEntityName = vi.fn(async (_name: string, _summary: string) => {
    if (args.embedError) throw args.embedError;
    return { embedding: [0.1, 0.2, 0.3], providerModel: "test-embed-model" };
  });
  const deps: GraphPlanDeps = {
    extractEntities: extractEntitiesStub,
    findActiveEntity,
    embedEntityName,
  };
  return { deps, extractEntitiesStub, findActiveEntity, embedEntityName };
}

// ── $-canonicalization (pure — D-WRITE / critique L3) ─────────────

describe("canonicalizeDollarName", () => {
  it("strips a leading $ into the canonical name and keeps $XXX as an alias", () => {
    expect(canonicalizeDollarName("$WIF", ["dogwifhat"])).toEqual({
      name: "WIF",
      aliases: ["dogwifhat", "$WIF"],
    });
  });

  it("passes non-$ names through unchanged", () => {
    expect(canonicalizeDollarName("Jupiter", ["JUP"])).toEqual({
      name: "Jupiter",
      aliases: ["JUP"],
    });
  });

  it("drops a name that is nothing but $/whitespace", () => {
    expect(canonicalizeDollarName("$", [])).toBeNull();
    expect(canonicalizeDollarName("$$$", [])).toBeNull();
    expect(canonicalizeDollarName("$   ", [])).toBeNull();
  });

  it("collapses repeated leading $ and dedupes the alias set", () => {
    expect(canonicalizeDollarName("$$WIF", ["$$WIF"])).toEqual({
      name: "WIF",
      aliases: ["$$WIF"],
    });
  });
});

// ── extractEntities (stub provider — judge.ts call pattern) ───────

function stubProvider(content: string, config: unknown = {}): () => Promise<JudgeProvider> {
  return async () => ({
    loadConfig: async () => config,
    chatCompletionSimple: async () => ({ content }),
  });
}

const LESSON: ExtractionLesson = {
  kind: "trade_lesson",
  title: "t",
  summary: "s",
  contentMd: "c",
  regimeTags: ["bull"],
};

describe("extractEntities — LLM boundary (fail-loud, caller fails open)", () => {
  it("parses a strict-JSON response (with prose around the braces)", async () => {
    const json = JSON.stringify({
      entities: [{ name: "WIF", type: "token", aliases: ["$WIF"] }],
      edges: [],
    });
    const out = await extractEntities(LESSON, stubProvider(`Sure! Here it is:\n${json}\nDone.`));
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0]!.name).toBe("WIF");
  });

  it("throws on a response without JSON braces", async () => {
    await expect(extractEntities(LESSON, stubProvider("no json here"))).rejects.toThrow(
      /malformed_json/,
    );
  });

  it("throws on unparseable JSON", async () => {
    await expect(extractEntities(LESSON, stubProvider("{not valid json}"))).rejects.toThrow(
      /malformed_json/,
    );
  });

  it("throws on a schema violation (out-of-vocab type)", async () => {
    const bad = JSON.stringify({ entities: [{ name: "WIF", type: "memecoin" }] });
    await expect(extractEntities(LESSON, stubProvider(bad))).rejects.toThrow(/schema_invalid/);
  });

  it("throws when the provider config cannot load", async () => {
    await expect(extractEntities(LESSON, stubProvider("{}", null))).rejects.toThrow(
      /config_load_failed/,
    );
  });
});

// ── buildGraphPlan (D-FAIL-OPEN + F2 + edge resolution) ───────────

describe("buildGraphPlan — fail-open (graph is help, not truth)", () => {
  it("returns null when the extraction call throws (LLM outage) — promotion proceeds", async () => {
    const s = stubGraphDeps({ extraction: new Error("memory_extraction_timeout") });
    expect(await buildGraphPlan(CANDIDATE, REGIME, s.deps)).toBeNull();
  });

  it("returns null when the name embedding throws (sidecar outage)", async () => {
    const s = stubGraphDeps({ embedError: new Error("embedding service unavailable") });
    expect(await buildGraphPlan(CANDIDATE, REGIME, s.deps)).toBeNull();
  });

  it("returns null on an empty extraction (nothing to assert — not an error)", async () => {
    const s = stubGraphDeps({ extraction: { entities: [], edges: [] } });
    expect(await buildGraphPlan(CANDIDATE, REGIME, s.deps)).toBeNull();
  });

  it("forwards the candidate text + verdict regimeTags to the extraction call", async () => {
    const s = stubGraphDeps({});
    await buildGraphPlan(CANDIDATE, REGIME, s.deps);
    expect(s.extractEntitiesStub).toHaveBeenCalledTimes(1);
    expect(s.extractEntitiesStub.mock.calls[0]![0]).toEqual({
      kind: CANDIDATE.kind,
      title: CANDIDATE.title,
      summary: CANDIDATE.summary,
      contentMd: CANDIDATE.contentMd,
      regimeTags: ["bull"],
    });
  });
});

describe("buildGraphPlan — F2 alias discipline (deterministic identity, zero fuzzy)", () => {
  it("plans alias growth WITHOUT an embedding for an existing active identity", async () => {
    const s = stubGraphDeps({ activeIds: { "token:wif": "existing-uuid" } });
    const plan = await buildGraphPlan(CANDIDATE, REGIME, s.deps);
    expect(plan).not.toBeNull();

    const wif = plan!.entities.find((e) => e.key === "token:wif");
    expect(wif).toEqual({
      kind: "existing",
      key: "token:wif",
      entityId: "existing-uuid",
      aliases: ["dogwifhat"],
    });
    // The protocol entity is NEW → exactly ONE embed call (never for existing).
    expect(s.embedEntityName).toHaveBeenCalledTimes(1);
    expect(s.embedEntityName).toHaveBeenCalledWith("Jupiter", "");
  });

  it("plans a NEW entity with the embedding model + dim stamped from the response", async () => {
    const s = stubGraphDeps({});
    const plan = await buildGraphPlan(CANDIDATE, REGIME, s.deps);
    const jupiter = plan!.entities.find((e) => e.key === "protocol:jupiter");
    expect(jupiter).toMatchObject({
      kind: "new",
      entityType: "protocol",
      name: "Jupiter",
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: "test-embed-model",
      embeddingDim: 3,
    });
  });

  it("merges entities ONLY on the identical normalized identity (aliases unioned)", async () => {
    const s = stubGraphDeps({
      extraction: {
        entities: [
          { name: "WIF", type: "token", aliases: ["dogwifhat"], summary: "memecoin" },
          { name: "  wif ", type: "token", aliases: ["$WIF"], summary: undefined },
          // Same surface name, DIFFERENT type → a DIFFERENT identity (no fuzzy).
          { name: "WIF", type: "concept", aliases: [], summary: undefined },
        ],
        edges: [],
      },
    });
    const plan = await buildGraphPlan(CANDIDATE, REGIME, s.deps);
    expect(plan!.entities.map((e) => e.key).sort()).toEqual(["concept:wif", "token:wif"]);
    const merged = plan!.entities.find((e) => e.key === "token:wif");
    expect(merged!.aliases).toEqual(["dogwifhat", "$WIF"]);
    // One link per planned entity, mentionCount 1.
    expect(plan!.links).toEqual([
      { key: "token:wif", mentionCount: 1 },
      { key: "concept:wif", mentionCount: 1 },
    ]);
  });

  it("$-canonicalizes '$SOL' into the 'SOL' identity and drops the collapsed self-edge", async () => {
    const s = stubGraphDeps({
      extraction: {
        entities: [
          { name: "$SOL", type: "token", aliases: [], summary: undefined },
          { name: "SOL", type: "token", aliases: [], summary: undefined },
        ],
        // Declared as two entities, but canonicalization collapses them — the
        // edge becomes a self-loop and MUST be dropped.
        edges: [{ source: "$SOL", target: "SOL", relation: "related_to", fact: undefined }],
      },
    });
    const plan = await buildGraphPlan(CANDIDATE, REGIME, s.deps);
    expect(plan!.entities).toHaveLength(1);
    expect(plan!.entities[0]!.key).toBe("token:sol");
    expect(plan!.entities[0]!.aliases).toContain("$SOL");
    expect(plan!.edges).toEqual([]);
  });
});

describe("buildGraphPlan — edge resolution", () => {
  it("resolves edge endpoints to plan keys and carries relation + fact", async () => {
    const s = stubGraphDeps({});
    const plan = await buildGraphPlan(CANDIDATE, REGIME, s.deps);
    expect(plan!.edges).toEqual([
      {
        sourceKey: "token:wif",
        targetKey: "protocol:jupiter",
        relation: "traded_on",
        fact: "routed via JUP",
      },
    ]);
  });

  it("drops an edge whose endpoint entity was dropped ($-only name)", async () => {
    const s = stubGraphDeps({
      extraction: {
        entities: [
          { name: "$", type: "token", aliases: [], summary: undefined },
          { name: "Jupiter", type: "protocol", aliases: [], summary: undefined },
        ],
        edges: [{ source: "$", target: "Jupiter", relation: "uses", fact: undefined }],
      },
    });
    const plan = await buildGraphPlan(CANDIDATE, REGIME, s.deps);
    expect(plan!.entities.map((e) => e.key)).toEqual(["protocol:jupiter"]);
    expect(plan!.edges).toEqual([]);
  });

  it("dedupes edges on the (source, target, relation) triple — never asserts twice", async () => {
    const s = stubGraphDeps({
      extraction: extractionOf({
        edges: [
          { source: "WIF", target: "Jupiter", relation: "traded_on", fact: "first" },
          { source: "WIF", target: "Jupiter", relation: "traded_on", fact: "second" },
          { source: "WIF", target: "Jupiter", relation: "uses", fact: undefined },
        ],
      }),
    });
    const plan = await buildGraphPlan(CANDIDATE, REGIME, s.deps);
    expect(plan!.edges).toHaveLength(2);
    expect(plan!.edges[0]!.fact).toBe("first"); // first declaration wins
  });
});
