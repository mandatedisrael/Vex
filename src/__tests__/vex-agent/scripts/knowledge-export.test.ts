/**
 * Tests for `exportKnowledge` — the programmatic entry point of
 * src/vex-agent/scripts/knowledge-export.ts.
 *
 * Coverage focus (must-fixes from the plan):
 *   - export does NOT require loadEmbeddingConfig() (disaster recovery)
 *   - export omits embedding / embedding_model / embedding_dim from rows
 *     (vectors are NEVER carried — re-embed happens on import)
 *   - export INCLUDES all audit fields needed for import roundtrip
 *     (status, valid_from, created_at, updated_at, valid_until)
 *   - manifest is the first JSONL line, with the right shape
 *   - source_embedding_model is "<empty>" / unique value / "mixed" depending
 *     on what is actually in the DB
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunMigrations = vi.fn().mockResolvedValue(undefined);
const mockClosePool = vi.fn().mockResolvedValue(undefined);
const mockQuery = vi.fn();
const mockStreamAllForExport = vi.fn();
const mockLoadEmbeddingConfig = vi.fn(() => {
  throw new Error("loadEmbeddingConfig must NOT be called from knowledge-export");
});

vi.mock("@vex-agent/db/migrate.js", () => ({
  runMigrations: () => mockRunMigrations(),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  closePool: () => mockClosePool(),
  getPool: vi.fn(),
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/knowledge.js", () => ({
  streamAllForExport: (batchSize?: number) => mockStreamAllForExport(batchSize),
}));

// _preflight: assertSchemaUpToDate is called from exportKnowledge after
// runMigrations. Stub it to a no-op so tests do not need to mock the
// information_schema query.
vi.mock("@vex-agent/scripts/_preflight.js", () => ({
  assertExplicitDbUrl: vi.fn(),
  assertSchemaUpToDate: vi.fn().mockResolvedValue(undefined),
}));

// loadEmbeddingConfig is mocked to THROW. If export ever calls it, the
// test fails — that's the entire point of must-fix #2.
vi.mock("@vex-agent/embeddings/config.js", () => ({
  loadEmbeddingConfig: () => mockLoadEmbeddingConfig(),
  MIN_EMBEDDING_DIM: 1,
  MAX_EMBEDDING_DIM: 8192,
}));

const { exportKnowledge, EXPORT_SCHEMA_FIELDS } = await import(
  "@vex-agent/scripts/knowledge-export.js"
);

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    kind: "memo",
    title: "test title",
    summary: "test summary",
    contentMd: "## body\n\ndetail",
    tags: ["solana"],
    sourceRefs: { protocol_executions: [1] },
    confidence: 0.7,
    status: "active",
    pinned: false,
    validFrom: "2026-04-06T12:00:00Z",
    validUntil: "2026-04-13T12:00:00Z",
    contentHash: "a".repeat(64),
    embeddingModel: "ai/embeddinggemma:300M-Q8_0",
    embeddingDim: 768,
    sourceSurface: "vex_agent",
    sourceSession: null,
    source: "observed",
    // v2 lifecycle fields — default to null so plain makeEntry() acts like a
    // fresh active entry with no lineage. Tests that exercise supersede
    // roundtrip override these.
    supersedesId: null,
    statusReason: null,
    changeSummary: null,
    whatFailed: null,
    supersedesContentHash: null,
    // memory-v2 influence fields — default to the legacy-equivalent values so
    // plain makeEntry() mirrors a fresh established entry. Fidelity tests override.
    maturityState: "established",
    activationStrength: 1.0,
    influenceScope: "advisory",
    decayPolicy: "none",
    regimeTags: [],
    firstPromotedAt: null,
    lastReinforcedAt: null,
    nextReviewAt: null,
    outcomeVersion: 0,
    createdAt: "2026-04-06T12:00:00Z",
    updatedAt: "2026-04-06T12:00:00Z",
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
  get text(): string {
    return this.chunks.join("");
  }
  get jsonlLines(): string[] {
    return this.text
      .split("\n")
      .filter((line) => line.length > 0);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadEmbeddingConfig.mockImplementation(() => {
    throw new Error("loadEmbeddingConfig must NOT be called from knowledge-export");
  });
});

describe("exportKnowledge", () => {
  // ── Disaster recovery: no embedding config (must-fix #2) ─────

  it("does NOT call loadEmbeddingConfig (export must work even when provider is broken)", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "ai/embeddinggemma:300M-Q8_0" }]);
    mockStreamAllForExport.mockReturnValueOnce(asyncIterableOf([makeEntry()]));
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    expect(mockLoadEmbeddingConfig).not.toHaveBeenCalled();
  });

  // ── Manifest shape ───────────────────────────────────────────

  it("writes a manifest as the first JSONL line", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "ai/embeddinggemma:300M-Q8_0" }]);
    mockStreamAllForExport.mockReturnValueOnce(asyncIterableOf([makeEntry()]));
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const lines = sink.jsonlLines;
    expect(lines.length).toBe(2); // manifest + 1 entry
    const manifest = JSON.parse(lines[0]!);
    expect(manifest.__type).toBe("vex_knowledge_export");
    expect(manifest.version).toBe(3);
    expect(manifest.schema_fields).toEqual(EXPORT_SCHEMA_FIELDS);
    expect(typeof manifest.exported_at).toBe("string");
  });

  it("source_embedding_model = '<empty>' when no rows exist", async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockStreamAllForExport.mockReturnValueOnce(asyncIterableOf([]));
    const sink = new CapturingSink();
    const count = await exportKnowledge(sink);
    expect(count).toBe(0);
    const manifest = JSON.parse(sink.jsonlLines[0]!);
    expect(manifest.source_embedding_model).toBe("<empty>");
  });

  it("source_embedding_model = unique value when all rows share one model", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "qwen3-embedding-0.6b" }]);
    mockStreamAllForExport.mockReturnValueOnce(asyncIterableOf([makeEntry()]));
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const manifest = JSON.parse(sink.jsonlLines[0]!);
    expect(manifest.source_embedding_model).toBe("qwen3-embedding-0.6b");
  });

  it("source_embedding_model = 'mixed' when multiple distinct models exist", async () => {
    mockQuery.mockResolvedValueOnce([
      { embedding_model: "ai/embeddinggemma:300M-Q8_0" },
      { embedding_model: "qwen3-embedding-0.6b" },
    ]);
    mockStreamAllForExport.mockReturnValueOnce(asyncIterableOf([makeEntry()]));
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const manifest = JSON.parse(sink.jsonlLines[0]!);
    expect(manifest.source_embedding_model).toBe("mixed");
  });

  // ── Row shape: NO vectors / model / dim, BUT all audit fields ─

  it("entry rows do NOT contain embedding / embedding_model / embedding_dim", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "x" }]);
    mockStreamAllForExport.mockReturnValueOnce(asyncIterableOf([makeEntry()]));
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const row = JSON.parse(sink.jsonlLines[1]!);
    expect(row.embedding).toBeUndefined();
    expect(row.embedding_model).toBeUndefined();
    expect(row.embedding_dim).toBeUndefined();
    expect(row.embeddingModel).toBeUndefined();
    expect(row.embeddingDim).toBeUndefined();
  });

  it("entry rows DO contain all audit fields needed for import roundtrip (must-fix #1)", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "x" }]);
    mockStreamAllForExport.mockReturnValueOnce(
      asyncIterableOf([
        makeEntry({
          status: "invalidated",
          pinned: true,
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: null,
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-06-01T00:00:00Z",
        }),
      ]),
    );
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const row = JSON.parse(sink.jsonlLines[1]!);
    expect(row.status).toBe("invalidated");
    expect(row.pinned).toBe(true);
    expect(row.valid_from).toBe("2025-01-01T00:00:00Z");
    expect(row.valid_until).toBeNull();
    expect(row.created_at).toBe("2025-01-01T00:00:00Z");
    expect(row.updated_at).toBe("2025-06-01T00:00:00Z");
    expect(row.content_hash).toBe("a".repeat(64));
  });

  it("emits all schema_fields for every entry row", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "x" }]);
    mockStreamAllForExport.mockReturnValueOnce(asyncIterableOf([makeEntry()]));
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const row = JSON.parse(sink.jsonlLines[1]!);
    for (const field of EXPORT_SCHEMA_FIELDS) {
      expect(row).toHaveProperty(field);
    }
  });

  it("successor entry carries supersedes_content_hash + lifecycle fields", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "x" }]);
    mockStreamAllForExport.mockReturnValueOnce(
      asyncIterableOf([
        makeEntry({
          id: 2,
          status: "active",
          supersedesId: 1,
          supersedesContentHash: "b".repeat(64),
          changeSummary: "threshold tightened",
          whatFailed: "false positives rose in Q1",
        }),
      ]),
    );
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const row = JSON.parse(sink.jsonlLines[1]!);
    expect(row.supersedes_content_hash).toBe("b".repeat(64));
    expect(row.change_summary).toBe("threshold tightened");
    expect(row.what_failed).toBe("false positives rose in Q1");
    expect(row.status_reason).toBeNull();
  });

  it("superseded predecessor row carries status_reason (no successor link from its side)", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "x" }]);
    mockStreamAllForExport.mockReturnValueOnce(
      asyncIterableOf([
        makeEntry({
          id: 1,
          status: "superseded",
          statusReason: "replaced by tighter rule",
        }),
      ]),
    );
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const row = JSON.parse(sink.jsonlLines[1]!);
    expect(row.status).toBe("superseded");
    expect(row.status_reason).toBe("replaced by tighter rule");
    expect(row.supersedes_content_hash).toBeNull();
  });

  it("emits provenance fields (source_surface + source_session) verbatim", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "x" }]);
    mockStreamAllForExport.mockReturnValueOnce(
      asyncIterableOf([
        makeEntry({
          id: 5,
          sourceSurface: "mcp_local",
          sourceSession: "mcp-stdio-abc123",
        }),
      ]),
    );
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const row = JSON.parse(sink.jsonlLines[1]!);
    expect(row.source_surface).toBe("mcp_local");
    expect(row.source_session).toBe("mcp-stdio-abc123");
  });

  it("vex_agent default provenance survives roundtrip unchanged", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "x" }]);
    mockStreamAllForExport.mockReturnValueOnce(asyncIterableOf([makeEntry()]));
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const row = JSON.parse(sink.jsonlLines[1]!);
    expect(row.source_surface).toBe("vex_agent");
    expect(row.source_session).toBeNull();
  });

  // ── FIX-2: source + memory-v2 influence emitted verbatim (snake_case) ─

  it("emits source + all memory-v2 influence fields verbatim (FIX-2)", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "x" }]);
    mockStreamAllForExport.mockReturnValueOnce(
      asyncIterableOf([
        makeEntry({
          id: 11,
          source: "inferred",
          maturityState: "reinforced",
          activationStrength: 0.25,
          influenceScope: "retrieval_boost",
          decayPolicy: "time",
          regimeTags: ["bull", "high_vol"],
          firstPromotedAt: "2026-04-01T00:00:00Z",
          lastReinforcedAt: "2026-04-05T00:00:00Z",
          nextReviewAt: "2026-05-01T00:00:00Z",
          outcomeVersion: 4,
        }),
      ]),
    );
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    const row = JSON.parse(sink.jsonlLines[1]!);
    expect(row.source).toBe("inferred");
    expect(row.maturity_state).toBe("reinforced");
    expect(row.activation_strength).toBe(0.25);
    expect(row.influence_scope).toBe("retrieval_boost");
    expect(row.decay_policy).toBe("time");
    expect(row.regime_tags).toEqual(["bull", "high_vol"]);
    expect(row.first_promoted_at).toBe("2026-04-01T00:00:00Z");
    expect(row.last_reinforced_at).toBe("2026-04-05T00:00:00Z");
    expect(row.next_review_at).toBe("2026-05-01T00:00:00Z");
    expect(row.outcome_version).toBe(4);
  });

  it("returns the count of entries written (manifest is not counted)", async () => {
    mockQuery.mockResolvedValueOnce([{ embedding_model: "x" }]);
    mockStreamAllForExport.mockReturnValueOnce(
      asyncIterableOf([makeEntry({ id: 1 }), makeEntry({ id: 2 }), makeEntry({ id: 3 })]),
    );
    const sink = new CapturingSink();
    const count = await exportKnowledge(sink);
    expect(count).toBe(3);
    expect(sink.jsonlLines.length).toBe(4); // manifest + 3 rows
  });

  // ── Migrations are run (so a fresh DB exports cleanly) ───────

  it("runs migrations before streaming", async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockStreamAllForExport.mockReturnValueOnce(asyncIterableOf([]));
    const sink = new CapturingSink();
    await exportKnowledge(sink);
    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
  });
});
