import { describe, expect, it } from "vitest";
import {
  SESSION_MEMORY_LIST_MAX_LIMIT,
  memoryStatsDtoSchema,
  memoryStatsResultSchema,
  sessionMemoryDtoSchema,
  sessionMemoryListInputSchema,
  sessionMemoryListResultSchema,
} from "../memory.js";

const ISO = "2026-05-21T10:00:00.000Z";
const SESSION = "00000000-0000-4000-8000-000000000009";
const VALID_MEMORY = {
  id: 1,
  theme: "kyber_timeout",
  themeSource: "chunker",
  entities: [],
  protocols: [],
  errorClasses: [],
  chains: [],
  tasks: [],
  importance: 5,
  confidence: 0.5,
  status: "active",
  checkpointGeneration: 2,
  sourceStartMessageId: 1,
  sourceEndMessageId: 2,
  outstandingOpenCount: 0,
  outstandingResolvedCount: 0,
  createdAt: ISO,
};

describe("memory schemas", () => {
  it("list input requires a uuid + bounded limit", () => {
    expect(
      sessionMemoryListInputSchema.safeParse({ sessionId: SESSION }).success,
    ).toBe(true);
    expect(
      sessionMemoryListInputSchema.safeParse({ sessionId: "nope" }).success,
    ).toBe(false);
    expect(
      sessionMemoryListInputSchema.safeParse({
        sessionId: SESSION,
        limit: SESSION_MEMORY_LIST_MAX_LIMIT + 1,
      }).success,
    ).toBe(false);
  });

  it("DTO accepts a sanitized memory and rejects leaked narrative/raw items", () => {
    expect(sessionMemoryDtoSchema.safeParse(VALID_MEMORY).success).toBe(true);
    expect(
      sessionMemoryDtoSchema.safeParse({ ...VALID_MEMORY, body_md: "secret" })
        .success,
    ).toBe(false);
    expect(
      sessionMemoryDtoSchema.safeParse({
        ...VALID_MEMORY,
        outstanding_items: [],
      }).success,
    ).toBe(false);
  });

  it("list result accepts null (foreign session) and an array", () => {
    expect(sessionMemoryListResultSchema.safeParse(null).success).toBe(true);
    expect(sessionMemoryListResultSchema.safeParse([VALID_MEMORY]).success).toBe(
      true,
    );
  });

  it("stats DTO + nullable result", () => {
    expect(
      memoryStatsDtoSchema.safeParse({
        activeCount: 1,
        compactCount: 2,
        unresolvedOutstandingCount: 0,
        recentThemes: ["x"],
      }).success,
    ).toBe(true);
    expect(memoryStatsResultSchema.safeParse(null).success).toBe(true);
  });
});
