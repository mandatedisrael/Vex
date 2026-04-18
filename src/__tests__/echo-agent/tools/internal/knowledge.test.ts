/**
 * Dedicated unit tests for knowledge_* handlers.
 *
 * Coverage matrix per handler is intentional — the dispatcher-knowledge-*.test.ts
 * files cover routing and headline cases through dispatchTool, but the most risky paths
 * (TTL bounds, embedding format, pinned semantics, kind validation, source_refs
 * serialization, fail-loud contracts) need direct asserts on the handler shape.
 *
 * Entry point owns `vi.mock()` registrations (hoisted per-file) and fixture
 * factories; concern-specific `it(...)` cases live in `./knowledge/*-suite.ts`
 * and receive a SuiteCtx object for shared mock state.
 */

import { describe, vi, beforeEach } from "vitest";

import { writeSuite } from "./knowledge/write-suite.js";
import { recallSuite } from "./knowledge/recall-suite.js";
import { recallOverflowSuite } from "./knowledge/recall-overflow-suite.js";
import { getSuite } from "./knowledge/get-suite.js";
import { updateStatusSuite } from "./knowledge/update-status-suite.js";
import { lineageSuite } from "./knowledge/lineage-suite.js";
import { historySuite } from "./knowledge/history-suite.js";

const TEST_DIM = 768;
const TEST_PROVIDER_MODEL = "ai/embeddinggemma:300M-Q8_0";

// ── Mocks — DB repos ─────────────────────────────────────────────

const mockInsertEntry = vi.fn();
const mockFindByContentHash = vi.fn();
const mockGetById = vi.fn();
const mockUpdateStatus = vi.fn();
const mockRecallTopK = vi.fn();
const mockListActive = vi.fn().mockResolvedValue([]);
const mockListKinds = vi.fn().mockResolvedValue([]);
const mockGetLineageChain = vi.fn();
const mockListHistory = vi.fn().mockResolvedValue([]);

vi.mock("@echo-agent/db/repos/knowledge.js", () => ({
  insertEntry: (...args: unknown[]) => mockInsertEntry(...args),
  findByContentHash: (...args: unknown[]) => mockFindByContentHash(...args),
  getById: (...args: unknown[]) => mockGetById(...args),
  updateStatus: (...args: unknown[]) => mockUpdateStatus(...args),
  recallTopK: (...args: unknown[]) => mockRecallTopK(...args),
  listActiveForHotContext: (...args: unknown[]) => mockListActive(...args),
  listKnownKinds: (...args: unknown[]) => mockListKinds(...args),
  getLineageChain: (...args: unknown[]) => mockGetLineageChain(...args),
  listHistory: (...args: unknown[]) => mockListHistory(...args),
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

// PR4 Fase III — knowledge_write wraps insertEntry in withLeaseSharedLock.
// Stub it to a pass-through so unit tests don't need a real pool/maintenance
// lease row. The wrap behaviour (SHARE lock + MaintenanceActiveError fail
// path) is covered by maintenance-lease unit + integration tests.
vi.mock("@echo-agent/db/repos/maintenance-lease.js", () => ({
  withLeaseSharedLock: async <T>(
    _pool: unknown,
    fn: (tx: unknown) => Promise<T>,
  ): Promise<T> => fn({ query: () => ({ rows: [], rowCount: 0 }) }),
  MaintenanceActiveError: class MaintenanceActiveError extends Error {
    readonly code = "MAINTENANCE_ACTIVE" as const;
    readonly ownerId: string;
    constructor(ownerId: string) {
      super(`maintenance active — lease held by "${ownerId}"`);
      this.name = "MaintenanceActiveError";
      this.ownerId = ownerId;
    }
  },
  acquireReembedLease: vi.fn(),
  releaseReembedLease: vi.fn(),
  inspectLease: vi.fn(),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  getPool: () => ({ connect: async () => ({ query: vi.fn(), release: vi.fn() }) }),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

// ── Handler imports via the barrel public API ───────────────────

const {
  handleKnowledgeWrite,
  handleKnowledgeRecall,
  handleKnowledgeRecallOverflow,
  handleKnowledgeGet,
  handleKnowledgeUpdateStatus,
  handleKnowledgeLineage,
  handleKnowledgeHistory,
} = await import("@echo-agent/tools/internal/knowledge.js");

import { makeTestContext } from "../_test-context.js";

// ── Fixtures ─────────────────────────────────────────────────────

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
  mockUpdateStatus.mockResolvedValue({ ok: true });
  mockLoadEmbeddingConfig.mockReturnValue({
    baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
    model: "ai/embeddinggemma:300M-Q8_0",
    dim: TEST_DIM,
    provider: "local",
  });
});

describe("internal/knowledge handlers", () => {
  const ctx = {
    handleKnowledgeWrite,
    handleKnowledgeRecall,
    handleKnowledgeRecallOverflow,
    handleKnowledgeGet,
    handleKnowledgeUpdateStatus,
    handleKnowledgeLineage,
    handleKnowledgeHistory,
    makeTestContext,
    mockInsertEntry,
    mockFindByContentHash,
    mockGetById,
    mockUpdateStatus,
    mockRecallTopK,
    mockGetLineageChain,
    mockListHistory,
    mockCacheWrite,
    mockCacheRead,
    mockCacheCleanup,
    mockGenerateCacheKey,
    mockEmbedDocument,
    mockEmbedQuery,
    makeEmbedding,
    makeEmbedResult,
    makeInsertEntryRecord,
    makeInsertResult,
    makeCandidate,
    TEST_DIM,
    TEST_PROVIDER_MODEL,
  };

  writeSuite(ctx);
  recallSuite(ctx);
  recallOverflowSuite(ctx);
  getSuite(ctx);
  updateStatusSuite(ctx);
  lineageSuite(ctx);
  historySuite(ctx);
});
