import { describe, it, expect, vi } from "vitest";

// Mock 0G compute readiness to avoid .cts SDK bridge loading
vi.mock("@tools/0g-compute/readiness.js", () => ({
  loadComputeState: () => null,
}));

vi.mock("@tools/wallet/multi-auth.js", () => ({
  requireEvmWallet: () => ({
    family: "eip155",
    address: "0x1234567890abcdef1234567890abcdef12345678",
    privateKey: `0x${"ab".repeat(32)}`,
  }),
  requireSolanaWallet: () => ({
    family: "solana",
    address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    secretKey: new Uint8Array(64),
  }),
}));

vi.mock("@tools/wallet/family.js", () => ({
  normalizeWalletChain: (input?: string) => {
    if (!input || input === "eip155" || input === "evm") return "eip155";
    if (input === "solana" || input === "sol") return "solana";
    throw new Error(`Unsupported wallet chain: ${input}`);
  },
}));

// Mock echo-agent DB repos (no real DB in unit tests)
vi.mock("@echo-agent/db/repos/search.js", () => ({
  getCached: vi.fn().mockResolvedValue(null),
  cacheResult: vi.fn().mockResolvedValue(undefined),
  getCachedFetch: vi.fn().mockResolvedValue(null),
  cacheFetchResult: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@echo-agent/db/repos/documents.js", () => ({
  getDocument: vi.fn().mockResolvedValue(null),
  upsertDocument: vi.fn().mockResolvedValue({ id: 1, space: "notes", folderId: null, title: "test", slug: "test", contentMd: "content", sizeBytes: 7, createdAt: "2024-01-01", updatedAt: "2024-01-01" }),
  listDocuments: vi.fn().mockResolvedValue([]),
  softDeleteDocument: vi.fn().mockResolvedValue(true),
  countDocuments: vi.fn().mockResolvedValue(1),
}));

vi.mock("@echo-agent/db/repos/folders.js", () => ({
  getFolderBySlug: vi.fn().mockResolvedValue(null),
  createFolder: vi.fn().mockResolvedValue({ id: 1, space: "notes", parentId: null, name: "test", slug: "test", createdAt: "2024-01-01" }),
  listFolders: vi.fn().mockResolvedValue([]),
  deleteFolder: vi.fn().mockResolvedValue(true),
}));

const mockKnowledgeInsert = vi.fn().mockResolvedValue({
  id: 42, kind: "memo", title: "test", summary: "test", contentMd: "test",
  tags: [], sourceRefs: {}, confidence: null, status: "active", pinned: false,
  validFrom: "2026-04-06T12:00:00Z", validUntil: "2026-04-13T12:00:00Z",
  embeddingModel: "ai/embeddinggemma:300M-Q8_0", embeddingDim: 768,
  createdAt: "2026-04-06T12:00:00Z", updatedAt: "2026-04-06T12:00:00Z",
});
const mockKnowledgeGetById = vi.fn().mockResolvedValue(null);
const mockKnowledgeUpdateStatus = vi.fn().mockResolvedValue(true);
const mockKnowledgeRecallTopK = vi.fn().mockResolvedValue([]);
const mockKnowledgeListActive = vi.fn().mockResolvedValue([]);
const mockKnowledgeListKinds = vi.fn().mockResolvedValue([]);

vi.mock("@echo-agent/db/repos/knowledge.js", () => ({
  insertEntry: (...args: unknown[]) => mockKnowledgeInsert(...args),
  getById: (...args: unknown[]) => mockKnowledgeGetById(...args),
  updateStatus: (...args: unknown[]) => mockKnowledgeUpdateStatus(...args),
  recallTopK: (...args: unknown[]) => mockKnowledgeRecallTopK(...args),
  listActiveForHotContext: (...args: unknown[]) => mockKnowledgeListActive(...args),
  listKnownKinds: (...args: unknown[]) => mockKnowledgeListKinds(...args),
}));

const mockCacheWrite = vi.fn().mockResolvedValue({ cacheKey: "rcl-test", expiresAt: "2026-04-06T12:15:00Z" });
const mockCacheRead = vi.fn().mockResolvedValue(null);
const mockCacheCleanup = vi.fn().mockResolvedValue(0);

