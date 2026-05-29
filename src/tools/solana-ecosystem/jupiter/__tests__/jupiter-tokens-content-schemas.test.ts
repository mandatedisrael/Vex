/**
 * codex-002 schema coverage for the Jupiter Token Content API (display data).
 * Validates shape + forward-compat passthrough; rejects a bad enum.
 */

import { describe, expect, it } from "vitest";
import {
  jupiterTokenContentFeedResponseSchema,
  jupiterTokenContentMultipleMintsResponseSchema,
  jupiterTokenContentSummariesResponseSchema,
} from "../jupiter-tokens/content/schemas.js";

const user = { id: "u1", username: "alice", role: null };
const summary = {
  summaryFull: "full",
  summaryShort: null,
  updatedAt: "2026-01-01T00:00:00Z",
  citations: ["https://x.test"],
};
const item = {
  contentId: "c1",
  content: "hello",
  contentType: "text",
  status: "approved",
  source: null,
  submittedAt: "2026-01-01T00:00:00Z",
  submittedBy: user,
  updatedAt: null,
  updatedBy: user,
  postedAt: null,
};

describe("jupiter token content schemas", () => {
  it("accepts a multiple-mints response with unknown forward-compat keys", () => {
    const r = jupiterTokenContentMultipleMintsResponseSchema.safeParse({
      data: [
        {
          mint: "So11111111111111111111111111111111111111112",
          contents: [item],
          tokenSummary: summary,
          newsSummary: null,
          futureField: 1,
        },
      ],
      meta: { future: true },
    });
    expect(r.success).toBe(true);
  });

  it("accepts an empty data array (no not-found preemption)", () => {
    expect(
      jupiterTokenContentMultipleMintsResponseSchema.safeParse({ data: [] }).success,
    ).toBe(true);
    expect(
      jupiterTokenContentSummariesResponseSchema.safeParse({ data: [] }).success,
    ).toBe(true);
  });

  it("accepts a feed response", () => {
    const r = jupiterTokenContentFeedResponseSchema.safeParse({
      data: {
        contents: [item],
        tokenSummary: null,
        newsSummary: null,
        pagination: { limit: 10, total: 1, page: 1, totalPages: 1 },
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid contentType enum", () => {
    const r = jupiterTokenContentMultipleMintsResponseSchema.safeParse({
      data: [
        {
          mint: "m",
          contents: [{ ...item, contentType: "video" }],
          tokenSummary: null,
          newsSummary: null,
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});
