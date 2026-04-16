import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function writeSuite(ctx: SuiteCtx): void {
  const {
    handleKnowledgeWrite,
    makeTestContext,
    mockInsertEntry,
    mockFindByContentHash,
    mockEmbedDocument,
    makeEmbedResult,
    makeInsertResult,
    TEST_DIM,
    TEST_PROVIDER_MODEL,
  } = ctx;

  describe("handleKnowledgeWrite", () => {
    it("fails on missing kind/title/summary without calling embed/insert", async () => {
      const result = await handleKnowledgeWrite({}, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("Missing required fields");
      expect(mockEmbedDocument).not.toHaveBeenCalled();
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("rejects camelCase kind without calling embed/insert", async () => {
      const result = await handleKnowledgeWrite(
        { kind: "pumpFun", title: "t", summary: "s" },
        makeTestContext(),
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid kind");
      expect(mockEmbedDocument).not.toHaveBeenCalled();
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("rejects kebab-case kind", async () => {
      const result = await handleKnowledgeWrite(
        { kind: "pump-fun", title: "t", summary: "s" },
        makeTestContext(),
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid kind");
    });

    it("rejects oversized kind", async () => {
      const result = await handleKnowledgeWrite(
        { kind: "a".repeat(65), title: "t", summary: "s" },
        makeTestContext(),
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid kind");
    });

    it("fails loud when embedding service throws and does not write to DB", async () => {
      mockEmbedDocument.mockRejectedValueOnce(new Error("ECONNREFUSED 12434"));
      const result = await handleKnowledgeWrite(
        { kind: "memo", title: "t", summary: "s" },
        makeTestContext(),
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("embedding service unavailable");
      expect(result.output).toContain("ECONNREFUSED 12434");
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("fails when insert throws (DB error surfaces as knowledge_write failed)", async () => {
      mockInsertEntry.mockRejectedValueOnce(new Error("unique violation"));
      const result = await handleKnowledgeWrite(
        { kind: "memo", title: "t", summary: "s" },
        makeTestContext(),
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("knowledge_write failed");
    });

    it("happy path embeds title+summary, computes content_hash, inserts with providerModel from response", async () => {
      const result = await handleKnowledgeWrite(
        { kind: "strategy_rule", title: "low-holder pump", summary: "Tokens with under 50 holders show momentum" },
        makeTestContext(),
      );
      expect(result.success).toBe(true);

      // findByContentHash is consulted FIRST (short-circuit)
      expect(mockFindByContentHash).toHaveBeenCalledTimes(1);
      expect(mockFindByContentHash.mock.calls[0]?.[0]).toMatch(/^[a-f0-9]{64}$/);

      // embedDocument is called with config (configOverride argument), not just title/summary
      expect(mockEmbedDocument).toHaveBeenCalledTimes(1);
      const [embedTitle, embedSummary, embedConfig] = mockEmbedDocument.mock.calls[0];
      expect(embedTitle).toBe("low-holder pump");
      expect(embedSummary).toBe("Tokens with under 50 holders show momentum");
      expect(embedConfig).toEqual({
        baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
        model: "ai/embeddinggemma:300M-Q8_0",
        dim: TEST_DIM,
        provider: "local",
      });

      expect(mockInsertEntry).toHaveBeenCalledTimes(1);
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.kind).toBe("strategy_rule");
      expect(arg.title).toBe("low-holder pump");
      expect(arg.contentMd).toBe("Tokens with under 50 holders show momentum"); // defaults to summary when omitted
      expect(arg.pinned).toBe(false);
      expect(arg.validUntil).toBeInstanceOf(Date);
      expect(arg.embedding).toHaveLength(TEST_DIM);
      // embeddingDim is the actual response length (not a constant)
      expect(arg.embeddingDim).toBe(TEST_DIM);
      // embeddingModel comes from providerModel (response.model with config.model fallback)
      expect(arg.embeddingModel).toBe(TEST_PROVIDER_MODEL);
      // content_hash is sha256 hex (64 chars)
      expect(arg.contentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("stamps embeddingModel from providerModel (response), NOT from config.model", async () => {
      // Provider aliases the requested model to a different name in the response.
      mockEmbedDocument.mockResolvedValueOnce(makeEmbedResult("provider-alias-name"));
      await handleKnowledgeWrite(
        { kind: "memo", title: "t", summary: "s" },
        makeTestContext(),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.embeddingModel).toBe("provider-alias-name");
      // Sanity: it really IS different from the requested config.model
      expect(arg.embeddingModel).not.toBe("ai/embeddinggemma:300M-Q8_0");
    });

    it("short-circuits a duplicate write before calling the provider", async () => {
      mockFindByContentHash.mockResolvedValueOnce({
        id: 99,
        kind: "memo",
        title: "t",
        summary: "s",
        contentMd: "s",
        tags: [],
        sourceRefs: {},
        confidence: null,
        status: "active",
        pinned: false,
        validFrom: "2026-04-06T12:00:00Z",
        validUntil: "2026-04-13T12:00:00Z",
        contentHash: "f".repeat(64),
        embeddingModel: TEST_PROVIDER_MODEL,
        embeddingDim: TEST_DIM,
        createdAt: "2026-04-06T12:00:00Z",
        updatedAt: "2026-04-06T12:00:00Z",
      });

      const result = await handleKnowledgeWrite(
        { kind: "memo", title: "t", summary: "s" },
        makeTestContext(),
      );

      expect(result.success).toBe(true);
      // findByContentHash hit → embed and insert MUST be skipped
      expect(mockFindByContentHash).toHaveBeenCalledTimes(1);
      expect(mockEmbedDocument).not.toHaveBeenCalled();
      expect(mockInsertEntry).not.toHaveBeenCalled();

      const parsed = JSON.parse(result.output);
      expect(parsed.duplicate).toBe(true);
      expect(parsed.id).toBe(99);
      expect(parsed.embedded).toBe(true);
    });

    it("returns duplicate: true via the CTE upsert race-condition fallback (when short-circuit missed)", async () => {
      // Short-circuit lookup misses, embed + insert run, but the CTE upsert
      // detects the row was inserted between our SELECT and our INSERT.
      mockFindByContentHash.mockResolvedValueOnce(null);
      mockInsertEntry.mockResolvedValueOnce(makeInsertResult({}, false));
      const result = await handleKnowledgeWrite(
        { kind: "memo", title: "t", summary: "s" },
        makeTestContext(),
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.duplicate).toBe(true);
      expect(parsed.id).toBe(42);
    });

    it("returns duplicate: false on a fresh insert", async () => {
      mockFindByContentHash.mockResolvedValueOnce(null);
      mockInsertEntry.mockResolvedValueOnce(makeInsertResult({}, true));
      const result = await handleKnowledgeWrite(
        { kind: "memo", title: "t2", summary: "s2" },
        makeTestContext(),
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.duplicate).toBe(false);
    });

    it("uses content_md when explicitly provided (does not default to summary)", async () => {
      await handleKnowledgeWrite(
        { kind: "memo", title: "t", summary: "s", content_md: "## full body\n\ndetail" },
        makeTestContext(),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.contentMd).toBe("## full body\n\ndetail");
    });

    it("respects ttl_hours override (validUntil computed from override, not default)", async () => {
      const before = Date.now();
      await handleKnowledgeWrite(
        { kind: "market_observation", title: "t", summary: "s", ttl_hours: 24 },
        makeTestContext(),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      const after = Date.now();
      const validMs = (arg.validUntil as Date).getTime();
      // 24h ± 5s tolerance for clock drift between `before` and the call
      expect(validMs).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000 - 5000);
      expect(validMs).toBeLessThanOrEqual(after + 24 * 3600 * 1000 + 5000);
    });

    it("clamps absurd ttl_hours to MAX (1 year)", async () => {
      await handleKnowledgeWrite(
        { kind: "memo", title: "t", summary: "s", ttl_hours: 999_999 },
        makeTestContext(),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      const yearMs = 365 * 24 * 60 * 60 * 1000;
      const diffMs = (arg.validUntil as Date).getTime() - Date.now();
      expect(diffMs).toBeLessThanOrEqual(yearMs + 5000);
      expect(diffMs).toBeGreaterThan(yearMs - 5000);
    });

    it("pinned=true makes validUntil null (bypasses TTL)", async () => {
      await handleKnowledgeWrite(
        { kind: "risk_rule", title: "no leverage", summary: "...", pinned: true, ttl_hours: 24 },
        makeTestContext(),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.pinned).toBe(true);
      expect(arg.validUntil).toBeNull();
    });

    it("passes tags array and source_refs object through", async () => {
      await handleKnowledgeWrite(
        {
          kind: "memo",
          title: "t",
          summary: "s",
          tags: ["solana", "memecoin"],
          source_refs: { protocol_executions: [1, 2], proj_activity: [10] },
          confidence: 0.7,
        },
        makeTestContext(),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.tags).toEqual(["solana", "memecoin"]);
      expect(arg.sourceRefs).toEqual({ protocol_executions: [1, 2], proj_activity: [10] });
      expect(arg.confidence).toBe(0.7);
    });

    it("clamps confidence to [0,1]", async () => {
      await handleKnowledgeWrite(
        { kind: "memo", title: "t", summary: "s", confidence: 5 },
        makeTestContext(),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.confidence).toBe(1);
    });

    it("ignores non-array tags and non-object source_refs (defensive)", async () => {
      await handleKnowledgeWrite(
        { kind: "memo", title: "t", summary: "s", tags: "not-an-array", source_refs: "garbage" },
        makeTestContext(),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.tags).toEqual([]);
      expect(arg.sourceRefs).toEqual({});
    });
  });
}