const mockGenerateCacheKey = vi.fn((..._args: unknown[]) => "rcl-test");

vi.mock("@echo-agent/db/repos/recall-cache.js", () => ({
  writeCache: (...args: unknown[]) => mockCacheWrite(...args),
  readCache: (...args: unknown[]) => mockCacheRead(...args),
  cleanupExpired: (...args: unknown[]) => mockCacheCleanup(...args),
  generateCacheKey: (...args: unknown[]) => mockGenerateCacheKey(...args),
}));

const mockEmbedDocument = vi.fn().mockResolvedValue(Array.from({ length: 768 }, () => 0.1));
const mockEmbedQuery = vi.fn().mockResolvedValue(Array.from({ length: 768 }, () => 0.1));

vi.mock("@echo-agent/embeddings/client.js", () => ({
  embedDocument: (...args: unknown[]) => mockEmbedDocument(...args),
  embedQuery: (...args: unknown[]) => mockEmbedQuery(...args),
  formatDocumentInput: (t: string, s: string) => `title: ${t} | text: ${s}`,
  formatQueryInput: (q: string) => `task: search result | query: ${q}`,
}));

vi.mock("@echo-agent/db/repos/schedules.js", () => ({
  createSchedule: vi.fn().mockResolvedValue(undefined),
  deleteSchedule: vi.fn().mockResolvedValue(true),
}));

vi.mock("@echo-agent/db/repos/subagents.js", () => ({
  insert: vi.fn().mockResolvedValue(undefined),
  getById: vi.fn().mockResolvedValue(null),
  getActive: vi.fn().mockResolvedValue([]),
  getRecent: vi.fn().mockResolvedValue([]),
  updateStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  setScope: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@echo-agent/db/repos/session-links.js", () => ({
  linkSessions: vi.fn().mockResolvedValue({ id: 1 }),
}));

vi.mock("@echo-agent/db/repos/executions.js", () => ({
  recordExecution: vi.fn().mockResolvedValue(1),
}));

vi.mock("@echo-agent/db/repos/sync.js", () => ({
  getJobsForNamespace: vi.fn().mockResolvedValue([]),
  enqueueRun: vi.fn().mockResolvedValue(1),
}));

const { dispatchTool } = await import("../../../echo-agent/tools/dispatcher.js");
import { makeTestContext } from "./_test-context.js";

const baseContext = makeTestContext();

