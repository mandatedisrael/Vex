/**
 * Unit tests for db/repos/knowledge — public API module.
 *
 * Entry point owns `vi.mock("@echo-agent/db/client.js")` (hoisted per-file)
 * plus fixture factories; concern-specific `it(...)` cases live in
 * `./knowledge/*-suite.ts` and receive a SuiteCtx object for shared mock state.
 *
 * The repo module itself is now a barrel over `./knowledge/` submodules, but
 * test-time imports go through the barrel path — exercising the public
 * surface is exactly what we want to assert.
 */

import { describe, vi, beforeEach } from "vitest";

import { crudSuite } from "./knowledge/crud-suite.js";
import { recallSuite } from "./knowledge/recall-suite.js";
import { hotContextSuite } from "./knowledge/hot-context-suite.js";
import { exportSuite } from "./knowledge/export-suite.js";
import { reembedSuite } from "./knowledge/reembed-suite.js";
import { lineageSuite } from "./knowledge/lineage-suite.js";

const mockExecute = vi.fn().mockResolvedValue(0);
const mockQueryOne = vi.fn().mockResolvedValue(null);
const mockQuery = vi.fn().mockResolvedValue([]);

// PR4 Fase I.a: crud.ts and recall.ts use `getPool()` + `queryOneWith` /
// `queryWith` / `executeWith` — keep the legacy `query/queryOne/execute`
// passthroughs so existing tests continue to work, and mock the new helpers
// to delegate to the same mocks so tests don't need to rewrite their
// expectations.
const fakePool = { connect: async () => ({ query: vi.fn(), release: vi.fn() }) };

vi.mock("@echo-agent/db/client.js", () => ({
  getPool: () => fakePool,
  execute: (...args: unknown[]) => mockExecute(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  executeWith: (_exec: unknown, ...args: unknown[]) => mockExecute(...args),
  queryOneWith: (_exec: unknown, ...args: unknown[]) => mockQueryOne(...args),
  queryWith: (_exec: unknown, ...args: unknown[]) => mockQuery(...args),
}));

const {
  insertEntry,
  getById,
  findByContentHash,
  updateStatus,
  updateEmbedding,
  recallTopK,
  listActiveForHotContext,
  listKnownKinds,
  streamAllForExport,
  streamRowsForReembed,
  findRowsWithDimNotMatching,
  isRuntimeActive,
  getLineageChain,
  listHistory,
} = await import("@echo-agent/db/repos/knowledge.js");

const SAMPLE_HASH = "0".repeat(64);

const SAMPLE_ROW = {
  id: 42,
  kind: "strategy_rule",
  title: "test title",
  summary: "test summary",
  content_md: "full markdown",
  tags: ["solana"],
  source_refs: { protocol_executions: [1] },
  confidence: 0.7,
  status: "active",
  pinned: false,
  valid_from: "2026-04-06T12:00:00Z",
  valid_until: "2026-04-13T12:00:00Z",
  content_hash: SAMPLE_HASH,
  embedding_model: "ai/embeddinggemma:300M-Q8_0",
  embedding_dim: 768,
  created_at: "2026-04-06T12:00:00Z",
  updated_at: "2026-04-06T12:00:00Z",
};

function makeEmbedding(dim = 768): number[] {
  return Array.from({ length: dim }, (_, i) => i / dim);
}

function baseInsertInput() {
  return {
    kind: "strategy_rule",
    title: "test title",
    summary: "test summary",
    contentMd: "full markdown",
    tags: ["solana"],
    sourceRefs: { protocol_executions: [1] },
    confidence: 0.7,
    pinned: false,
    validUntil: new Date("2026-04-13T12:00:00Z"),
    contentHash: SAMPLE_HASH,
    embeddingModel: "ai/embeddinggemma:300M-Q8_0",
    embeddingDim: 768,
    embedding: makeEmbedding(768),
  };
}

describe("knowledge repo", () => {
  beforeEach(() => {
    // mockReset() also clears the queue from `mockResolvedValueOnce` so a
    // never-consumed once-mock from a previous test cannot bleed into the
    // next one. clearAllMocks() only resets call history, not the queue.
    mockExecute.mockReset();
    mockExecute.mockResolvedValue(0);
    mockQueryOne.mockReset();
    mockQueryOne.mockResolvedValue(null);
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
  });

  const ctx = {
    insertEntry,
    getById,
    findByContentHash,
    updateStatus,
    updateEmbedding,
    recallTopK,
    listActiveForHotContext,
    listKnownKinds,
    streamAllForExport,
    streamRowsForReembed,
    findRowsWithDimNotMatching,
    isRuntimeActive,
    getLineageChain,
    listHistory,
    mockExecute,
    mockQueryOne,
    mockQuery,
    SAMPLE_HASH,
    SAMPLE_ROW,
    makeEmbedding,
    baseInsertInput,
  };

  crudSuite(ctx);
  recallSuite(ctx);
  hotContextSuite(ctx);
  exportSuite(ctx);
  reembedSuite(ctx);
  lineageSuite(ctx);
});
