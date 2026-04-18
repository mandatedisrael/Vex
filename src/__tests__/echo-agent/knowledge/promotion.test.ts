/**
 * Unit tests for the PR4 Fase IV promotion pipeline.
 *
 * Focus:
 *   - kind + similarity gates (only whitelisted kinds, ≥ min similar in scope)
 *   - language gate driven by `sessions.memory_language_code` (NOT a text heuristic)
 *   - translation failure → skip with reason, not crash
 *   - idempotency outcomes (already_promoted via source_episode_id / hash / content_hash)
 *   - maintenance lease lost → skip candidate, run continues
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockGetMemoryLanguageCode = vi.fn();

const mockListPromotable = vi.fn();
const mockCountSimilar = vi.fn();

const mockGetParentSession = vi.fn();

const mockInsertEntry = vi.fn();

const mockEmbedDocument = vi.fn();
const mockLoadEmbeddingConfig = vi.fn();

class MaintenanceActiveErrorMock extends Error {
  readonly code = "MAINTENANCE_ACTIVE" as const;
  readonly ownerId: string;
  constructor(ownerId: string) {
    super(`maintenance active: ${ownerId}`);
    this.name = "MaintenanceActiveError";
    this.ownerId = ownerId;
  }
}

vi.mock("@echo-agent/db/client.js", () => ({
  getPool: () => ({}),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  getSession: (...a: unknown[]) => mockGetSession(...a),
  getMemoryLanguageCode: (...a: unknown[]) => mockGetMemoryLanguageCode(...a),
}));

vi.mock("@echo-agent/db/repos/session-episodes.js", async () => {
  const actual = await vi.importActual<
    typeof import("@echo-agent/db/repos/session-episodes.js")
  >("@echo-agent/db/repos/session-episodes.js");
  return {
    ...actual,
    listPromotable: (...a: unknown[]) => mockListPromotable(...a),
    countSimilar: (...a: unknown[]) => mockCountSimilar(...a),
  };
});

vi.mock("@echo-agent/db/repos/session-links.js", () => ({
  getParentSession: (...a: unknown[]) => mockGetParentSession(...a),
}));

vi.mock("@echo-agent/db/repos/knowledge.js", () => ({
  insertEntry: (...a: unknown[]) => mockInsertEntry(...a),
}));

vi.mock("@echo-agent/db/repos/maintenance-lease.js", () => ({
  MaintenanceActiveError: MaintenanceActiveErrorMock,
  withLeaseSharedLock: async <T>(
    _pool: unknown,
    fn: (tx: unknown) => Promise<T>,
  ): Promise<T> => fn({ query: vi.fn() }),
  acquireReembedLease: vi.fn(),
  releaseReembedLease: vi.fn(),
  inspectLease: vi.fn(),
}));

vi.mock("@echo-agent/embeddings/client.js", () => ({
  embedDocument: (...a: unknown[]) => mockEmbedDocument(...a),
}));

vi.mock("@echo-agent/embeddings/config.js", () => ({
  loadEmbeddingConfig: () => mockLoadEmbeddingConfig(),
  MIN_EMBEDDING_DIM: 1,
  MAX_EMBEDDING_DIM: 8192,
}));

const { runPromotionForSession } = await import("@echo-agent/knowledge/promotion.js");

// ── Helpers ──────────────────────────────────────────────────────────

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    sessionId: "session-1",
    memoryScopeKey: "session-1",
    episodeKind: "decision",
    title: "Hold SOL",
    summaryText: "Użytkownik zdecydował się trzymać long SOL mimo drawdownu.",
    facts: {},
    decisions: {},
    openLoops: {},
    entities: [],
    toolOutcomes: {},
    sourceSurface: "echo_agent",
    sourceSession: "session-1",
    sourceStartMessageId: 1,
    sourceEndMessageId: 8,
    episodeHash: "h".repeat(64),
    embeddingModel: "ai/embeddinggemma:300M-Q8_0",
    embeddingDim: 4,
    createdAt: "2026-04-18T12:00:00Z",
    embedding: [0.1, 0.2, 0.3, 0.4],
    ...overrides,
  };
}

function makeInsertedEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    kind: "decision",
    title: "User held SOL long through drawdown",
    summary: "User held the SOL long despite the drawdown.",
    contentMd: "User held the SOL long despite the drawdown.",
    tags: [],
    sourceRefs: {},
    confidence: null,
    status: "active",
    pinned: false,
    validFrom: "2026-04-18T12:00:00Z",
    validUntil: null,
    contentHash: "c".repeat(64),
    embeddingModel: "ai/embeddinggemma:300M-Q8_0",
    embeddingDim: 4,
    sourceSurface: "echo_agent",
    sourceSession: "session-1",
    supersedesId: null,
    statusReason: null,
    changeSummary: null,
    whatFailed: null,
    createdAt: "2026-04-18T12:00:00Z",
    updatedAt: "2026-04-18T12:00:00Z",
    ...overrides,
  };
}

function makeProvider(translation: { title: string; summary: string } | Error): {
  chatCompletionSimple: ReturnType<typeof vi.fn>;
} {
  return {
    chatCompletionSimple: vi.fn().mockImplementation(async () => {
      if (translation instanceof Error) throw translation;
      return { content: JSON.stringify(translation), usage: {} };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadEmbeddingConfig.mockReturnValue({
    baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
    model: "ai/embeddinggemma:300M-Q8_0",
    dim: 4,
    provider: "local",
  });
  mockEmbedDocument.mockResolvedValue({
    embedding: [0.5, 0.5, 0.5, 0.5],
    providerModel: "ai/embeddinggemma:300M-Q8_0",
  });
  mockGetSession.mockResolvedValue({ id: "session-1", memoryScopeKey: "session-1" });
  mockGetParentSession.mockResolvedValue(null);
});

describe("runPromotionForSession", () => {
  it("reports zero candidates without running any downstream call", async () => {
    mockListPromotable.mockResolvedValueOnce([]);
    const report = await runPromotionForSession(
      "session-1",
      {} as never,
      {} as never,
    );
    expect(report.considered).toBe(0);
    expect(report.inserted).toBe(0);
    expect(mockCountSimilar).not.toHaveBeenCalled();
    expect(mockGetMemoryLanguageCode).not.toHaveBeenCalled();
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("skips candidates below the cluster threshold (not_enough_similar)", async () => {
    mockListPromotable.mockResolvedValueOnce([makeCandidate()]);
    mockCountSimilar.mockResolvedValueOnce(1); // threshold is 2
    const report = await runPromotionForSession(
      "session-1",
      {} as never,
      {} as never,
    );
    expect(report.considered).toBe(1);
    expect(report.skipped.not_enough_similar).toBe(1);
    expect(mockGetMemoryLanguageCode).not.toHaveBeenCalled();
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("skips candidates when memory_language_code is null (language_unknown)", async () => {
    mockListPromotable.mockResolvedValueOnce([makeCandidate()]);
    mockCountSimilar.mockResolvedValueOnce(3);
    mockGetMemoryLanguageCode.mockResolvedValueOnce(null);
    const report = await runPromotionForSession(
      "session-1",
      {} as never,
      {} as never,
    );
    expect(report.skipped.language_unknown).toBe(1);
    expect(mockInsertEntry).not.toHaveBeenCalled();
    expect(mockEmbedDocument).not.toHaveBeenCalled();
  });

  it("skips candidates when memory_language_code is und (language_unknown)", async () => {
    mockListPromotable.mockResolvedValueOnce([makeCandidate()]);
    mockCountSimilar.mockResolvedValueOnce(3);
    mockGetMemoryLanguageCode.mockResolvedValueOnce("und");
    const report = await runPromotionForSession(
      "session-1",
      {} as never,
      {} as never,
    );
    expect(report.skipped.language_unknown).toBe(1);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("en language: inserts without calling the translation path", async () => {
    mockListPromotable.mockResolvedValueOnce([
      makeCandidate({
        title: "User held SOL long through drawdown",
        summaryText: "User held the SOL long despite a 12% drawdown.",
      }),
    ]);
    mockCountSimilar.mockResolvedValueOnce(3);
    mockGetMemoryLanguageCode.mockResolvedValueOnce("en");
    mockInsertEntry.mockResolvedValueOnce({
      entry: makeInsertedEntry(),
      inserted: true,
    });

    const provider = makeProvider({ title: "", summary: "" });
    const report = await runPromotionForSession(
      "session-1",
      provider as never,
      {} as never,
    );
    expect(report.inserted).toBe(1);
    expect(provider.chatCompletionSimple).not.toHaveBeenCalled();
    // Embedding STILL runs for the promoted (English) payload.
    expect(mockEmbedDocument).toHaveBeenCalledTimes(1);
  });

  it("non-EN language: calls the translation path and inserts the English payload", async () => {
    mockListPromotable.mockResolvedValueOnce([makeCandidate()]);
    mockCountSimilar.mockResolvedValueOnce(3);
    mockGetMemoryLanguageCode.mockResolvedValueOnce("pl");
    const englishTitle = "Decision to hold SOL long through drawdown";
    const englishSummary = "User decided to hold the SOL long despite the drawdown.";
    const provider = makeProvider({ title: englishTitle, summary: englishSummary });
    mockInsertEntry.mockResolvedValueOnce({
      entry: makeInsertedEntry({ title: englishTitle, summary: englishSummary }),
      inserted: true,
    });

    const report = await runPromotionForSession(
      "session-1",
      provider as never,
      {} as never,
    );

    expect(provider.chatCompletionSimple).toHaveBeenCalledTimes(1);
    const [messages] = provider.chatCompletionSimple.mock.calls[0]!;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toMatch(/Translate the input from Polish to English/i);
    expect(report.inserted).toBe(1);
    expect(mockInsertEntry).toHaveBeenCalledTimes(1);
    const [insertArgs] = mockInsertEntry.mock.calls[0]!;
    expect(insertArgs.title).toBe(englishTitle);
    expect(insertArgs.summary).toBe(englishSummary);
    expect(insertArgs.sourceEpisodeId).toBe(42);
    expect(insertArgs.sourceEpisodeHash).toMatch(/^h{64}$/);
    expect(insertArgs.promotionVersion).toBe(1);
  });

  it("non-EN language + translation failure → skip (translation_failed), NO insert", async () => {
    mockListPromotable.mockResolvedValueOnce([makeCandidate()]);
    mockCountSimilar.mockResolvedValueOnce(3);
    mockGetMemoryLanguageCode.mockResolvedValueOnce("pl");
    const provider = makeProvider(new Error("translate boom"));
    const report = await runPromotionForSession(
      "session-1",
      provider as never,
      {} as never,
    );
    expect(report.skipped.translation_failed).toBe(1);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("non-EN language + malformed JSON → skip (translation_failed)", async () => {
    mockListPromotable.mockResolvedValueOnce([makeCandidate()]);
    mockCountSimilar.mockResolvedValueOnce(3);
    mockGetMemoryLanguageCode.mockResolvedValueOnce("pl");
    const provider = {
      chatCompletionSimple: vi.fn().mockResolvedValue({ content: "not json", usage: {} }),
    };
    const report = await runPromotionForSession(
      "session-1",
      provider as never,
      {} as never,
    );
    expect(report.skipped.translation_failed).toBe(1);
    expect(mockInsertEntry).not.toHaveBeenCalled();
  });

  it("attaches parent_session_id to source_refs for subagent-sourced episodes", async () => {
    mockListPromotable.mockResolvedValueOnce([
      makeCandidate({
        sessionId: "child-1",
        sourceSession: "child-1",
        memoryScopeKey: "child-1",
      }),
    ]);
    mockCountSimilar.mockResolvedValueOnce(3);
    mockGetMemoryLanguageCode.mockResolvedValueOnce("en");
    mockGetParentSession.mockResolvedValueOnce({
      parentSessionId: "parent-1",
      childSessionId: "child-1",
      relationType: "subagent",
    });
    mockInsertEntry.mockResolvedValueOnce({
      entry: makeInsertedEntry(),
      inserted: true,
    });
    await runPromotionForSession("child-1", {} as never, {} as never);
    const [insertArgs] = mockInsertEntry.mock.calls[0]!;
    expect(insertArgs.sourceRefs).toMatchObject({
      source_episode_id: 42,
      source_session: "child-1",
      parent_session_id: "parent-1",
    });
  });

  it("already_promoted (content_hash collision from insertEntry CTE)", async () => {
    mockListPromotable.mockResolvedValueOnce([makeCandidate()]);
    mockCountSimilar.mockResolvedValueOnce(3);
    mockGetMemoryLanguageCode.mockResolvedValueOnce("en");
    mockInsertEntry.mockResolvedValueOnce({
      entry: makeInsertedEntry(),
      inserted: false, // CTE returned the existing row
    });
    const report = await runPromotionForSession("session-1", {} as never, {} as never);
    expect(report.alreadyPromoted).toBe(1);
    expect(report.inserted).toBe(0);
  });

  it("maintenance lease active → skip with embedding_unavailable, pipeline continues", async () => {
    mockListPromotable.mockResolvedValueOnce([makeCandidate(), makeCandidate({ id: 99 })]);
    mockCountSimilar.mockResolvedValue(3);
    mockGetMemoryLanguageCode.mockResolvedValue("en");
    mockInsertEntry.mockRejectedValueOnce(new MaintenanceActiveErrorMock("reembed:pid-42"));
    mockInsertEntry.mockResolvedValueOnce({
      entry: makeInsertedEntry(),
      inserted: true,
    });
    const report = await runPromotionForSession("session-1", {} as never, {} as never);
    // First candidate hits the lease error; pipeline continues to second.
    expect(report.skipped.embedding_unavailable).toBe(1);
    expect(report.inserted).toBe(1);
  });
});
