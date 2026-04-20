/**
 * PR-9 — Phase 0 forced handoff pass coverage.
 *
 * The pass fires from inside `executeCheckpoint` when contextUsageBand is
 * already `critical` and no active handoff exists for the next generation.
 * It calls `provider.chatCompletion` directly (not `executeTurn`), and
 * MUST NOT touch `usageRepo.logUsage`, `sessionsRepo.updateTokenCount`, or
 * `saveAssistantMessage`.
 *
 * Coverage:
 *   - model calls the tool → handler writes the handoff row, no other
 *     side effects fire,
 *   - model skips the tool → deterministic fallback lands a non-empty
 *     `preferred_recall_query`,
 *   - active handoff already present → no completion / no fallback call,
 *   - cooldown active → no completion / no fallback call,
 *   - band normal / warning → no Phase 0 activity at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockSetRollingSummary = vi.fn();
const mockSetLanguageCode = vi.fn();
const mockArchivePrefix = vi.fn();
const mockForkTool = vi.fn();

const mockLogUsage = vi.fn();
const mockUpdateTokenCount = vi.fn();
const mockAddMessage = vi.fn();
const mockGetLiveMessages = vi.fn();

const mockGetActiveHandoff = vi.fn();
const mockWriteHandoff = vi.fn();
const mockConsumeHandoff = vi.fn();

const mockListRecentEpisodes = vi.fn();
const mockInsertEpisodes = vi.fn();
const mockEmbedDocument = vi.fn();

const mockProviderChatCompletion = vi.fn();

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  getSession: (...a: unknown[]) => mockGetSession(...a),
  setRollingSummary: (...a: unknown[]) => mockSetRollingSummary(...a),
  setMemoryLanguageCode: (...a: unknown[]) => mockSetLanguageCode(...a),
  archivePrefix: (...a: unknown[]) => mockArchivePrefix(...a),
  forkToolMessageToArchive: (...a: unknown[]) => mockForkTool(...a),
  updateTokenCount: (...a: unknown[]) => mockUpdateTokenCount(...a),
  LANG_CODE_RE: /^([a-z]{2,3}(-[A-Z]{2})?|und)$/,
}));

vi.mock("@echo-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  getLiveMessagesWithId: (...a: unknown[]) => mockGetLiveMessages(...a),
}));

vi.mock("@echo-agent/db/repos/usage.js", () => ({
  logUsage: (...a: unknown[]) => mockLogUsage(...a),
}));

vi.mock("@echo-agent/db/repos/checkpoint-handoffs.js", () => ({
  getActive: (...a: unknown[]) => mockGetActiveHandoff(...a),
  writeHandoff: (...a: unknown[]) => mockWriteHandoff(...a),
  consume: (...a: unknown[]) => mockConsumeHandoff(...a),
}));

vi.mock("@echo-agent/db/repos/session-episodes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@echo-agent/db/repos/session-episodes.js")>();
  return {
    ...actual,
    insertEpisodes: (...a: unknown[]) => mockInsertEpisodes(...a),
    listRecentBySession: (...a: unknown[]) => mockListRecentEpisodes(...a),
  };
});

vi.mock("@echo-agent/embeddings/client.js", () => ({
  embedDocument: (...a: unknown[]) => mockEmbedDocument(...a),
}));

// Short-circuit the real prefix / summarise / extract code paths — we only
// care whether Phase 0 fires, not whether Phase I/II writes land.
vi.mock("@echo-agent/engine/checkpoint/prefix.js", () => ({
  selectPrefixWithGiantFallback: vi.fn().mockReturnValue({
    mode: "noop",
    reason: "test_short_circuit",
  }),
  GIANT_TOOL_THRESHOLD: 8000,
}));

vi.mock("@echo-agent/engine/checkpoint/merge.js", () => ({
  summarizePrefix: vi.fn().mockResolvedValue("test summary"),
}));

vi.mock("@echo-agent/engine/checkpoint/extract.js", () => ({
  extractEpisodes: vi.fn().mockResolvedValue({ episodes: [], sessionLanguageInferred: "en" }),
  computeEpisodeHash: vi.fn().mockReturnValue("hash"),
}));

const { executeCheckpoint, __resetCheckpointCooldownForTests, __resetCheckpointMutexForTests } =
  await import("../../../../echo-agent/engine/core/checkpoint.js");

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    scope: "chat",
    startedAt: "2026-04-20T09:00:00.000Z",
    endedAt: null,
    summary: null,
    compacted: false,
    messageCount: 0,
    tokenCount: 0,
    memoryScopeKey: "sess-1",
    memoryLanguageCode: "en",
    checkpointGeneration: 2,
    ...overrides,
  };
}

function makeProvider() {
  return {
    id: "test",
    displayName: "test",
    loadConfig: vi.fn(),
    chatCompletion: (...a: unknown[]) => mockProviderChatCompletion(...a),
    chatCompletionSimple: vi.fn(),
    chatCompletionStream: vi.fn(),
    getBalance: vi.fn(),
    calculateCost: vi.fn(),
  };
}

const config = { provider: "test", model: "m", contextLimit: 1000, maxOutputTokens: 512, inputPricePerM: 0, outputPricePerM: 0, priceCurrency: "USD" as const, cachePricePerM: null, reasoningPricePerM: null };

beforeEach(() => {
  vi.clearAllMocks();
  __resetCheckpointCooldownForTests();
  __resetCheckpointMutexForTests();
  mockGetLiveMessages.mockResolvedValue([
    { id: 1, role: "user", content: "hello world", timestamp: "2026-04-20T11:00:00.000Z" },
    { id: 2, role: "assistant", content: "hi", timestamp: "2026-04-20T11:00:01.000Z" },
  ]);
  mockGetActiveHandoff.mockResolvedValue(null);
  mockWriteHandoff.mockResolvedValue({ id: "h-1", targetCheckpointGeneration: 3, status: "active" });
  mockListRecentEpisodes.mockResolvedValue([]);
});

describe("Phase 0 forced handoff pass", () => {
  it("fires runForcedHandoffPass when band is critical and no active handoff", async () => {
    // tokenCount == 950 against contextLimit 1000 → band === "critical".
    mockGetSession.mockResolvedValue(makeSession({ tokenCount: 950 }));
    mockProviderChatCompletion.mockResolvedValue({
      content: null,
      toolCalls: [{
        id: "tc-1",
        name: "checkpoint_handoff_prepare",
        arguments: {
          preserve_md: "note",
          preferred_recall_query: "post-compact seed",
          important_entities: "[]",
          open_loops: "[]",
        },
      }],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    await executeCheckpoint("sess-1", "sess-1", makeProvider(), config);

    expect(mockProviderChatCompletion).toHaveBeenCalledTimes(1);
    expect(mockWriteHandoff).toHaveBeenCalledTimes(1);
    expect(mockWriteHandoff).toHaveBeenCalledWith(
      "sess-1",
      3, // session.checkpointGeneration + 1
      expect.objectContaining({ preferredRecallQuery: "post-compact seed" }),
    );

    // Side-effect-light invariant — zero calls to any of these.
    expect(mockLogUsage).not.toHaveBeenCalled();
    expect(mockUpdateTokenCount).not.toHaveBeenCalled();
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it("falls back to a deterministic handoff when the model skips the tool call", async () => {
    mockGetSession.mockResolvedValue(makeSession({ tokenCount: 950 }));
    mockProviderChatCompletion.mockResolvedValue({
      content: "I see high pressure but won't call the tool",
      toolCalls: null,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
    mockListRecentEpisodes.mockResolvedValue([
      { id: 1, title: "Mission kickoff", entities: ["wallet-A"], openLoops: { step3: "verify price" } },
      { id: 2, title: "First trade", entities: ["POLY-123"], openLoops: {} },
    ]);

    await executeCheckpoint("sess-1", "sess-1", makeProvider(), config);

    expect(mockProviderChatCompletion).toHaveBeenCalledTimes(1);
    expect(mockWriteHandoff).toHaveBeenCalledTimes(1);
    const [, targetGen, payload] = mockWriteHandoff.mock.calls[0]!;
    expect(targetGen).toBe(3);
    expect(payload.preferredRecallQuery).toMatch(/Mission kickoff|First trade/);
    expect(payload.importantEntities).toEqual(expect.arrayContaining(["wallet-A", "POLY-123"]));
    expect(payload.openLoops.length).toBeGreaterThan(0);
  });

  it("skips Phase 0 entirely when an active handoff already exists", async () => {
    mockGetSession.mockResolvedValue(makeSession({ tokenCount: 950 }));
    mockGetActiveHandoff.mockResolvedValue({ id: "h-0", status: "active", targetCheckpointGeneration: 3 });

    await executeCheckpoint("sess-1", "sess-1", makeProvider(), config);

    expect(mockProviderChatCompletion).not.toHaveBeenCalled();
    expect(mockWriteHandoff).not.toHaveBeenCalled();
  });

  it("skips Phase 0 when the cooldown has not elapsed", async () => {
    mockGetSession.mockResolvedValue(makeSession({ tokenCount: 950 }));
    mockProviderChatCompletion.mockResolvedValue({
      content: null,
      toolCalls: [{
        id: "tc-1",
        name: "checkpoint_handoff_prepare",
        arguments: {
          preserve_md: "note",
          preferred_recall_query: "seed",
          important_entities: "[]",
          open_loops: "[]",
        },
      }],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    await executeCheckpoint("sess-1", "sess-1", makeProvider(), config);
    mockProviderChatCompletion.mockClear();
    mockWriteHandoff.mockClear();
    // Still no active handoff on the second call (simulate consume-race /
    // supersede), cooldown must block the second Phase 0.
    mockGetActiveHandoff.mockResolvedValue(null);

    await executeCheckpoint("sess-1", "sess-1", makeProvider(), config);

    expect(mockProviderChatCompletion).not.toHaveBeenCalled();
    expect(mockWriteHandoff).not.toHaveBeenCalled();
  });

  it("does NOT fire Phase 0 when band is only 'warning'", async () => {
    // tokenCount 820 against 1000 → band === "warning".
    mockGetSession.mockResolvedValue(makeSession({ tokenCount: 820 }));

    await executeCheckpoint("sess-1", "sess-1", makeProvider(), config);

    expect(mockProviderChatCompletion).not.toHaveBeenCalled();
    expect(mockWriteHandoff).not.toHaveBeenCalled();
    expect(mockGetActiveHandoff).not.toHaveBeenCalled();
  });

  it("does NOT fire Phase 0 when band is 'normal'", async () => {
    mockGetSession.mockResolvedValue(makeSession({ tokenCount: 100 }));

    await executeCheckpoint("sess-1", "sess-1", makeProvider(), config);

    expect(mockProviderChatCompletion).not.toHaveBeenCalled();
    expect(mockWriteHandoff).not.toHaveBeenCalled();
  });
});
