/**
 * Dedicated unit tests for knowledge_* handlers.
 *
 * Coverage matrix per handler is intentional — the dispatcher-knowledge-*.test.ts
 * files cover routing and headline cases through dispatchTool, but the most risky paths
 * (TTL bounds, embedding format, pinned semantics, kind validation, source_refs
 * serialization, fail-loud contracts) need direct asserts on the handler shape.
 *
 * All DB and embedding I/O is mocked. Tests call handlers directly, not via
 * dispatchTool, so failures point straight at the handler instead of routing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_DIM = 768;

// ── Mocks ────────────────────────────────────────────────────────

const mockInsertEntry = vi.fn();
const mockFindByContentHash = vi.fn();
const mockGetById = vi.fn();
const mockUpdateStatus = vi.fn();
const mockRecallTopK = vi.fn();
const mockListActive = vi.fn().mockResolvedValue([]);
const mockListKinds = vi.fn().mockResolvedValue([]);

vi.mock("@echo-agent/db/repos/knowledge.js", () => ({
  insertEntry: (...args: unknown[]) => mockInsertEntry(...args),
  findByContentHash: (...args: unknown[]) => mockFindByContentHash(...args),
  getById: (...args: unknown[]) => mockGetById(...args),
  updateStatus: (...args: unknown[]) => mockUpdateStatus(...args),
  recallTopK: (...args: unknown[]) => mockRecallTopK(...args),
  listActiveForHotContext: (...args: unknown[]) => mockListActive(...args),
  listKnownKinds: (...args: unknown[]) => mockListKinds(...args),
}));

const mockCacheWrite = vi.fn();
const mockCacheRead = vi.fn();
const mockCacheCleanup = vi.fn().mockResolvedValue(0);
const mockGenerateCacheKey = vi.fn();

vi.mock("@echo-agent/db/repos/recall-cache.js", () => ({
  writeCache: (...args: unknown[]) => mockCacheWrite(...args),
  readCache: (...args: unknown[]) => mockCacheRead(...args),
  cleanupExpired: (...args: unknown[]) => mockCacheCleanup(...args),
  generateCacheKey: (...args: unknown[]) => mockGenerateCacheKey(...args),
}));

const mockEmbedDocument = vi.fn();
const mockEmbedQuery = vi.fn();

vi.mock("@echo-agent/embeddings/client.js", () => ({
  embedDocument: (...args: unknown[]) => mockEmbedDocument(...args),
  embedQuery: (...args: unknown[]) => mockEmbedQuery(...args),
  formatDocumentInput: (t: string, s: string) => `title: ${t} | text: ${s}`,
  formatQueryInput: (q: string) => `task: search result | query: ${q}`,
}));

const mockLoadEmbeddingConfig = vi.fn(() => ({
  baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
  model: "ai/embeddinggemma:300M-Q8_0",
  dim: TEST_DIM,
  provider: "local",
}));

vi.mock("@echo-agent/embeddings/config.js", () => ({
  loadEmbeddingConfig: () => mockLoadEmbeddingConfig(),
  MIN_EMBEDDING_DIM: 1,
  MAX_EMBEDDING_DIM: 8192,
}));

const {
  handleKnowledgeWrite,
  handleKnowledgeRecall,
  handleKnowledgeRecallOverflow,
  handleKnowledgeGet,
  handleKnowledgeUpdateStatus,
} = await import("@echo-agent/tools/internal/knowledge.js");

import { makeTestContext } from "../_test-context.js";

// ── Helpers ──────────────────────────────────────────────────────

const TEST_PROVIDER_MODEL = "ai/embeddinggemma:300M-Q8_0";

function makeEmbedding(): number[] {
  return Array.from({ length: TEST_DIM }, () => 0.1);
}

function makeEmbedResult(providerModel: string = TEST_PROVIDER_MODEL) {
  return { embedding: makeEmbedding(), providerModel };
}

function makeInsertEntryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    kind: "memo",
    title: "test",
    summary: "test",
    contentMd: "test",
    tags: [],
    sourceRefs: {},
    confidence: null,
    status: "active",
    pinned: false,
    validFrom: "2026-04-06T12:00:00Z",
    validUntil: "2026-04-13T12:00:00Z",
    contentHash: "f".repeat(64),
    embeddingModel: "ai/embeddinggemma:300M-Q8_0",
    embeddingDim: TEST_DIM,
    createdAt: "2026-04-06T12:00:00Z",
    updatedAt: "2026-04-06T12:00:00Z",
    ...overrides,
  };
}

function makeInsertResult(
  overrides: Record<string, unknown> = {},
  inserted = true,
) {
  return { entry: makeInsertEntryRecord(overrides), inserted };
}

function makeCandidate(id: number, contentMd = "c") {
  return {
    id,
    kind: "memo",
    title: `t${id}`,
    summary: "s",
    contentMd,
    similarity: 0.9 - id * 0.001,
    confidence: null,
    status: "active" as const,
    pinned: false,
    validUntil: null,
    validFrom: new Date(),
    updatedAt: new Date(),
    sourceRefs: {},
    tags: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertEntry.mockResolvedValue(makeInsertResult());
  // Default: short-circuit lookup misses (no duplicate). Tests that need
  // the duplicate path override this.
  mockFindByContentHash.mockResolvedValue(null);
  mockEmbedDocument.mockResolvedValue(makeEmbedResult());
  mockEmbedQuery.mockResolvedValue(makeEmbedResult());
  mockCacheCleanup.mockResolvedValue(0);
  mockGenerateCacheKey.mockReturnValue("rcl-test-key");
  mockCacheWrite.mockResolvedValue({
    cacheKey: "rcl-test-key",
    expiresAt: "2026-04-06T12:15:00Z",
  });
  mockUpdateStatus.mockResolvedValue(true);
  mockLoadEmbeddingConfig.mockReturnValue({
    baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
    model: "ai/embeddinggemma:300M-Q8_0",
    dim: TEST_DIM,
    provider: "local",
  });
});

// ── handleKnowledgeWrite ────────────────────────────────────────

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

  // ── Fix 2: provenance honesty ────────────────────────────────

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

  // ── Fix 3: short-circuit on content_hash ─────────────────────

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

// ── handleKnowledgeRecall ───────────────────────────────────────

describe("handleKnowledgeRecall", () => {
  it("fails on missing query without calling embed/cleanup", async () => {
    const result = await handleKnowledgeRecall({}, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required parameter: query");
    expect(mockCacheCleanup).not.toHaveBeenCalled();
    expect(mockEmbedQuery).not.toHaveBeenCalled();
  });

  it("calls cleanupExpired BEFORE embedQuery and BEFORE writeCache (sequence)", async () => {
    mockRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => makeCandidate(i + 1)),
    );
    await handleKnowledgeRecall({ query: "test", k: 12 }, makeTestContext());

    expect(mockCacheCleanup).toHaveBeenCalledTimes(1);
    expect(mockCacheWrite).toHaveBeenCalledTimes(1);

    const cleanupOrder = mockCacheCleanup.mock.invocationCallOrder[0]!;
    const embedOrder = mockEmbedQuery.mock.invocationCallOrder[0]!;
    const writeOrder = mockCacheWrite.mock.invocationCallOrder[0]!;
    expect(cleanupOrder).toBeLessThan(embedOrder);
    expect(cleanupOrder).toBeLessThan(writeOrder);
  });

  it("fails loud when embedding service throws", async () => {
    mockEmbedQuery.mockRejectedValueOnce(new Error("sidecar offline"));
    const result = await handleKnowledgeRecall({ query: "test" }, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("embedding service unavailable");
    expect(mockRecallTopK).not.toHaveBeenCalled();
    expect(mockCacheWrite).not.toHaveBeenCalled();
  });

  it("k=5 returns all inline, no overflow, no cache write", async () => {
    mockRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, i) => makeCandidate(i + 1)),
    );
    const result = await handleKnowledgeRecall({ query: "test", k: 5 }, makeTestContext());
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBe(5);
    expect(parsed.inline).toHaveLength(5);
    expect(parsed.overflow).toBeUndefined();
    expect(mockCacheWrite).not.toHaveBeenCalled();
    expect(mockGenerateCacheKey).not.toHaveBeenCalled();
  });

  it("k=12 returns 10 inline + 2 overflow, writes cache, returns overflow meta", async () => {
    mockRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => makeCandidate(i + 1)),
    );
    const result = await handleKnowledgeRecall({ query: "test", k: 12 }, makeTestContext());
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.inline).toHaveLength(10);
    expect(parsed.overflow).toBeDefined();
    expect(parsed.overflow.cacheKey).toBe("rcl-test-key");
    expect(parsed.overflow.remainingCount).toBe(2);
    expect(parsed.overflow.expiresAt).toBe("2026-04-06T12:15:00Z");

    expect(mockCacheWrite).toHaveBeenCalledTimes(1);
    const [cacheKeyArg, overflowArg] = mockCacheWrite.mock.calls[0]!;
    expect(cacheKeyArg).toBe("rcl-test-key");
    expect(overflowArg).toHaveLength(2);
  });

  it("passes FULL filter set to generateCacheKey (fix 2 guard)", async () => {
    mockRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => makeCandidate(i + 1)),
    );
    await handleKnowledgeRecall(
      { query: "early holder count", k: 12, kind: "pumpfun_entry_pattern", include_expired: false },
      makeTestContext(),
    );
    expect(mockGenerateCacheKey).toHaveBeenCalledTimes(1);
    const [calledQuery, calledFilters, calledNow] = mockGenerateCacheKey.mock.calls[0]!;
    expect(calledQuery).toBe("early holder count");
    expect(calledFilters).toEqual({ k: 12, kind: "pumpfun_entry_pattern", includeExpired: false });
    expect(calledNow).toBeInstanceOf(Date);
  });

  it("fails loud when overflow cache write throws (fix 3 guard)", async () => {
    mockRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => makeCandidate(i + 1)),
    );
    mockCacheWrite.mockRejectedValueOnce(new Error("disk full"));

    const result = await handleKnowledgeRecall({ query: "test", k: 12 }, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("overflow cache write failed");
    expect(result.output).toContain("disk full");
    expect(result.output).toContain("Retry with k=10");
  });

  it("includeExpired defaults to true when omitted", async () => {
    mockRecallTopK.mockResolvedValueOnce([]);
    await handleKnowledgeRecall({ query: "test" }, makeTestContext());
    const [, filters] = mockRecallTopK.mock.calls[0]!;
    expect(filters.includeExpired).toBe(true);
  });

  it("includeExpired=false is passed through to repo", async () => {
    mockRecallTopK.mockResolvedValueOnce([]);
    await handleKnowledgeRecall({ query: "test", include_expired: false }, makeTestContext());
    const [, filters] = mockRecallTopK.mock.calls[0]!;
    expect(filters.includeExpired).toBe(false);
  });

  it("kind filter is passed through to repo", async () => {
    mockRecallTopK.mockResolvedValueOnce([]);
    await handleKnowledgeRecall({ query: "test", kind: "risk_rule" }, makeTestContext());
    const [, filters] = mockRecallTopK.mock.calls[0]!;
    expect(filters.kind).toBe("risk_rule");
  });

  it("passes embeddingModel (from providerModel) + embeddingDim to recallTopK", async () => {
    mockRecallTopK.mockResolvedValueOnce([]);
    await handleKnowledgeRecall({ query: "test" }, makeTestContext());
    const [, filters] = mockRecallTopK.mock.calls[0]!;
    // Filter is the providerModel from THIS embedQuery call, not config.model.
    expect(filters.embeddingModel).toBe(TEST_PROVIDER_MODEL);
    expect(filters.embeddingDim).toBe(TEST_DIM);
  });

  it("recall filter uses providerModel from embedQuery (R2 Fix 2)", async () => {
    // Provider aliases requested name to a different one in the response.
    mockEmbedQuery.mockResolvedValueOnce(makeEmbedResult("aliased-recall-model"));
    mockRecallTopK.mockResolvedValueOnce([]);
    await handleKnowledgeRecall({ query: "test" }, makeTestContext());
    const [, filters] = mockRecallTopK.mock.calls[0]!;
    expect(filters.embeddingModel).toBe("aliased-recall-model");
  });

  it("embedQuery is called with config (configOverride)", async () => {
    mockRecallTopK.mockResolvedValueOnce([]);
    await handleKnowledgeRecall({ query: "test" }, makeTestContext());
    expect(mockEmbedQuery).toHaveBeenCalledTimes(1);
    const [q, cfg] = mockEmbedQuery.mock.calls[0]!;
    expect(q).toBe("test");
    expect(cfg).toEqual({
      baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
      model: "ai/embeddinggemma:300M-Q8_0",
      dim: TEST_DIM,
      provider: "local",
    });
  });

  it("k is clamped to RECALL_MAX_K (15) when caller asks for more", async () => {
    mockRecallTopK.mockResolvedValueOnce([]);
    await handleKnowledgeRecall({ query: "test", k: 9999 }, makeTestContext());
    const [, , kArg] = mockRecallTopK.mock.calls[0]!;
    expect(kArg).toBe(15);
  });

  it("cleanupExpired failure is non-fatal (logs but continues)", async () => {
    mockCacheCleanup.mockRejectedValueOnce(new Error("cleanup boom"));
    mockRecallTopK.mockResolvedValueOnce([makeCandidate(1)]);
    const result = await handleKnowledgeRecall({ query: "test" }, makeTestContext());
    expect(result.success).toBe(true);
  });
});

// ── handleKnowledgeRecallOverflow ───────────────────────────────

describe("handleKnowledgeRecallOverflow", () => {
  it("fails on missing cacheKey", async () => {
    const result = await handleKnowledgeRecallOverflow({}, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required parameter");
    expect(mockCacheRead).not.toHaveBeenCalled();
  });

  it("accepts both `cacheKey` and `cache_key` parameter names", async () => {
    mockCacheRead.mockResolvedValueOnce({
      results: [{ id: 1, kind: "memo", title: "t", summary: "s", contentMd: "c", similarity: 0.5, confidence: null, status: "active", pinned: false, validUntil: null, sourceRefs: {}, tags: [] }],
      expiresAt: "2026-04-06T12:15:00Z",
    });
    const result = await handleKnowledgeRecallOverflow({ cache_key: "rcl-snake" }, makeTestContext());
    expect(result.success).toBe(true);
    expect(mockCacheRead).toHaveBeenCalledWith("rcl-snake");
  });

  it("fails on cache miss with cacheKey in error message", async () => {
    mockCacheRead.mockResolvedValueOnce(null);
    const result = await handleKnowledgeRecallOverflow({ cacheKey: "rcl-missing" }, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("cache not found or expired");
    expect(result.output).toContain("rcl-missing");
  });

  it("fails when readCache throws", async () => {
    mockCacheRead.mockRejectedValueOnce(new Error("DB connection refused"));
    const result = await handleKnowledgeRecallOverflow({ cacheKey: "rcl-x" }, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("knowledge_recall_overflow failed");
  });

  it("happy path returns cached results + expiresAt", async () => {
    const cached = {
      results: [
        { id: 11, kind: "memo", title: "t11", summary: "s", contentMd: "c", similarity: 0.5, confidence: null, status: "active", pinned: false, validUntil: null, sourceRefs: {}, tags: [] },
        { id: 12, kind: "memo", title: "t12", summary: "s", contentMd: "c", similarity: 0.4, confidence: null, status: "active", pinned: false, validUntil: null, sourceRefs: {}, tags: [] },
      ],
      expiresAt: "2026-04-06T12:15:00Z",
    };
    mockCacheRead.mockResolvedValueOnce(cached);
    const result = await handleKnowledgeRecallOverflow({ cacheKey: "rcl-x" }, makeTestContext());
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.expiresAt).toBe("2026-04-06T12:15:00Z");
  });
});

// ── handleKnowledgeGet ──────────────────────────────────────────

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
    const ctx = makeTestContext();
    const result = await handleKnowledgeGet({ id: 7 }, ctx);
    expect(result.success).toBe(true);

    // Body returned to LLM
    const parsed = JSON.parse(result.output);
    expect(parsed.id).toBe(7);
    expect(parsed.contentMd).toBe("## full markdown body\n\nwith more text");
    expect(parsed.tags).toEqual(["x"]);
    expect(parsed.pinned).toBe(true);

    // Side-effect: loadedDocuments has the prefixed key
    expect(ctx.loadedDocuments.get("knowledge:7")).toBe("## full markdown body\n\nwith more text");
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

// ── handleKnowledgeUpdateStatus ─────────────────────────────────

describe("handleKnowledgeUpdateStatus", () => {
  it("fails on missing params", async () => {
    const result = await handleKnowledgeUpdateStatus({}, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required parameters");
  });

  it("rejects active (cannot transition back)", async () => {
    const result = await handleKnowledgeUpdateStatus(
      { id: 1, status: "active" },
      makeTestContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid status");
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("rejects superseded (collapsed in MVP — fix 4)", async () => {
    const result = await handleKnowledgeUpdateStatus(
      { id: 1, status: "superseded" },
      makeTestContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid status");
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("rejects garbage status", async () => {
    const result = await handleKnowledgeUpdateStatus(
      { id: 1, status: "deleted" },
      makeTestContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid status");
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("invalidated is accepted and reason is persisted via repo", async () => {
    const result = await handleKnowledgeUpdateStatus(
      { id: 5, status: "invalidated", reason: "no longer holds" },
      makeTestContext(),
    );
    expect(result.success).toBe(true);
    // Reason is now forwarded to the repo so it lands in status_reason.
    expect(mockUpdateStatus).toHaveBeenCalledWith(5, "invalidated", "no longer holds");
    const parsed = JSON.parse(result.output);
    expect(parsed.reason).toBe("no longer holds");
  });

  it("archived without reason forwards undefined (repo preserves existing status_reason)", async () => {
    const result = await handleKnowledgeUpdateStatus(
      { id: 5, status: "archived" },
      makeTestContext(),
    );
    expect(result.success).toBe(true);
    expect(mockUpdateStatus).toHaveBeenCalledWith(5, "archived", undefined);
    const parsed = JSON.parse(result.output);
    expect(parsed.reason).toBeNull();
  });

  it("returns failure when entry not found in DB", async () => {
    mockUpdateStatus.mockResolvedValueOnce(false);
    const result = await handleKnowledgeUpdateStatus(
      { id: 999, status: "archived" },
      makeTestContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found");
  });
});
