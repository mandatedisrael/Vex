/**
 * Tests for `reembedKnowledge` — the programmatic entry point of
 * src/echo-agent/scripts/knowledge-reembed.ts.
 *
 * Coverage focus (updated for PR4 Fase III maintenance lease):
 *   - pre-check: refuses to run on dim mismatch (must use export-wipe-import)
 *   - maintenance lease acquired before the loop starts
 *   - refuses to run when lease held by another owner (`MaintenanceActiveError`)
 *   - lease is released in `finally` even when the loop throws
 *   - same-dim happy path: streams rows whose embedding_model differs,
 *     re-embeds each, calls updateEmbedding
 *   - --force re-embeds matching rows too
 *   - --dry-run reports planned count without calling provider, DB, or lease
 *   - per-row failure increments `failed`, continues to the next row
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_DIM = 768;

const mockRunMigrations = vi.fn().mockResolvedValue(undefined);
const mockClosePool = vi.fn().mockResolvedValue(undefined);
const mockFindRowsWithDimNotMatching = vi.fn();
const mockStreamRowsForReembed = vi.fn();
const mockUpdateEmbedding = vi.fn();
const mockEmbedDocument = vi.fn();
const mockLoadEmbeddingConfig = vi.fn();

// Lease module: acquire / release called by reembed under the real contract
// (Fase III). We track calls so tests can assert acquire runs before the
// stream loop and release runs after — including when the loop throws.
const mockAcquireLease = vi.fn();
const mockReleaseLease = vi.fn();

// ── Class mock for MaintenanceActiveError ────────────────────────────
class MaintenanceActiveErrorMock extends Error {
  readonly code = "MAINTENANCE_ACTIVE" as const;
  readonly ownerId: string;
  constructor(ownerId: string) {
    super(`maintenance active — lease held by "${ownerId}"`);
    this.name = "MaintenanceActiveError";
    this.ownerId = ownerId;
  }
}

// ── Pool mock — reembed calls getPool().connect() twice (acquire + release)
const mockLeaseClientRelease = vi.fn();
const mockPoolConnect = vi.fn();

vi.mock("@echo-agent/db/migrate.js", () => ({
  runMigrations: () => mockRunMigrations(),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  closePool: () => mockClosePool(),
  getPool: () => ({ connect: () => mockPoolConnect() }),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@echo-agent/db/repos/maintenance-lease.js", () => ({
  MaintenanceActiveError: MaintenanceActiveErrorMock,
  acquireReembedLease: (client: unknown, ownerId: string) => mockAcquireLease(client, ownerId),
  releaseReembedLease: (client: unknown, ownerId: string) => mockReleaseLease(client, ownerId),
  withLeaseSharedLock: vi.fn(),
  inspectLease: vi.fn(),
}));

vi.mock("@echo-agent/db/repos/knowledge.js", () => ({
  findRowsWithDimNotMatching: (dim: number) => mockFindRowsWithDimNotMatching(dim),
  streamRowsForReembed: (model: string, opts?: unknown) => mockStreamRowsForReembed(model, opts),
  updateEmbedding: (...args: unknown[]) => mockUpdateEmbedding(...args),
  // Still exported for observability; no longer consumed by reembed but other
  // callers may pull it via this bundle.
  isRuntimeActive: vi.fn().mockResolvedValue(false),
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
  mockFindRowsWithDimNotMatching.mockResolvedValue(0);
  mockEmbedDocument.mockResolvedValue({
    embedding: makeEmbedding(),
    providerModel: "new-model",
  });
  mockUpdateEmbedding.mockResolvedValue(true);
  mockStreamRowsForReembed.mockReturnValue(asyncIterableOf([]));

  // Lease: default to idempotent success.
  mockAcquireLease.mockResolvedValue(undefined);
  mockReleaseLease.mockResolvedValue(undefined);

  // Pool: each connect() returns a fresh fake client with release().
  mockLeaseClientRelease.mockReset();
  mockPoolConnect.mockImplementation(async () => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: () => mockLeaseClientRelease(),
  }));
});

describe("reembedKnowledge", () => {
  // ── Pre-check: dim mismatch ──────────────────────────────────

  it("aborts when any row has a different embedding_dim than current config", async () => {
    mockFindRowsWithDimNotMatching.mockResolvedValueOnce(5);
    await expect(reembedKnowledge()).rejects.toThrow(
      /5 row\(s\) in knowledge_entries have embedding_dim != 768/,
    );
    expect(mockStreamRowsForReembed).not.toHaveBeenCalled();
    expect(mockAcquireLease).not.toHaveBeenCalled();
  });

  it("dim mismatch abort points to export → wipe → import flow", async () => {
    mockFindRowsWithDimNotMatching.mockResolvedValueOnce(1);
    await expect(reembedKnowledge()).rejects.toThrow(/export → wipe → import/);
  });

  // ── Maintenance lease gating ─────────────────────────────────

  it("acquires the maintenance lease before starting the reembed loop", async () => {
    const callOrder: string[] = [];
    mockAcquireLease.mockImplementationOnce(async () => {
      callOrder.push("acquire");
    });
    mockStreamRowsForReembed.mockImplementationOnce(() => {
      callOrder.push("stream");
      return asyncIterableOf([]);
    });
    await reembedKnowledge();
    expect(callOrder).toEqual(["acquire", "stream"]);
    expect(mockAcquireLease).toHaveBeenCalledTimes(1);
    const [, ownerId] = mockAcquireLease.mock.calls[0]!;
    expect(ownerId).toMatch(/^reembed:pid-\d+$/);
  });

  it("releases the lease after a successful loop", async () => {
    mockStreamRowsForReembed.mockReturnValueOnce(asyncIterableOf([makeRow(1)]));
    await reembedKnowledge();
    expect(mockReleaseLease).toHaveBeenCalledTimes(1);
    const [, releaseOwner] = mockReleaseLease.mock.calls[0]!;
    const [, acquireOwner] = mockAcquireLease.mock.calls[0]!;
    expect(releaseOwner).toBe(acquireOwner);
  });

  it("releases the lease even when the loop throws", async () => {
    // Probe call succeeds; then the stream iterator is set up, but the first
    // per-row embed fails. The loop catches row-level errors and continues,
    // so we simulate a harder failure: the stream itself throws during
    // iteration.
    mockStreamRowsForReembed.mockImplementationOnce(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error("stream boom");
      },
    }));
    await expect(reembedKnowledge()).rejects.toThrow(/stream boom/);
    expect(mockAcquireLease).toHaveBeenCalledTimes(1);
    expect(mockReleaseLease).toHaveBeenCalledTimes(1);
  });

  it("fails loud when another owner already holds the lease", async () => {
    mockAcquireLease.mockRejectedValueOnce(new MaintenanceActiveErrorMock("other-pid-99"));
    const err = await reembedKnowledge().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).toMatch(/Cannot start reembed/);
    expect(msg).toMatch(/other-pid-99/);
    // Surface the operator recovery hint in the error message.
    expect(msg).toMatch(/UPDATE maintenance_leases SET active = FALSE WHERE id = 1/);
    // No reembed work runs when acquisition fails.
    expect(mockStreamRowsForReembed).not.toHaveBeenCalled();
    expect(mockReleaseLease).not.toHaveBeenCalled();
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

  it("probes the provider once at start to discover currentProviderModel", async () => {
    await reembedKnowledge();
    // The first call is the probe with the special title.
    expect(mockEmbedDocument).toHaveBeenCalled();
    const [probeTitle, probeSummary] = mockEmbedDocument.mock.calls[0]!;
    expect(probeTitle).toBe("__schema_probe__");
    expect(probeSummary).toBe("ignore");
  });

  it("uses providerModel from the probe as the streamRowsForReembed key (alias case)", async () => {
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

  it("--dry-run is a pure preview: NO provider calls, NO DB writes, NO lease acquired", async () => {
    mockStreamRowsForReembed.mockReturnValueOnce(
      asyncIterableOf([makeRow(1), makeRow(2)]),
    );
    const report = await reembedKnowledge({ dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.plannedCount).toBe(2);
    expect(report.reembedded).toBe(0);
    expect(mockEmbedDocument).not.toHaveBeenCalled();
    expect(mockUpdateEmbedding).not.toHaveBeenCalled();
    expect(mockAcquireLease).not.toHaveBeenCalled();
    expect(mockReleaseLease).not.toHaveBeenCalled();
  });

  it("--dry-run survives a broken embedding provider (regression for R3 finding)", async () => {
    mockEmbedDocument.mockRejectedValue(new Error("ECONNREFUSED 12434"));
    mockStreamRowsForReembed.mockReturnValueOnce(asyncIterableOf([makeRow(1)]));
    const report = await reembedKnowledge({ dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.plannedCount).toBe(1);
    expect(mockEmbedDocument).not.toHaveBeenCalled();
  });

  it("--dry-run uses config.model as model-name proxy (acceptable for non-aliasing providers)", async () => {
    mockStreamRowsForReembed.mockReturnValueOnce(asyncIterableOf([]));
    await reembedKnowledge({ dryRun: true });
    const [streamKey] = mockStreamRowsForReembed.mock.calls[0]!;
    expect(streamKey).toBe("new-model");
  });

  // ── Per-row failure ──────────────────────────────────────────

  it("counts a failed embed as failed and continues to the next row", async () => {
    mockStreamRowsForReembed.mockReturnValueOnce(
      asyncIterableOf([makeRow(1), makeRow(2), makeRow(3)]),
    );
    mockEmbedDocument
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "new-model" })
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "new-model" })
      .mockRejectedValueOnce(new Error("provider boom"))
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "new-model" });
    const report = await reembedKnowledge();
    expect(report.reembedded).toBe(2);
    expect(report.failed).toBe(1);
    // Per-row failure does NOT skip lease release.
    expect(mockReleaseLease).toHaveBeenCalledTimes(1);
  });

  it("counts updateEmbedding returning false as failed", async () => {
    mockStreamRowsForReembed.mockReturnValueOnce(asyncIterableOf([makeRow(1)]));
    mockUpdateEmbedding.mockResolvedValueOnce(false);
    const report = await reembedKnowledge();
    expect(report.reembedded).toBe(0);
    expect(report.failed).toBe(1);
  });
});
