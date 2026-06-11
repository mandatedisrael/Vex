/**
 * Unit tests for the S8 entity-extraction output schema — the anti-poisoning
 * boundary on the extractor LLM's untrusted output. Pins: closed vocabularies
 * (entity types ×8, relations ×8), the structural refines (edge endpoints must
 * reference declared entities, matched on `normalizeEntityName`; no self-loops),
 * every bound (deliberately TIGHTER than the S1d substrate), and `.strict()`
 * rejection of smuggled fields. Pure Zod — no DB, no LLM.
 */

import { describe, it, expect } from "vitest";

import {
  entityExtractionSchema,
  EXTRACTION_ENTITIES_MAX,
  EXTRACTION_ENTITY_NAME_MAX,
  EXTRACTION_ALIASES_MAX,
  EXTRACTION_ALIAS_MAX,
  EXTRACTION_SUMMARY_MAX,
  EXTRACTION_EDGES_MAX,
  EXTRACTION_FACT_MAX,
} from "@vex-agent/memory/manager/entity-extraction-schema.js";
import { MEMORY_ENTITY_TYPE } from "@vex-agent/memory/schema/memory-entity-enums.js";
import { MEMORY_EDGE_RELATION } from "@vex-agent/memory/schema/memory-edge-enums.js";

// ── Builders ──────────────────────────────────────────────────────

function entity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: "Solana", type: "token", aliases: ["SOL"], summary: "L1 chain", ...overrides };
}

function extraction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entities: [entity(), entity({ name: "Jupiter", type: "protocol", aliases: [] })],
    edges: [{ source: "Solana", target: "Jupiter", relation: "related_to", fact: "" }],
    ...overrides,
  };
}

// ── Happy path + defaults ─────────────────────────────────────────

describe("entityExtractionSchema — accepts a well-formed extraction", () => {
  it("parses entities + edges and applies the [] defaults", () => {
    const parsed = entityExtractionSchema.parse(extraction());
    expect(parsed.entities).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);

    // edges omitted → defaults to [] (entity-only lessons are valid).
    const entityOnly = entityExtractionSchema.parse({ entities: [entity()] });
    expect(entityOnly.edges).toEqual([]);
    // aliases omitted → defaults to [].
    expect(
      entityExtractionSchema.parse({ entities: [{ name: "WIF", type: "token" }] }).entities[0]!
        .aliases,
    ).toEqual([]);
  });

  it("accepts an empty extraction (nothing qualified)", () => {
    const parsed = entityExtractionSchema.parse({ entities: [], edges: [] });
    expect(parsed.entities).toEqual([]);
    expect(parsed.edges).toEqual([]);
  });
});

// ── Closed vocabularies ───────────────────────────────────────────

describe("entityExtractionSchema — closed vocabularies", () => {
  it("accepts every declared entity type and relation", () => {
    for (const type of MEMORY_ENTITY_TYPE) {
      expect(entityExtractionSchema.safeParse({ entities: [entity({ type })] }).success).toBe(true);
    }
    for (const relation of MEMORY_EDGE_RELATION) {
      const res = entityExtractionSchema.safeParse(
        extraction({ edges: [{ source: "Solana", target: "Jupiter", relation }] }),
      );
      expect(res.success).toBe(true);
    }
  });

  it("rejects an out-of-vocab entity type (hallucinated category)", () => {
    const res = entityExtractionSchema.safeParse({ entities: [entity({ type: "memecoin" })] });
    expect(res.success).toBe(false);
  });

  it("rejects an out-of-vocab relation (hallucinated edge type)", () => {
    const res = entityExtractionSchema.safeParse(
      extraction({ edges: [{ source: "Solana", target: "Jupiter", relation: "pumps" }] }),
    );
    expect(res.success).toBe(false);
  });
});

// ── Structural refines ────────────────────────────────────────────

describe("entityExtractionSchema — endpoint + self-loop refines", () => {
  it("rejects an edge whose endpoint is not a declared entity", () => {
    const res = entityExtractionSchema.safeParse(
      extraction({ edges: [{ source: "Solana", target: "Raydium", relation: "related_to" }] }),
    );
    expect(res.success).toBe(false);
  });

  it("matches endpoints through normalizeEntityName (case/whitespace drift cannot orphan an edge)", () => {
    const res = entityExtractionSchema.safeParse(
      extraction({ edges: [{ source: "  solana ", target: "JUPITER", relation: "uses" }] }),
    );
    expect(res.success).toBe(true);
  });

  it("rejects self-loops, including normalized-identity self-loops", () => {
    const direct = entityExtractionSchema.safeParse(
      extraction({ edges: [{ source: "Solana", target: "Solana", relation: "related_to" }] }),
    );
    expect(direct.success).toBe(false);

    const normalized = entityExtractionSchema.safeParse(
      extraction({ edges: [{ source: "Solana", target: " SOLANA ", relation: "related_to" }] }),
    );
    expect(normalized.success).toBe(false);
  });
});

