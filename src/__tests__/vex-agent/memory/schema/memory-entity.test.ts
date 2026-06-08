/**
 * Boundary-schema tests for `memory-entity.ts` (S1d): the `normalizeEntityName`
 * canonicalization and the `.strict()` `entityInputSchema` bounds.
 */

import { describe, it, expect } from "vitest";

import {
  ENTITY_NAME_MAX,
  entityInputSchema,
  normalizeEntityName,
} from "@vex-agent/memory/schema/memory-entity.js";

const VALID_BASE = {
  entityType: "token",
  name: "Solana",
  embedding: [0.1, 0.2, 0.3],
  embeddingModel: "test-model",
  embeddingDim: 3,
} as const;

describe("normalizeEntityName", () => {
  it("lowercases the surface form", () => {
    expect(normalizeEntityName("Solana")).toBe("solana");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEntityName("  ETH  ")).toBe("eth");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeEntityName("Funding   Rate")).toBe("funding rate");
    expect(normalizeEntityName("a\t\nb")).toBe("a b");
  });

  it("treats case-and-spacing variants as the same canonical key", () => {
    expect(normalizeEntityName("  Hyper  Liquid ")).toBe(normalizeEntityName("hyper liquid"));
  });
});

describe("entityInputSchema", () => {
  it("accepts a well-formed entity and applies defaults", () => {
    const parsed = entityInputSchema.parse(VALID_BASE);
    expect(parsed.aliases).toEqual([]);
    expect(parsed.summary).toBe("");
    expect(parsed.attributes).toEqual({});
  });

  it("rejects an unknown key (.strict())", () => {
    expect(() =>
      entityInputSchema.parse({ ...VALID_BASE, normalizedName: "solana" }),
    ).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => entityInputSchema.parse({ ...VALID_BASE, name: "" })).toThrow();
  });

  it("rejects a whitespace-only name (it would normalize to an empty dedup key)", () => {
    expect(() => entityInputSchema.parse({ ...VALID_BASE, name: "   \t\n" })).toThrow();
  });

  it("rejects a name longer than the bound", () => {
    expect(() =>
      entityInputSchema.parse({ ...VALID_BASE, name: "x".repeat(ENTITY_NAME_MAX + 1) }),
    ).toThrow();
  });

  it("rejects an out-of-vocabulary entity type", () => {
    expect(() => entityInputSchema.parse({ ...VALID_BASE, entityType: "galaxy" })).toThrow();
  });

  it("rejects an empty embedding", () => {
    expect(() => entityInputSchema.parse({ ...VALID_BASE, embedding: [] })).toThrow();
  });
});
