import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_LIST_MAX_LIMIT,
  knowledgeEntryDtoSchema,
  knowledgeListInputSchema,
  knowledgeListResultSchema,
} from "../knowledge.js";

const ISO = "2026-05-21T10:00:00.000Z";
const VALID = {
  id: 1,
  kind: "risk_rule",
  title: "Avoid X",
  summary: "Short",
  tags: ["risk"],
  confidence: 0.5,
  status: "active",
  source: "observed",
  sourceSession: "sess",
  pinned: false,
  createdAt: ISO,
  updatedAt: ISO,
};

describe("knowledge schemas", () => {
  it("list input defaults + caps the limit and validates status (strict)", () => {
    const parsed = knowledgeListInputSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBeGreaterThan(0);
    expect(
      knowledgeListInputSchema.safeParse({ limit: KNOWLEDGE_LIST_MAX_LIMIT + 1 })
        .success,
    ).toBe(false);
    expect(knowledgeListInputSchema.safeParse({ status: "active" }).success).toBe(
      true,
    );
    expect(knowledgeListInputSchema.safeParse({ status: "bogus" }).success).toBe(
      false,
    );
    expect(knowledgeListInputSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it("DTO accepts a valid entry + null source/confidence", () => {
    expect(knowledgeEntryDtoSchema.safeParse(VALID).success).toBe(true);
    expect(
      knowledgeEntryDtoSchema.safeParse({
        ...VALID,
        source: null,
        confidence: null,
      }).success,
    ).toBe(true);
  });

  it("DTO rejects leaked sensitive columns (content_md / embedding) via strict", () => {
    expect(
      knowledgeEntryDtoSchema.safeParse({ ...VALID, content_md: "secret" })
        .success,
    ).toBe(false);
    expect(
      knowledgeEntryDtoSchema.safeParse({ ...VALID, embedding: [0.1, 0.2] })
        .success,
    ).toBe(false);
  });

  it("DTO rejects an unknown status", () => {
    expect(
      knowledgeEntryDtoSchema.safeParse({ ...VALID, status: "weird" }).success,
    ).toBe(false);
  });

  it("list result is an array (global store — never null)", () => {
    expect(knowledgeListResultSchema.safeParse([VALID]).success).toBe(true);
    expect(knowledgeListResultSchema.safeParse(null).success).toBe(false);
  });
});
