/**
 * Tests for `importKnowledge` — src/echo-agent/scripts/knowledge-import.ts.
 *
 * Entry point owns `vi.mock()` registrations and fixture factories; concern-
 * specific `it(...)` cases live in `./knowledge-import/*-suite.ts` and are
 * invoked below with a shared context. Keeps the main file small while
 * preserving a single vi.mock scope (hoisted per-file).
 */

import { describe, vi, beforeEach } from "vitest";

import { manifestSuite } from "./knowledge-import/manifest-suite.js";
import { auditSuite } from "./knowledge-import/audit-suite.js";
import { shortCircuitSuite } from "./knowledge-import/short-circuit-suite.js";
import { v2LifecycleSuite } from "./knowledge-import/v2-lifecycle-suite.js";
import { v2ProvenanceSuite } from "./knowledge-import/v2-provenance-suite.js";
import { countersSuite } from "./knowledge-import/counters-suite.js";
import { leaseSuite } from "./knowledge-import/lease-suite.js";

const TEST_DIM = 768;
const TEST_PROVIDER_MODEL = "ai/embeddinggemma:300M-Q8_0";

const mockInsertEntry = vi.fn();
const mockFindByContentHash = vi.fn();
const mockRunMigrations = vi.fn().mockResolvedValue(undefined);
const mockClosePool = vi.fn().mockResolvedValue(undefined);
const mockEmbedDocument = vi.fn();
const mockLoadEmbeddingConfig = vi.fn();
const mockWithLeaseSharedLock = vi.fn();

class MaintenanceActiveErrorMock extends Error {
  readonly code = "MAINTENANCE_ACTIVE" as const;
  readonly ownerId: string;
  constructor(ownerId: string) {
    super(`maintenance active: ${ownerId}`);
    this.name = "MaintenanceActiveError";
    this.ownerId = ownerId;
  }
}

vi.mock("@echo-agent/db/repos/knowledge.js", () => ({
  insertEntry: (...args: unknown[]) => mockInsertEntry(...args),
  findByContentHash: (...args: unknown[]) => mockFindByContentHash(...args),
}));

vi.mock("@echo-agent/db/migrate.js", () => ({
  runMigrations: () => mockRunMigrations(),
}));

// _preflight is a separate module — we stub assertSchemaUpToDate so the import
// flow does not try to query a real DB. assertExplicitDbUrl is called from
// main(), not importKnowledge, so it's not in the call path here.
vi.mock("@echo-agent/scripts/_preflight.js", () => ({
  assertExplicitDbUrl: vi.fn(),
  assertSchemaUpToDate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  closePool: () => mockClosePool(),
  getPool: () => ({}),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@echo-agent/db/repos/maintenance-lease.js", () => ({
  MaintenanceActiveError: MaintenanceActiveErrorMock,
  withLeaseSharedLock: (...args: unknown[]) => mockWithLeaseSharedLock(...args),
}));

vi.mock("@echo-agent/embeddings/client.js", () => ({
  embedDocument: (...args: unknown[]) => mockEmbedDocument(...args),
  embedQuery: vi.fn(),
  formatDocumentInput: (t: string, s: string) => `title: ${t} | text: ${s}`,
  formatQueryInput: (q: string) => `task: search result | query: ${q}`,
}));

vi.mock("@echo-agent/embeddings/config.js", () => ({
  loadEmbeddingConfig: () => mockLoadEmbeddingConfig(),
  MIN_EMBEDDING_DIM: 1,
  MAX_EMBEDDING_DIM: 8192,
}));

const { importKnowledge } = await import("@echo-agent/scripts/knowledge-import.js");
const { computeContentHash } = await import("@echo-agent/knowledge/content-hash.js");

function makeEmbedding(): number[] {
  return Array.from({ length: TEST_DIM }, () => 0.1);
}

function makeManifestLine(): string {
  return JSON.stringify({
    __type: "echoclaw_knowledge_export",
    version: 1,
    schema_fields: [
      "kind",
      "title",
      "summary",
      "content_md",
      "tags",
      "source_refs",
      "confidence",
      "status",
      "pinned",
      "valid_from",
      "valid_until",
      "content_hash",
      "created_at",
      "updated_at",
    ],
    source_embedding_model: "ai/embeddinggemma:300M-Q8_0",
    exported_at: "2026-04-06T12:00:00Z",
  });
}

function makeRowLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: "memo",
    title: "test title",
    summary: "test summary",
    content_md: "## body\n\ndetail",
    tags: ["solana"],
    source_refs: { protocol_executions: [1] },
    confidence: 0.7,
    status: "active",
    pinned: false,
    valid_from: "2026-04-06T12:00:00Z",
    valid_until: "2026-04-13T12:00:00Z",
    content_hash: "deadbeef".repeat(8), // intentionally bogus — must be ignored
    created_at: "2026-04-06T12:00:00Z",
    updated_at: "2026-04-06T12:00:00Z",
    ...overrides,
  });
}

async function* lines(...ls: string[]): AsyncIterable<string> {
  for (const l of ls) yield l;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadEmbeddingConfig.mockReturnValue({
    baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
    model: "ai/embeddinggemma:300M-Q8_0",
    dim: TEST_DIM,
    provider: "local",
  });
  mockEmbedDocument.mockResolvedValue({
    embedding: makeEmbedding(),
    providerModel: TEST_PROVIDER_MODEL,
  });
  // Default: short-circuit lookup misses (rows are new). Tests that need
  // the duplicate path override this.
  mockFindByContentHash.mockResolvedValue(null);
  mockInsertEntry.mockResolvedValue({
    entry: { id: 1 },
    inserted: true,
  });
  // Default: lease helper passes through to fn with a fake tx. The lease
  // suite overrides this to simulate an active reembed (MaintenanceActiveError).
  mockWithLeaseSharedLock.mockImplementation(
    async (_pool: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ query: vi.fn() }),
  );
});

describe("importKnowledge", () => {
  const ctx = {
    importKnowledge,
    computeContentHash,
    mockInsertEntry,
    mockFindByContentHash,
    mockEmbedDocument,
    mockWithLeaseSharedLock,
    MaintenanceActiveErrorMock,
    makeManifestLine,
    makeRowLine,
    makeEmbedding,
    lines,
    TEST_DIM,
    TEST_PROVIDER_MODEL,
  };

  manifestSuite(ctx);
  auditSuite(ctx);
  shortCircuitSuite(ctx);
  v2LifecycleSuite(ctx);
  v2ProvenanceSuite(ctx);
  countersSuite(ctx);
  leaseSuite(ctx);
});
