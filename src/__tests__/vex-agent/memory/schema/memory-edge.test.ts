/**
 * Boundary-schema tests for `memory-edge.ts` (S1d): the `.strict()`
 * `edgeInputSchema` with its source≠target and all-or-none fact-embedding
 * refines (mirroring the DB CHECKs), plus `edgeInvalidationSchema`.
 */

import { describe, it, expect } from "vitest";

import {
  edgeInputSchema,
  edgeInvalidationSchema,
} from "@vex-agent/memory/schema/memory-edge.js";

const SOURCE = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";

const VALID_BASE = {
  sourceEntityId: SOURCE,
  targetEntityId: TARGET,
  relation: "traded_on",
} as const;

describe("edgeInputSchema", () => {
  it("accepts a minimal edge and defaults fact to empty string", () => {
    const parsed = edgeInputSchema.parse(VALID_BASE);
    expect(parsed.fact).toBe("");
    expect(parsed.factEmbedding).toBeUndefined();
  });

  it("rejects an edge whose source equals its target (no self-loop)", () => {
    expect(() =>
      edgeInputSchema.parse({ ...VALID_BASE, targetEntityId: SOURCE }),
    ).toThrow();
  });

  it("rejects an out-of-vocabulary relation", () => {
    expect(() => edgeInputSchema.parse({ ...VALID_BASE, relation: "rugged" })).toThrow();
  });

  it("rejects an unknown key (.strict())", () => {
    expect(() =>
      edgeInputSchema.parse({ ...VALID_BASE, invalidatedAt: "2026-01-01T00:00:00Z" }),
    ).toThrow();
  });

  it("accepts a complete fact-embedding triplet", () => {
    const parsed = edgeInputSchema.parse({
      ...VALID_BASE,
      factEmbedding: [0.1, 0.2],
      embeddingModel: "test-model",
      embeddingDim: 2,
    });
    expect(parsed.embeddingDim).toBe(2);
  });

  it("accepts no fact-embedding at all (all-or-none, none branch)", () => {
    expect(() => edgeInputSchema.parse(VALID_BASE)).not.toThrow();
  });

  it("rejects a partial fact-embedding triplet (embedding without model/dim)", () => {
    expect(() =>
      edgeInputSchema.parse({ ...VALID_BASE, factEmbedding: [0.1, 0.2] }),
    ).toThrow();
  });

  it("rejects a partial fact-embedding triplet (model without embedding/dim)", () => {
    expect(() =>
      edgeInputSchema.parse({ ...VALID_BASE, embeddingModel: "test-model" }),
    ).toThrow();
  });
});

describe("edgeInvalidationSchema", () => {
  it("accepts an empty patch (plain retraction)", () => {
    expect(edgeInvalidationSchema.parse({})).toEqual({});
  });

  it("accepts a validUntil and a supersededByEdgeId", () => {
    const parsed = edgeInvalidationSchema.parse({
      validUntil: "2026-06-08T00:00:00Z",
      supersededByEdgeId: TARGET,
    });
    expect(parsed.supersededByEdgeId).toBe(TARGET);
  });

  it("rejects an unknown key (.strict())", () => {
    expect(() => edgeInvalidationSchema.parse({ invalidatedAt: "now" })).toThrow();
  });
});
