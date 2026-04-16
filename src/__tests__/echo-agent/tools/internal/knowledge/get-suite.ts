import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function getSuite(ctx: SuiteCtx): void {
  const { handleKnowledgeGet, makeTestContext, mockGetById, TEST_DIM } = ctx;

  describe("handleKnowledgeGet", () => {
    it("fails on missing id", async () => {
      const result = await handleKnowledgeGet({}, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("Missing required parameter: id");
    });

    it("fails when entry not found", async () => {
      mockGetById.mockResolvedValueOnce(null);
      const result = await handleKnowledgeGet({ id: 999 }, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("not found");
      expect(result.output).toContain("999");
    });

    it("happy path returns entry and injects content_md into loadedDocuments", async () => {
      mockGetById.mockResolvedValueOnce({
        id: 7,
        kind: "memo",
        title: "title",
        summary: "summary",
        contentMd: "## full markdown body\n\nwith more text",
        tags: ["x"],
        sourceRefs: { protocol_executions: [1] },
        confidence: 0.5,
        status: "active",
        pinned: true,
        validFrom: "2026-04-06T12:00:00Z",
        validUntil: null,
        contentHash: "a".repeat(64),
        embeddingModel: "ai/embeddinggemma:300M-Q8_0",
        embeddingDim: TEST_DIM,
        supersedesId: null,
        supersededBy: null,
        statusReason: null,
        changeSummary: null,
        whatFailed: null,
        createdAt: "2026-04-06T12:00:00Z",
        updatedAt: "2026-04-06T12:00:00Z",
      });
      const engineCtx = makeTestContext();
      const result = await handleKnowledgeGet({ id: 7 }, engineCtx);
      expect(result.success).toBe(true);

      // Body returned to LLM
      const parsed = JSON.parse(result.output);
      expect(parsed.id).toBe(7);
      expect(parsed.contentMd).toBe("## full markdown body\n\nwith more text");
      expect(parsed.tags).toEqual(["x"]);
      expect(parsed.pinned).toBe(true);

      // Side-effect: loadedDocuments has the prefixed key
      expect(engineCtx.loadedDocuments.get("knowledge:7")).toBe("## full markdown body\n\nwith more text");
    });

    it("returns both lineage directions for a superseded predecessor", async () => {
      mockGetById.mockResolvedValueOnce({
        id: 1,
        kind: "risk_rule",
        title: "cap 10%",
        summary: "pos size ≤ 10%",
        contentMd: "pos size ≤ 10%",
        tags: [],
        sourceRefs: {},
        confidence: null,
        status: "superseded",
        pinned: false,
        validFrom: "2026-04-01T00:00:00Z",
        validUntil: null,
        contentHash: "a".repeat(64),
        embeddingModel: "ai/embeddinggemma:300M-Q8_0",
        embeddingDim: TEST_DIM,
        supersedesId: null,
        supersededBy: 2,
        statusReason: "drawdown Q1",
        changeSummary: null,
        whatFailed: null,
        createdAt: "2026-04-01T00:00:00Z",
        updatedAt: "2026-04-06T12:00:00Z",
      });
      const result = await handleKnowledgeGet({ id: 1 }, makeTestContext());
      const parsed = JSON.parse(result.output);
      expect(parsed.status).toBe("superseded");
      expect(parsed.supersededBy).toBe(2);
      expect(parsed.supersedesId).toBeNull();
      expect(parsed.statusReason).toBe("drawdown Q1");
    });

    it("returns both lineage directions for the new successor entry", async () => {
      mockGetById.mockResolvedValueOnce({
        id: 2,
        kind: "risk_rule",
        title: "cap 5%",
        summary: "pos size ≤ 5%",
        contentMd: "pos size ≤ 5%",
        tags: [],
        sourceRefs: {},
        confidence: null,
        status: "active",
        pinned: false,
        validFrom: "2026-04-06T12:00:00Z",
        validUntil: null,
        contentHash: "b".repeat(64),
        embeddingModel: "ai/embeddinggemma:300M-Q8_0",
        embeddingDim: TEST_DIM,
        supersedesId: 1,
        supersededBy: null,
        statusReason: null,
        changeSummary: "tightened from 10% to 5%",
        whatFailed: "3/24 days hit >7%",
        createdAt: "2026-04-06T12:00:00Z",
        updatedAt: "2026-04-06T12:00:00Z",
      });
      const result = await handleKnowledgeGet({ id: 2 }, makeTestContext());
      const parsed = JSON.parse(result.output);
      expect(parsed.supersedesId).toBe(1);
      expect(parsed.supersededBy).toBeNull();
      expect(parsed.changeSummary).toBe("tightened from 10% to 5%");
      expect(parsed.whatFailed).toBe("3/24 days hit >7%");
    });
  });
}
