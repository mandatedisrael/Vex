/**
 * FIX-2 export→import SERIALIZATION round-trip (no DB).
 *
 * This pipes the real `exportKnowledge` JSONL output straight into the real
 * `importKnowledge` reader, with only the DB / embedding edges mocked. It
 * proves the end-to-end fidelity FIX-2 demands: `source` AND every memory-v2
 * influence/bi-temporal field written by export are read back and forwarded to
 * `insertEntry` unchanged. A regression on EITHER side (export dropping a
 * column, import failing to read it) fails this test.
 *
 * A live Postgres + embedding endpoint is NOT required — both ends are mocked,
 * so this is the unit-level proof of the round-trip. The DB-backed variant
 * (export a real row, import into a fresh DB, re-query) is integration-only and
 * is noted in the S1a report as DB-gated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockStreamAllForExport = vi.fn();
const mockInsertEntry = vi.fn();
const mockFindByContentHash = vi.fn();
const mockEmbedDocument = vi.fn();

const TEST_DIM = 768;
const TEST_PROVIDER_MODEL = "ai/embeddinggemma:300M-Q8_0";

vi.mock("@vex-agent/db/migrate.js", () => ({
  runMigrations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  closePool: vi.fn().mockResolvedValue(undefined),
  getPool: () => ({}),
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@vex-agent/scripts/_preflight.js", () => ({
  assertExplicitDbUrl: vi.fn(),
  assertSchemaUpToDate: vi.fn().mockResolvedValue(undefined),
}));

// One module backs both scripts: export reads streamAllForExport, import writes
// insertEntry + findByContentHash.
vi.mock("@vex-agent/db/repos/knowledge.js", () => ({
  streamAllForExport: (batchSize?: number) => mockStreamAllForExport(batchSize),
  insertEntry: (...args: unknown[]) => mockInsertEntry(...args),
  findByContentHash: (...args: unknown[]) => mockFindByContentHash(...args),
}));

vi.mock("@vex-agent/db/repos/maintenance-lease.js", () => ({
  MaintenanceActiveError: class MaintenanceActiveError extends Error {},
  withLeaseSharedLock: (_pool: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ query: vi.fn() }),
}));

vi.mock("@vex-agent/embeddings/client.js", () => ({
  embedDocument: (...args: unknown[]) => mockEmbedDocument(...args),
  embedQuery: vi.fn(),
  formatDocumentInput: (t: string, s: string) => `title: ${t} | text: ${s}`,
  formatQueryInput: (q: string) => `task: search result | query: ${q}`,
}));

vi.mock("@vex-agent/embeddings/config.js", () => ({
  loadEmbeddingConfig: () => ({
    baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
    model: TEST_PROVIDER_MODEL,
    dim: TEST_DIM,
    provider: "local",
  }),
  MIN_EMBEDDING_DIM: 1,
  MAX_EMBEDDING_DIM: 8192,
}));

const { exportKnowledge } = await import("@vex-agent/scripts/knowledge-export.js");
const { importKnowledge } = await import("@vex-agent/scripts/knowledge-import.js");

/** A full KnowledgeEntryForExport with NON-default source + v2 influence values. */
function makeExportEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    kind: "risk_rule",
    title: "cap 5%",
    summary: "position size must stay under 5%",
    contentMd: "## rule\n\nkeep size <= 5% of equity",
    tags: ["risk"],
    sourceRefs: { protocol_executions: [1] },
    confidence: 0.9,
    status: "active",
    pinned: true,
    validFrom: "2026-04-01T00:00:00Z",
    validUntil: null,
    contentHash: "a".repeat(64),
    embeddingModel: TEST_PROVIDER_MODEL,
    embeddingDim: TEST_DIM,
    sourceSurface: "vex_agent",
    sourceSession: null,
    source: "inferred",
    supersedesId: null,
    statusReason: null,
    changeSummary: null,
    whatFailed: null,
    supersedesContentHash: null,
    maturityState: "reinforced",
    activationStrength: 0.25,
    influenceScope: "retrieval_boost",
    decayPolicy: "time",
    regimeTags: ["bull", "high_vol"],
    firstPromotedAt: "2026-04-02T00:00:00Z",
    lastReinforcedAt: "2026-04-05T00:00:00Z",
    nextReviewAt: "2026-05-01T00:00:00Z",
    outcomeVersion: 4,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-06T00:00:00Z",
    ...overrides,
  };
}

function asyncIterableOf<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

class CapturingSink {
  public chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  get jsonl(): string[] {
    return this.chunks.join("").split("\n").filter((l) => l.length > 0);
  }
}

async function* linesOf(ls: readonly string[]): AsyncIterable<string> {
  for (const l of ls) yield l;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue([{ embedding_model: TEST_PROVIDER_MODEL }]);
  mockFindByContentHash.mockResolvedValue(null);
  mockEmbedDocument.mockResolvedValue({
    embedding: Array.from({ length: TEST_DIM }, () => 0.1),
    providerModel: TEST_PROVIDER_MODEL,
  });
  mockInsertEntry.mockResolvedValue({ entry: { id: 1 }, inserted: true });
});

describe("knowledge export→import round-trip fidelity (FIX-2)", () => {
  it("(a) NON-default source + memory-v2 influence survive export→import identically", async () => {
    mockStreamAllForExport.mockReturnValueOnce(asyncIterableOf([makeExportEntry()]));

    const sink = new CapturingSink();
    const exported = await exportKnowledge(sink);
    expect(exported).toBe(1);

    // The export emitted a v3 manifest + one row. Feed both straight back in.
    const report = await importKnowledge(linesOf(sink.jsonl));
    expect(report.inserted).toBe(1);
    expect(report.failed).toBe(0);

    expect(mockInsertEntry).toHaveBeenCalledTimes(1);
    const arg = mockInsertEntry.mock.calls[0]![0];
    // Provenance classification (the original FIX-2 catch).
    expect(arg.source).toBe("inferred");
    // memory-v2 influence + bi-temporal fidelity.
    expect(arg.maturityState).toBe("reinforced");
    expect(arg.activationStrength).toBe(0.25);
    expect(arg.influenceScope).toBe("retrieval_boost");
    expect(arg.decayPolicy).toBe("time");
    expect(arg.regimeTags).toEqual(["bull", "high_vol"]);
    expect(arg.firstPromotedAt).toEqual(new Date("2026-04-02T00:00:00Z"));
    expect(arg.lastReinforcedAt).toEqual(new Date("2026-04-05T00:00:00Z"));
    expect(arg.nextReviewAt).toEqual(new Date("2026-05-01T00:00:00Z"));
    expect(arg.outcomeVersion).toBe(4);
    // Audit fields still roundtrip (regression guard for the existing v2 path).
    expect(arg.status).toBe("active");
  });

  it("(b) inferred → inferred (source is not silently reset to observed)", async () => {
    mockStreamAllForExport.mockReturnValueOnce(
      asyncIterableOf([makeExportEntry({ source: "inferred" })]),
    );
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    await importKnowledge(linesOf(sink.jsonl));
    const arg = mockInsertEntry.mock.calls[0]![0];
    expect(arg.source).toBe("inferred");
  });

  it("manifest emitted by export is v3 and accepted by import", async () => {
    mockStreamAllForExport.mockReturnValueOnce(asyncIterableOf([makeExportEntry()]));
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const manifest = JSON.parse(sink.jsonl[0]!);
    expect(manifest.version).toBe(3);
  });
});