describe("dispatcher", () => {
  // ── Protocol routing ─────────────────────────────────────────────

  it("routes discover_tools to protocol discovery", async () => {
    const result = await dispatchTool(
      { name: "discover_tools", args: { namespace: "khalani" }, toolCallId: "call_1" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.tools[0].toolId).toMatch(/^khalani\./);
  });

  it("discover_tools returns khalani tools with params", async () => {
    const result = await dispatchTool(
      { name: "discover_tools", args: { namespace: "khalani", includeMutating: true }, toolCallId: "call_2" },
      baseContext,
    );

    const parsed = JSON.parse(result.output);
    const bridge = parsed.tools.find((t: { toolId: string }) => t.toolId === "khalani.bridge");
    expect(bridge).toBeDefined();
    expect(bridge.mutating).toBe(true);
    expect(bridge.params.length).toBeGreaterThan(0);
  });

  it("discover_tools filters mutating by default", async () => {
    const result = await dispatchTool(
      { name: "discover_tools", args: { namespace: "khalani" }, toolCallId: "call_3" },
      baseContext,
    );

    const parsed = JSON.parse(result.output);
    const hasMutating = parsed.tools.some((t: { mutating: boolean }) => t.mutating);
    expect(hasMutating).toBe(false);
  });

  it("discover_tools respects query filter", async () => {
    const result = await dispatchTool(
      { name: "discover_tools", args: { query: "balance" }, toolCallId: "call_4" },
      baseContext,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBeGreaterThan(0);
    for (const tool of parsed.tools) {
      const matchesQuery =
        tool.toolId.includes("balance") ||
        tool.description.toLowerCase().includes("balance");
      expect(matchesQuery).toBe(true);
    }
  });

  it("discover_tools respects limit", async () => {
    const result = await dispatchTool(
      { name: "discover_tools", args: { limit: 2 }, toolCallId: "call_5" },
      baseContext,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBeLessThanOrEqual(2);
  });

  // ── execute_tool validation ──────────────────────────────────────

  it("execute_tool fails on missing toolId", async () => {
    const result = await dispatchTool(
      { name: "execute_tool", args: { params: {} }, toolCallId: "call_6" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("toolId");
  });

  it("execute_tool fails on unknown toolId", async () => {
    const result = await dispatchTool(
      { name: "execute_tool", args: { toolId: "fake.tool", params: {} }, toolCallId: "call_7" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown protocol tool");
  });

  it("execute_tool validates required params", async () => {
    const result = await dispatchTool(
      { name: "execute_tool", args: { toolId: "khalani.tokens.search", params: {} }, toolCallId: "call_8" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("query");
  });

  // ── Internal tool routing (live handlers) ────────────────────────

  it("routes web_search to live handler (fails without TAVILY_API_KEY, not stub)", async () => {
    const result = await dispatchTool(
      { name: "web_search", args: { query: "test" }, toolCallId: "call_9" },
      baseContext,
    );

    // Without TAVILY_API_KEY: returns error but NOT a [STUB]
    expect(result.output).not.toContain("[STUB]");
  });

  it("web_search fails on missing query", async () => {
    const result = await dispatchTool(
      { name: "web_search", args: {}, toolCallId: "call_9b" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("query");
  });

  it("web_fetch fails on invalid URL", async () => {
    const result = await dispatchTool(
      { name: "web_fetch", args: { url: "not-a-url" }, toolCallId: "call_9c" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("http");
  });

  it("routes document_read to handler (returns not found, not stub)", async () => {
    const result = await dispatchTool(
      { name: "document_read", args: { slug: "nonexistent" }, toolCallId: "call_10" },
      baseContext,
    );

    expect(result.output).not.toContain("[STUB]");
    expect(result.success).toBe(false);
    expect(result.output).toContain("Not found");
  });

  it("document_write creates document", async () => {
    const result = await dispatchTool(
      { name: "document_write", args: { title: "Test Doc", content: "Hello world" }, toolCallId: "call_10b" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.slug).toBe("test");
    expect(parsed.space).toBe("notes");
  });

  it("document_write fails without title", async () => {
    const result = await dispatchTool(
      { name: "document_write", args: { content: "No title" }, toolCallId: "call_10c" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("title");
  });

  it("document_list returns results", async () => {
    const result = await dispatchTool(
      { name: "document_list", args: {}, toolCallId: "call_10d" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.space).toBe("notes");
    expect(Array.isArray(parsed.documents)).toBe(true);
    expect(Array.isArray(parsed.folders)).toBe(true);
  });

  // ── knowledge_* routing (replaces former memory_manage) ─────────

  it("rejects memory_manage as an unknown tool (replaced by knowledge_*)", async () => {
    const result = await dispatchTool(
      { name: "memory_manage", args: { action: "list" }, toolCallId: "call_11" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown");
  });

  it("routes knowledge_write to handler with embedding + insert", async () => {
    const result = await dispatchTool(
      {
        name: "knowledge_write",
        args: {
          kind: "memo",
          title: "test title",
          summary: "test summary",
        },
        toolCallId: "call_kw_1",
      },
      baseContext,
    );
    expect(result.success).toBe(true);
    expect(mockEmbedDocument).toHaveBeenCalledWith("test title", "test summary");
    expect(mockKnowledgeInsert).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.output);
    expect(parsed.id).toBe(42);
    expect(parsed.embedded).toBe(true);
  });

  it("knowledge_write fails loud when embedding service throws", async () => {
    mockKnowledgeInsert.mockClear();
    mockEmbedDocument.mockRejectedValueOnce(new Error("ECONNREFUSED 12434"));
    const result = await dispatchTool(
      {
        name: "knowledge_write",
        args: { kind: "memo", title: "t", summary: "s" },
        toolCallId: "call_kw_2",
      },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("embedding service unavailable");
    // No DB write attempted
    expect(mockKnowledgeInsert).not.toHaveBeenCalled();
  });

  it("knowledge_write rejects invalid kind", async () => {
    mockEmbedDocument.mockClear();
    const result = await dispatchTool(
      {
        name: "knowledge_write",
        args: { kind: "camelCase", title: "t", summary: "s" },
        toolCallId: "call_kw_3",
      },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid kind");
    expect(mockEmbedDocument).not.toHaveBeenCalled();
  });

  it("routes knowledge_recall with k <= 10 returns inline only, no overflow", async () => {
    mockKnowledgeRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        kind: "memo",
        title: `t${i}`,
        summary: "s",
        contentMd: "c",
        similarity: 0.5,
        confidence: null,
        status: "active" as const,
        pinned: false,
        validUntil: null,
        validFrom: new Date(),
        updatedAt: new Date(),
        sourceRefs: {},
        tags: [],
      })),
    );

    const result = await dispatchTool(
      { name: "knowledge_recall", args: { query: "test", k: 5 }, toolCallId: "call_kr_1" },
      baseContext,
    );

    expect(result.success).toBe(true);
    expect(mockCacheCleanup).toHaveBeenCalledTimes(1); // lazy cleanup
    expect(mockEmbedQuery).toHaveBeenCalledWith("test");
    expect(mockCacheWrite).not.toHaveBeenCalled(); // no overflow
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBe(5);
    expect(parsed.inline).toHaveLength(5);
    expect(parsed.overflow).toBeUndefined();
  });

  it("routes knowledge_recall with k > 10 splits inline + writes overflow cache", async () => {
    mockKnowledgeRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        kind: "memo",
        title: `t${i}`,
        summary: "s",
        contentMd: "c",
        similarity: 0.9 - i * 0.01, // descending so order is stable
        confidence: null,
        status: "active" as const,
        pinned: false,
        validUntil: null,
        validFrom: new Date(),
        updatedAt: new Date(),
        sourceRefs: {},
        tags: [],
      })),
    );

    const result = await dispatchTool(
      { name: "knowledge_recall", args: { query: "test", k: 12 }, toolCallId: "call_kr_2" },
      baseContext,
    );

    expect(result.success).toBe(true);
    // Sequence: cleanupExpired must be called BEFORE writeCache
    const cleanupOrder = mockCacheCleanup.mock.invocationCallOrder[0]!;
    const writeOrder = mockCacheWrite.mock.invocationCallOrder[0]!;
    expect(cleanupOrder).toBeLessThan(writeOrder);

    expect(mockCacheWrite).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.output);
    expect(parsed.inline).toHaveLength(10);
    expect(parsed.overflow).toBeDefined();
    expect(parsed.overflow.cacheKey).toBe("rcl-test");
    expect(parsed.overflow.remainingCount).toBe(2);
  });

  it("knowledge_recall fails loud when embedding service throws", async () => {
    mockEmbedQuery.mockRejectedValueOnce(new Error("sidecar offline"));
    const result = await dispatchTool(
      { name: "knowledge_recall", args: { query: "test" }, toolCallId: "call_kr_3" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("embedding service unavailable");
  });

  it("knowledge_recall fails loud when overflow cache write throws (fix 3)", async () => {
    mockKnowledgeRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        kind: "memo",
        title: `t${i}`,
        summary: "s",
        contentMd: "c",
        similarity: 0.9 - i * 0.01,
        confidence: null,
        status: "active" as const,
        pinned: false,
        validUntil: null,
        validFrom: new Date(),
        updatedAt: new Date(),
        sourceRefs: {},
        tags: [],
      })),
    );
    mockCacheWrite.mockRejectedValueOnce(new Error("disk full"));

    const result = await dispatchTool(
      { name: "knowledge_recall", args: { query: "test", k: 12 }, toolCallId: "call_kr_4" },
      baseContext,
    );
    expect(result.success).toBe(false);
    // Helpful retry hint instructs the agent how to recover.
    expect(result.output).toContain("overflow cache write failed");
    expect(result.output).toContain("Retry with k=10");
  });

  it("knowledge_recall passes full filter set to generateCacheKey (fix 2)", async () => {
    mockKnowledgeRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        kind: "memo",
        title: `t${i}`,
        summary: "s",
        contentMd: "c",
        similarity: 0.9 - i * 0.01,
        confidence: null,
        status: "active" as const,
        pinned: false,
        validUntil: null,
        validFrom: new Date(),
        updatedAt: new Date(),
        sourceRefs: {},
        tags: [],
      })),
    );
    mockGenerateCacheKey.mockClear();
    mockCacheWrite.mockResolvedValueOnce({ cacheKey: "rcl-test", expiresAt: "2026-04-06T12:15:00Z" });

    await dispatchTool(
      {
        name: "knowledge_recall",
        args: { query: "early holder", k: 12, kind: "memo", include_expired: false },
        toolCallId: "call_kr_5",
      },
      baseContext,
    );

    expect(mockGenerateCacheKey).toHaveBeenCalledTimes(1);
    const [calledQuery, calledFilters] = mockGenerateCacheKey.mock.calls[0]!;
    expect(calledQuery).toBe("early holder");
    expect(calledFilters).toEqual({ k: 12, kind: "memo", includeExpired: false });
  });

  it("knowledge_recall_overflow returns cached results", async () => {
    mockCacheRead.mockResolvedValueOnce({
      results: [{ id: 1, kind: "memo", title: "t", summary: "s", contentMd: "c", similarity: 0.5, confidence: null, status: "active", pinned: false, validUntil: null, sourceRefs: {}, tags: [] }],
      expiresAt: "2026-04-06T12:15:00Z",
    });
    const result = await dispatchTool(
      { name: "knowledge_recall_overflow", args: { cacheKey: "rcl-test" }, toolCallId: "call_ko_1" },
      baseContext,
    );
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.results).toHaveLength(1);
  });

  it("knowledge_recall_overflow fails on cache miss", async () => {
    mockCacheRead.mockResolvedValueOnce(null);
    const result = await dispatchTool(
      { name: "knowledge_recall_overflow", args: { cacheKey: "missing" }, toolCallId: "call_ko_2" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found or expired");
  });

  it("knowledge_get loads content_md into context.loadedDocuments", async () => {
    mockKnowledgeGetById.mockResolvedValueOnce({
      id: 7,
      kind: "memo",
      title: "t",
      summary: "s",
      contentMd: "full markdown body",
      tags: [],
      sourceRefs: {},
      confidence: null,
      status: "active" as const,
      pinned: true,
      validFrom: "2026-04-06T12:00:00Z",
      validUntil: null,
      embeddingModel: "ai/embeddinggemma:300M-Q8_0",
      embeddingDim: 768,
      createdAt: "2026-04-06T12:00:00Z",
      updatedAt: "2026-04-06T12:00:00Z",
    });
    const ctx = makeTestContext();
    const result = await dispatchTool(
      { name: "knowledge_get", args: { id: 7 }, toolCallId: "call_kg_1" },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(ctx.loadedDocuments.get("knowledge:7")).toBe("full markdown body");
  });

  it("knowledge_get fails on missing id", async () => {
    mockKnowledgeGetById.mockResolvedValueOnce(null);
    const result = await dispatchTool(
      { name: "knowledge_get", args: { id: 999 }, toolCallId: "call_kg_2" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found");
  });

  it("knowledge_update_status validates enum (rejects active)", async () => {
    const result = await dispatchTool(
      { name: "knowledge_update_status", args: { id: 1, status: "active" }, toolCallId: "call_ks_1" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid status");
    expect(mockKnowledgeUpdateStatus).not.toHaveBeenCalled();
  });

  it("knowledge_update_status rejects superseded (collapsed in MVP — fix 4)", async () => {
    mockKnowledgeUpdateStatus.mockClear();
    const result = await dispatchTool(
      { name: "knowledge_update_status", args: { id: 1, status: "superseded" }, toolCallId: "call_ks_1b" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid status");
    expect(mockKnowledgeUpdateStatus).not.toHaveBeenCalled();
  });

  it("knowledge_update_status applies valid status", async () => {
    const result = await dispatchTool(
      { name: "knowledge_update_status", args: { id: 1, status: "invalidated" }, toolCallId: "call_ks_2" },
      baseContext,
    );
    expect(result.success).toBe(true);
    expect(mockKnowledgeUpdateStatus).toHaveBeenCalledWith(1, "invalidated");
  });

  it("schedule_create validates cron", async () => {
    const result = await dispatchTool(
      { name: "schedule_create", args: { name: "test", cron: "invalid-cron", type: "wake_agent" }, toolCallId: "call_12b" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid cron");
  });

  it("schedule_create rejects cli_execute", async () => {
    const result = await dispatchTool(
      { name: "schedule_create", args: { name: "test", cron: "* * * * *", type: "cli_execute" }, toolCallId: "call_12c" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid task type");
  });

  it("schedule_create with wake_agent succeeds", async () => {
    const result = await dispatchTool(
      { name: "schedule_create", args: { name: "wake test", cron: "0 * * * *", type: "wake_agent", payload: { prompt: "check markets" } }, toolCallId: "call_12d" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.type).toBe("wake_agent");
    expect(parsed.taskId).toMatch(/^task-/);
  });

  it("schedule_remove works", async () => {
    const result = await dispatchTool(
      { name: "schedule_remove", args: { id: "task-123" }, toolCallId: "call_12e" },
      baseContext,
    );

    expect(result.success).toBe(true);
  });

  it("subagent_spawn returns id", async () => {
    const result = await dispatchTool(
      { name: "subagent_spawn", args: { name: "EchoTest", task: "research markets" }, toolCallId: "call_13" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.id).toMatch(/^subagent-/);
    expect(parsed.name).toBe("EchoTest");
  });

  it("subagent_spawn fails without name", async () => {
    const result = await dispatchTool(
      { name: "subagent_spawn", args: { task: "do something" }, toolCallId: "call_13b" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("name");
  });

  it("subagent_status returns empty when none active", async () => {
    const result = await dispatchTool(
      { name: "subagent_status", args: {}, toolCallId: "call_13c" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.message).toContain("No active");
  });

  it("routes wallet_read to live handler (not stub)", async () => {
    const result = await dispatchTool(
      { name: "wallet_read", args: { action: "address" }, toolCallId: "call_14" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.chain).toBe("eip155");
    expect(parsed.address).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(result.output).not.toContain("[STUB]");
  });

  // ── Unknown tool ─────────────────────────────────────────────────

  it("returns error for completely unknown tool", async () => {
    const result = await dispatchTool(
      { name: "nonexistent_tool", args: {}, toolCallId: "call_15" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown tool");
  });

  // ── No stubs remaining ──────────────────────────────────────────

  it("no internal tool returns [STUB]", async () => {
    const internalTools = [
      { name: "web_search", args: { query: "test" } },
      { name: "web_fetch", args: { url: "https://example.com" } },
      { name: "document_read", args: { slug: "test" } },
      { name: "document_write", args: { title: "t", content: "c" } },
      { name: "document_list", args: {} },
      { name: "document_delete", args: { slug: "test" } },
      { name: "knowledge_write", args: { kind: "memo", title: "t", summary: "s" } },
      { name: "knowledge_recall", args: { query: "test" } },
      { name: "knowledge_recall_overflow", args: { cacheKey: "rcl-test" } },
      { name: "knowledge_get", args: { id: 1 } },
      { name: "knowledge_update_status", args: { id: 1, status: "archived" } },
      { name: "schedule_create", args: { name: "t", cron: "0 * * * *", type: "wake_agent", payload: { prompt: "hi" } } },
      { name: "schedule_remove", args: { id: "task-1" } },
      { name: "subagent_spawn", args: { name: "EchoX", task: "t" } },
      { name: "subagent_status", args: {} },
      { name: "subagent_stop", args: { id: "sub-1" } },
    ];

    for (const tool of internalTools) {
      const result = await dispatchTool(
        { name: tool.name, args: tool.args, toolCallId: `stub_check_${tool.name}` },
        baseContext,
      );
      expect(result.output).not.toContain("[STUB]");
    }
  });
});