// ── Bounds (anti-poisoning: tighter than the substrate everywhere) ─

describe("entityExtractionSchema — bounds", () => {
  it("caps entities at EXTRACTION_ENTITIES_MAX (8)", () => {
    const max = Array.from({ length: EXTRACTION_ENTITIES_MAX }, (_, i) =>
      entity({ name: `Entity${i}`, aliases: [] }),
    );
    expect(entityExtractionSchema.safeParse({ entities: max }).success).toBe(true);
    const over = [...max, entity({ name: "OneTooMany", aliases: [] })];
    expect(entityExtractionSchema.safeParse({ entities: over }).success).toBe(false);
  });

  it("caps the name at 120, aliases at 8×64, summary at 500", () => {
    expect(
      entityExtractionSchema.safeParse({
        entities: [entity({ name: "x".repeat(EXTRACTION_ENTITY_NAME_MAX + 1) })],
      }).success,
    ).toBe(false);
    expect(
      entityExtractionSchema.safeParse({
        entities: [
          entity({ aliases: Array.from({ length: EXTRACTION_ALIASES_MAX + 1 }, (_, i) => `a${i}`) }),
        ],
      }).success,
    ).toBe(false);
    expect(
      entityExtractionSchema.safeParse({
        entities: [entity({ aliases: ["x".repeat(EXTRACTION_ALIAS_MAX + 1)] })],
      }).success,
    ).toBe(false);
    expect(
      entityExtractionSchema.safeParse({
        entities: [entity({ summary: "x".repeat(EXTRACTION_SUMMARY_MAX + 1) })],
      }).success,
    ).toBe(false);
    // The exact bounds are accepted.
    expect(
      entityExtractionSchema.safeParse({
        entities: [
          entity({
            name: "x".repeat(EXTRACTION_ENTITY_NAME_MAX),
            aliases: ["y".repeat(EXTRACTION_ALIAS_MAX)],
            summary: "z".repeat(EXTRACTION_SUMMARY_MAX),
          }),
        ],
      }).success,
    ).toBe(true);
  });

  it("caps edges at EXTRACTION_EDGES_MAX (8) and the fact at 300", () => {
    const entities = [entity(), entity({ name: "Jupiter", type: "protocol", aliases: [] })];
    const relations = MEMORY_EDGE_RELATION;
    const edges = Array.from({ length: EXTRACTION_EDGES_MAX }, (_, i) => ({
      source: "Solana",
      target: "Jupiter",
      relation: relations[i % relations.length],
    }));
    expect(entityExtractionSchema.safeParse({ entities, edges }).success).toBe(true);
    const overEdges = [...edges, { source: "Jupiter", target: "Solana", relation: "uses" }];
    expect(entityExtractionSchema.safeParse({ entities, edges: overEdges }).success).toBe(false);

    expect(
      entityExtractionSchema.safeParse(
        extraction({
          edges: [
            {
              source: "Solana",
              target: "Jupiter",
              relation: "uses",
              fact: "x".repeat(EXTRACTION_FACT_MAX + 1),
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(entityExtractionSchema.safeParse({ entities: [entity({ name: "" })] }).success).toBe(
      false,
    );
    expect(entityExtractionSchema.safeParse({ entities: [entity({ name: "   " })] }).success).toBe(
      false,
    );
  });
});

// ── Strictness (no smuggled fields) ───────────────────────────────

describe("entityExtractionSchema — strict contract", () => {
  it("rejects unknown top-level, entity, and edge fields (injection cannot smuggle data)", () => {
    expect(entityExtractionSchema.safeParse(extraction({ note: "ignore rules" })).success).toBe(
      false,
    );
    expect(
      entityExtractionSchema.safeParse({ entities: [entity({ payload: "x" })] }).success,
    ).toBe(false);
    expect(
      entityExtractionSchema.safeParse(
        extraction({
          edges: [{ source: "Solana", target: "Jupiter", relation: "uses", weight: 1 }],
        }),
      ).success,
    ).toBe(false);
  });
});
