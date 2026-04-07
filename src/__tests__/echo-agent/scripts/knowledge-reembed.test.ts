/**
 * Tests for `reembedKnowledge` — the programmatic entry point of
 * src/echo-agent/scripts/knowledge-reembed.ts.
 *
 * Coverage focus (must-fixes from the plan):
 *   - pre-check 1: refuses to run when runtime_state.active = TRUE
 *   - pre-check 2: refuses to run on dim mismatch (must use export-wipe-import)
 *   - same-dim happy path: streams rows whose embedding_model differs,
 *     re-embeds each, calls updateEmbedding
 *   - --force re-embeds matching rows too
 *   - --dry-run reports planned count without calling provider/DB
 *   - per-row failure increments `failed`, continues to the next row
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_DIM = 768;
const TEST_PROVIDER_MODEL = "ai/embeddinggemma:300M-Q8_0";

const mockRunMigrations = vi.fn().mockResolvedValue(undefined);
const mockClosePool = vi.fn().mockResolvedValue(undefined);
const mockIsRuntimeActive = vi.fn();
const mockFindRowsWithDimNotMatching = vi.fn();
const mockStreamRowsForReembed = vi.fn();
const mockUpdateEmbedding = vi.fn();
const mockEmbedDocument = vi.fn();
const mockLoadEmbeddingConfig = vi.fn();

vi.mock("@echo-agent/db/migrate.js", () => ({
  runMigrations: () => mockRunMigrations(),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  closePool: () => mockClosePool(),
  getPool: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@echo-agent/db/repos/knowledge.js", () => ({
  isRuntimeActive: () => mockIsRuntimeActive(),
  findRowsWithDimNotMatching: (dim: number) => mockFindRowsWithDimNotMatching(dim),
  streamRowsForReembed: (model: string, opts?: unknown) => mockStreamRowsForReembed(model, opts),
  updateEmbedding: (...args: unknown[]) => mockUpdateEmbedding(...args),
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

// _preflight: stub assertSchemaUpToDate to a no-op so tests don't need a
// real DB. assertExplicitDbUrl is called from main(), not reembedKnowledge.
vi.mock("@echo-agent/scripts/_preflight.js", () => ({
  assertExplicitDbUrl: vi.fn(),
  assertSchemaUpToDate: vi.fn().mockResolvedValue(undefined),
}));

const { reembedKnowledge } = await import("@echo-agent/scripts/knowledge-reembed.js");

function makeEmbedding(): number[] {
  return Array.from({ length: TEST_DIM }, () => 0.1);
}

function asyncIterableOf<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function makeRow(id: number) {
  return {
    id,
    kind: "memo",
    title: `entry ${id}`,
    summary: "summary",
    contentMd: "content",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadEmbeddingConfig.mockReturnValue({
    baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
    model: "new-model",
    dim: TEST_DIM,
    provider: "local",
  });
  mockIsRuntimeActive.mockResolvedValue(false);
  mockFindRowsWithDimNotMatching.mockResolvedValue(0);
  // Default: provider returns the requested name (typical local Model Runner).
  // Tests covering the alias case override this.
  mockEmbedDocument.mockResolvedValue({
    embedding: makeEmbedding(),
    providerModel: "new-model",
  });
  mockUpdateEmbedding.mockResolvedValue(true);
  mockStreamRowsForReembed.mockReturnValue(asyncIterableOf([]));
});

describe("reembedKnowledge", () => {
  // ── Pre-check 1: runtime active ──────────────────────────────

  it("aborts with explicit message when runtime_state.active = TRUE", async () => {
    mockIsRuntimeActive.mockResolvedValueOnce(true);
    await expect(reembedKnowledge()).rejects.toThrow(/runtime_state\.active = TRUE/);
    // No row work happens
    expect(mockStreamRowsForReembed).not.toHaveBeenCalled();
    expect(mockEmbedDocument).not.toHaveBeenCalled();
    expect(mockUpdateEmbedding).not.toHaveBeenCalled();
  });

  it("abort message tells the operator to stop the FULL stack of writers (soft-guard semantics)", async () => {
    mockIsRuntimeActive.mockResolvedValueOnce(true);
    await expect(reembedKnowledge()).rejects.toThrow(/MCP server, internal tools, subagents, CLI/);
  });

  // ── Pre-check 2: dim mismatch ────────────────────────────────

  it("aborts when any row has a different embedding_dim than current config", async () => {
    mockFindRowsWithDimNotMatching.mockResolvedValueOnce(5);
    await expect(reembedKnowledge()).rejects.toThrow(
      /5 row\(s\) in knowledge_entries have embedding_dim != 768/,
    );
    expect(mockStreamRowsForReembed).not.toHaveBeenCalled();
  });

  it("dim mismatch abort points to export → wipe → import flow", async () => {
    mockFindRowsWithDimNotMatching.mockResolvedValueOnce(1);
    await expect(reembedKnowledge()).rejects.toThrow(/export → wipe → import/);
  });

  // ── Happy path ───────────────────────────────────────────────

  it("re-embeds rows whose embedding_model differs from currentProviderModel", async () => {
    mockStreamRowsForReembed.mockReturnValueOnce(
      asyncIterableOf([makeRow(1), makeRow(2), makeRow(3)]),
    );
    const report = await reembedKnowledge();
    expect(report.dryRun).toBe(false);
    expect(report.reembedded).toBe(3);
    expect(report.failed).toBe(0);
    // 1 probe + 3 row embeds = 4 total
    expect(mockEmbedDocument).toHaveBeenCalledTimes(4);
    expect(mockUpdateEmbedding).toHaveBeenCalledTimes(3);
    // updateEmbedding called with providerModel + actual response length
    const [id, model, dim, vec] = mockUpdateEmbedding.mock.calls[0]!;
    expect(id).toBe(1);
    expect(model).toBe("new-model");
    expect(dim).toBe(TEST_DIM);
    expect(vec).toHaveLength(TEST_DIM);
  });

  // ── R2 Fix 2: probe + providerModel ──────────────────────────

  it("probes the provider once at start to discover currentProviderModel", async () => {
    await reembedKnowledge();
    // The first call is the probe with the special title.
    expect(mockEmbedDocument).toHaveBeenCalled();
    const [probeTitle, probeSummary] = mockEmbedDocument.mock.calls[0]!;
    expect(probeTitle).toBe("__schema_probe__");
    expect(probeSummary).toBe("ignore");
  });

  it("uses providerModel from the probe as the streamRowsForReembed key (alias case)", async () => {
    // Provider aliases the requested name to a different one.
    mockEmbedDocument.mockResolvedValueOnce({
      embedding: makeEmbedding(),
      providerModel: "actual-aliased-model",
    });
    await reembedKnowledge();
    const [streamKey, opts] = mockStreamRowsForReembed.mock.calls[0]!;
    expect(streamKey).toBe("actual-aliased-model");
    expect(opts).toEqual({ includeMatching: false });
  });

  it("stamps providerModel from each per-row embed (NOT config.model)", async () => {
    mockStreamRowsForReembed.mockReturnValueOnce(asyncIterableOf([makeRow(1)]));
    // Probe returns one alias, the per-row embed returns another (e.g.,
    // provider rotated mid-script — pathological but tested).
    mockEmbedDocument
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "probe-alias" })
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "row-alias" });
    await reembedKnowledge();
    expect(mockUpdateEmbedding).toHaveBeenCalledTimes(1);
    const [, model] = mockUpdateEmbedding.mock.calls[0]!;
    expect(model).toBe("row-alias");
  });

  it("default mode passes includeMatching=false to streamRowsForReembed", async () => {
    await reembedKnowledge();
    const [, opts] = mockStreamRowsForReembed.mock.calls[0]!;
    expect(opts).toEqual({ includeMatching: false });
  });

  it("--force passes includeMatching=true to streamRowsForReembed", async () => {
    await reembedKnowledge({ force: true });
    const [, opts] = mockStreamRowsForReembed.mock.calls[0]!;
    expect(opts).toEqual({ includeMatching: true });
  });

  // ── Dry run ──────────────────────────────────────────────────

  it("--dry-run counts rows; calls provider once for the probe but does NOT write DB", async () => {
    mockStreamRowsForReembed.mockReturnValueOnce(
      asyncIterableOf([makeRow(1), makeRow(2)]),
    );
    const report = await reembedKnowledge({ dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.plannedCount).toBe(2);
    expect(report.reembedded).toBe(0);
    // Exactly one embed call: the probe. No per-row embeds, no DB writes.
    expect(mockEmbedDocument).toHaveBeenCalledTimes(1);
    expect(mockEmbedDocument.mock.calls[0]?.[0]).toBe("__schema_probe__");
    expect(mockUpdateEmbedding).not.toHaveBeenCalled();
  });

  // ── Per-row failure ──────────────────────────────────────────

  it("counts a failed embed as failed and continues to the next row", async () => {
    mockStreamRowsForReembed.mockReturnValueOnce(
      asyncIterableOf([makeRow(1), makeRow(2), makeRow(3)]),
    );
    // Sequence: probe (success) → row1 (success) → row2 (boom) → row3 (success)
    mockEmbedDocument
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "new-model" }) // probe
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "new-model" }) // row1
      .mockRejectedValueOnce(new Error("provider boom")) // row2
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "new-model" }); // row3
    const report = await reembedKnowledge();
    expect(report.reembedded).toBe(2);
    expect(report.failed).toBe(1);
  });

  it("counts updateEmbedding returning false as failed", async () => {
    mockStreamRowsForReembed.mockReturnValueOnce(asyncIterableOf([makeRow(1)]));
    mockUpdateEmbedding.mockResolvedValueOnce(false);
    const report = await reembedKnowledge();
    expect(report.reembedded).toBe(0);
    expect(report.failed).toBe(1);
  });
});
