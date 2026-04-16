/**
 * Tests for `importKnowledge` — the programmatic entry point of
 * src/echo-agent/scripts/knowledge-import.ts.
 *
 * Coverage focus (must-fixes from the plan):
 *   - audit roundtrip: status, valid_from, created_at, updated_at preserved
 *     exactly when present in the JSONL row, NOT overwritten with NOW()/'active'
 *   - content_hash recomputed locally (file's content_hash is ignored)
 *   - manifest validation: missing/wrong manifest aborts the whole import
 *   - duplicate detection: a row whose hash already exists counts as
 *     skipped_duplicate, not inserted
 *   - per-row failure: continues, increments `failed`, does not abort
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_DIM = 768;
const TEST_PROVIDER_MODEL = "ai/embeddinggemma:300M-Q8_0";

const mockInsertEntry = vi.fn();
const mockFindByContentHash = vi.fn();
const mockRunMigrations = vi.fn().mockResolvedValue(undefined);
const mockClosePool = vi.fn().mockResolvedValue(undefined);
const mockEmbedDocument = vi.fn();
const mockLoadEmbeddingConfig = vi.fn();

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
  getPool: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
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
});

describe("importKnowledge", () => {
  // ── Manifest validation ──────────────────────────────────────

  it("aborts when input is empty", async () => {
    await expect(importKnowledge(lines())).rejects.toThrow(/no manifest line found/);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("aborts when first line is not a manifest", async () => {
    await expect(
      importKnowledge(lines(makeRowLine())),
    ).rejects.toThrow(/expected manifest with __type="echoclaw_knowledge_export"/);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("aborts on unsupported manifest version", async () => {
    await expect(
      importKnowledge(
        lines(
          JSON.stringify({ __type: "echoclaw_knowledge_export", version: 99 }),
          makeRowLine(),
        ),
      ),
    ).rejects.toThrow(/unsupported manifest version 99/);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("accepts manifest version 1 (legacy backup without lifecycle fields)", async () => {
    await importKnowledge(
      lines(
        JSON.stringify({ __type: "echoclaw_knowledge_export", version: 1 }),
        makeRowLine(),
      ),
    );
    expect(mockInsertEntry).toHaveBeenCalledTimes(1);
    const arg = mockInsertEntry.mock.calls[0]![0];
    expect(arg.supersedesId).toBeNull();
    expect(arg.statusReason).toBeNull();
    expect(arg.changeSummary).toBeNull();
    expect(arg.whatFailed).toBeNull();
  });

  it("accepts manifest version 2 (current)", async () => {
    await importKnowledge(
      lines(
        JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
        makeRowLine(),
      ),
    );
    expect(mockInsertEntry).toHaveBeenCalledTimes(1);
  });

  it("aborts on malformed JSON", async () => {
    await expect(
      importKnowledge(lines(makeManifestLine(), "not json")),
    ).rejects.toThrow(/line 2: invalid JSON/);
  });

  // ── Audit roundtrip (must-fix #1) ────────────────────────────

  it("preserves status='invalidated' from the export (does NOT overwrite with 'active')", async () => {
    await importKnowledge(
      lines(
        makeManifestLine(),
        makeRowLine({ status: "invalidated", valid_until: "2025-01-01T00:00:00Z" }),
      ),
    );
    expect(mockInsertEntry).toHaveBeenCalledTimes(1);
    const arg = mockInsertEntry.mock.calls[0]![0];
    expect(arg.status).toBe("invalidated");
  });

  it("preserves valid_from / created_at / updated_at exactly", async () => {
    const validFrom = "2025-01-01T00:00:00Z";
    const createdAt = "2025-01-01T00:00:00Z";
    const updatedAt = "2025-06-01T00:00:00Z";
    await importKnowledge(
      lines(
        makeManifestLine(),
        makeRowLine({
          valid_from: validFrom,
          created_at: createdAt,
          updated_at: updatedAt,
        }),
      ),
    );
    const arg = mockInsertEntry.mock.calls[0]![0];
    expect(arg.validFrom).toBeInstanceOf(Date);
    // toISOString() emits the full millisecond form; compare on epoch ms.
    expect(arg.validFrom!.getTime()).toBe(new Date(validFrom).getTime());
    expect(arg.createdAt!.getTime()).toBe(new Date(createdAt).getTime());
    expect(arg.updatedAt!.getTime()).toBe(new Date(updatedAt).getTime());
  });

  it("preserves pinned=true through the roundtrip", async () => {
    await importKnowledge(
      lines(makeManifestLine(), makeRowLine({ pinned: true, valid_until: null })),
    );
    const arg = mockInsertEntry.mock.calls[0]![0];
    expect(arg.pinned).toBe(true);
    expect(arg.validUntil).toBeNull();
  });

  // ── Content hash is recomputed locally (must-fix #3 / hash trust) ─

  it("ignores the file's content_hash and recomputes locally", async () => {
    const row = makeRowLine({ content_hash: "ff".repeat(32) });
    await importKnowledge(lines(makeManifestLine(), row));
    const arg = mockInsertEntry.mock.calls[0]![0];
    const expected = computeContentHash({
      kind: "memo",
      title: "test title",
      summary: "test summary",
      contentMd: "## body\n\ndetail",
    });
    expect(arg.contentHash).toBe(expected);
    expect(arg.contentHash).not.toBe("ff".repeat(32));
  });

  // ── Embedding stamping (R2 Fix 2: providerModel, not config.model) ───

  it("stamps embeddingModel from providerModel (response) and embeddingDim from actual length", async () => {
    await importKnowledge(lines(makeManifestLine(), makeRowLine()));
    const arg = mockInsertEntry.mock.calls[0]![0];
    expect(arg.embeddingModel).toBe(TEST_PROVIDER_MODEL);
    expect(arg.embeddingDim).toBe(TEST_DIM);
    expect(arg.embedding).toHaveLength(TEST_DIM);
  });

  it("stamps providerModel per-row (different aliases stamp different rows)", async () => {
    mockEmbedDocument
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "alias-A" })
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "alias-B" });
    await importKnowledge(
      lines(makeManifestLine(), makeRowLine({ title: "row1" }), makeRowLine({ title: "row2" })),
    );
    expect(mockInsertEntry.mock.calls[0]![0].embeddingModel).toBe("alias-A");
    expect(mockInsertEntry.mock.calls[1]![0].embeddingModel).toBe("alias-B");
  });

  it("calls embedDocument with title + summary + config", async () => {
    await importKnowledge(lines(makeManifestLine(), makeRowLine()));
    const [t, s, cfg] = mockEmbedDocument.mock.calls[0]!;
    expect(t).toBe("test title");
    expect(s).toBe("test summary");
    expect(cfg.model).toBe("ai/embeddinggemma:300M-Q8_0");
    expect(cfg.dim).toBe(TEST_DIM);
  });

  // ── R2 Fix 3: short-circuit on findByContentHash ─────────────

  it("re-imports a backup without calling the provider when all entries already exist", async () => {
    // Every row already exists in DB → findByContentHash hits → no embedding,
    // no insert.
    mockFindByContentHash.mockResolvedValue({
      id: 1,
      kind: "memo",
      title: "x",
      summary: "x",
      contentMd: "x",
      tags: [],
      sourceRefs: {},
      confidence: null,
      status: "active",
      pinned: false,
      validFrom: "2026-04-06T12:00:00Z",
      validUntil: null,
      contentHash: "a".repeat(64),
      embeddingModel: TEST_PROVIDER_MODEL,
      embeddingDim: TEST_DIM,
      createdAt: "2026-04-06T12:00:00Z",
      updatedAt: "2026-04-06T12:00:00Z",
    });
    const report = await importKnowledge(
      lines(
        makeManifestLine(),
        makeRowLine({ title: "row1" }),
        makeRowLine({ title: "row2" }),
        makeRowLine({ title: "row3" }),
      ),
    );
    expect(report.skipped_duplicate).toBe(3);
    expect(report.inserted).toBe(0);
    expect(report.failed).toBe(0);
    expect(mockEmbedDocument).not.toHaveBeenCalled();
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("looks up content_hash BEFORE calling embedDocument (short-circuit ordering)", async () => {
    mockFindByContentHash.mockResolvedValueOnce({ id: 1 } as never);
    await importKnowledge(lines(makeManifestLine(), makeRowLine()));
    expect(mockFindByContentHash).toHaveBeenCalledTimes(1);
    expect(mockEmbedDocument).not.toHaveBeenCalled();
  });

  // ── R2 Fix 4: fail-loud on broken audit fields ───────────────

  it("fails the row when status is present but not a valid KnowledgeStatus (no silent 'active')", async () => {
    const report = await importKnowledge(
      lines(makeManifestLine(), makeRowLine({ status: "garbage" })),
    );
    expect(report.failed).toBe(1);
    expect(report.inserted).toBe(0);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("fails the row when status is present but wrong type (number)", async () => {
    const report = await importKnowledge(
      lines(makeManifestLine(), makeRowLine({ status: 42 })),
    );
    expect(report.failed).toBe(1);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("fails the row when valid_from is present but unparseable (no silent NOW())", async () => {
    const report = await importKnowledge(
      lines(makeManifestLine(), makeRowLine({ valid_from: "not-a-date" })),
    );
    expect(report.failed).toBe(1);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("fails the row when valid_until is present but unparseable (no silent null)", async () => {
    const report = await importKnowledge(
      lines(makeManifestLine(), makeRowLine({ valid_until: "garbage" })),
    );
    expect(report.failed).toBe(1);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("fails the row when created_at or updated_at is unparseable", async () => {
    const reportA = await importKnowledge(
      lines(makeManifestLine(), makeRowLine({ created_at: "junk" })),
    );
    expect(reportA.failed).toBe(1);

    const reportB = await importKnowledge(
      lines(makeManifestLine(), makeRowLine({ updated_at: "junk" })),
    );
    expect(reportB.failed).toBe(1);
  });

  it("treats null valid_until as evergreen (NOT as broken)", async () => {
    const report = await importKnowledge(
      lines(makeManifestLine(), makeRowLine({ valid_until: null })),
    );
    expect(report.inserted).toBe(1);
    expect(report.failed).toBe(0);
    const arg = mockInsertEntry.mock.calls[0]![0];
    expect(arg.validUntil).toBeNull();
  });

  it("treats missing audit fields (undefined) as defaults — not as broken", async () => {
    // Manually craft a row without status / valid_from / created_at / updated_at
    const rawRow = JSON.stringify({
      kind: "memo",
      title: "minimal",
      summary: "minimal",
      content_md: "minimal",
      valid_until: null,
      content_hash: "f".repeat(64),
    });
    const report = await importKnowledge(lines(makeManifestLine(), rawRow));
    expect(report.inserted).toBe(1);
    expect(report.failed).toBe(0);
    const arg = mockInsertEntry.mock.calls[0]![0];
    expect(arg.status).toBeUndefined();
    expect(arg.validFrom).toBeUndefined();
    expect(arg.createdAt).toBeUndefined();
    expect(arg.updatedAt).toBeUndefined();
  });

  it("continues to next row after a fail-loud broken-field row", async () => {
    const report = await importKnowledge(
      lines(
        makeManifestLine(),
        makeRowLine({ title: "ok 1" }),
        makeRowLine({ title: "broken", status: "garbage" }),
        makeRowLine({ title: "ok 3" }),
      ),
    );
    expect(report.inserted).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.total).toBe(3);
  });

  // ── Report counters ──────────────────────────────────────────

  it("counts duplicates (insertEntry returning inserted=false)", async () => {
    mockInsertEntry
      .mockResolvedValueOnce({ entry: { id: 1 }, inserted: true })
      .mockResolvedValueOnce({ entry: { id: 2 }, inserted: false });
    const report = await importKnowledge(
      lines(
        makeManifestLine(),
        makeRowLine({ title: "first" }),
        makeRowLine({ title: "second" }),
      ),
    );
    expect(report.inserted).toBe(1);
    expect(report.skipped_duplicate).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.total).toBe(2);
  });

  it("continues on per-row failure and counts it as failed", async () => {
    mockInsertEntry
      .mockResolvedValueOnce({ entry: { id: 1 }, inserted: true })
      .mockRejectedValueOnce(new Error("insert boom"))
      .mockResolvedValueOnce({ entry: { id: 3 }, inserted: true });
    const report = await importKnowledge(
      lines(
        makeManifestLine(),
        makeRowLine({ title: "ok 1" }),
        makeRowLine({ title: "boom" }),
        makeRowLine({ title: "ok 3" }),
      ),
    );
    expect(report.inserted).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.skipped_duplicate).toBe(0);
    expect(report.total).toBe(3);
  });

  it("rejects rows missing required text fields without calling embed/insert", async () => {
    const report = await importKnowledge(
      lines(
        makeManifestLine(),
        JSON.stringify({ kind: "memo" }), // missing title/summary/content_md
      ),
    );
    expect(report.failed).toBe(1);
    expect(report.inserted).toBe(0);
    expect(mockEmbedDocument).not.toHaveBeenCalled();
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("skips blank lines without counting them", async () => {
    const report = await importKnowledge(
      lines(makeManifestLine(), "", makeRowLine(), "   "),
    );
    expect(report.total).toBe(1);
    expect(report.inserted).toBe(1);
  });

  // ── v2 lifecycle roundtrip ───────────────────────────────────

  it("v2: resolves supersedes_content_hash to predecessor id via findByContentHash", async () => {
    const predHash = "b".repeat(64);
    // Successor row arrives second; findByContentHash will be called twice:
    //   1) successor's content_hash (own-row dedup check) → miss (null)
    //   2) predecessor content_hash (lineage resolution) → hit ({ id: 7 })
    mockFindByContentHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 7 });
    await importKnowledge(
      lines(
        JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
        makeRowLine({
          kind: "risk_rule",
          title: "cap 5%",
          supersedes_content_hash: predHash,
          status_reason: null,
          change_summary: "tightened from 10% to 5%",
          what_failed: "3/24 days hit >7%",
        }),
      ),
    );
    expect(mockInsertEntry).toHaveBeenCalledTimes(1);
    const arg = mockInsertEntry.mock.calls[0]![0];
    expect(arg.supersedesId).toBe(7);
    expect(arg.changeSummary).toBe("tightened from 10% to 5%");
    expect(arg.whatFailed).toBe("3/24 days hit >7%");
  });

  it("v2: unresolved supersedes_content_hash → row fails (does not insert with NULL FK)", async () => {
    // Own-row hash miss (null), predecessor hash also miss (null) → fail.
    mockFindByContentHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const report = await importKnowledge(
      lines(
        JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
        makeRowLine({ supersedes_content_hash: "c".repeat(64) }),
      ),
    );
    expect(report.failed).toBe(1);
    expect(report.inserted).toBe(0);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("v2: non-hex supersedes_content_hash fails validation", async () => {
    const report = await importKnowledge(
      lines(
        JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
        makeRowLine({ supersedes_content_hash: "not-a-hash" }),
      ),
    );
    expect(report.failed).toBe(1);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("v2: preserves status_reason / change_summary / what_failed through insertEntry", async () => {
    await importKnowledge(
      lines(
        JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
        makeRowLine({
          status: "superseded",
          status_reason: "replaced by tighter rule",
        }),
      ),
    );
    const arg = mockInsertEntry.mock.calls[0]![0];
    expect(arg.status).toBe("superseded");
    expect(arg.statusReason).toBe("replaced by tighter rule");
    expect(arg.supersedesId).toBeNull();
  });
});
