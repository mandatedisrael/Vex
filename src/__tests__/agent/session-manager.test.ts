import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateSession = vi.fn();
const mockHydrateSession = vi.fn();
const mockLoadInferenceConfig = vi.fn();
const mockInferNonStreaming = vi.fn();
const mockGetSession = vi.fn();
const mockCreateSessionRepo = vi.fn();
const mockSetScope = vi.fn();
const mockCompactSession = vi.fn();
const mockAddMessage = vi.fn();
const mockAppendMemory = vi.fn();
const mockQuery = vi.fn();

vi.mock("../../agent/engine.js", () => ({
  createSession: () => mockCreateSession(),
}));
vi.mock("../../agent/session-hydrate.js", () => ({
  hydrateSession: (...args: unknown[]) => mockHydrateSession(...args),
}));
vi.mock("../../agent/inference.js", () => ({
  inferNonStreaming: (...args: unknown[]) => mockInferNonStreaming(...args),
  loadInferenceConfig: () => mockLoadInferenceConfig(),
}));
vi.mock("../../agent/db/repos/sessions.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  createSession: (...args: unknown[]) => mockCreateSessionRepo(...args),
  setScope: (...args: unknown[]) => mockSetScope(...args),
  compactSession: (...args: unknown[]) => mockCompactSession(...args),
}));
vi.mock("../../agent/db/repos/messages.js", () => ({
  getLiveSessionMessages: vi.fn().mockResolvedValue([]),
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
}));
vi.mock("../../agent/db/repos/memory.js", () => ({
  appendMemory: (...args: unknown[]) => mockAppendMemory(...args),
}));
vi.mock("../../agent/db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));
vi.mock("../../agent/prompts/compaction.js", () => ({
  getCompactionSystemPrompt: () => "You are a summarizer.",
  buildCompactionPrompt: () => "Summarize this.",
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createNewSession, buildOvernightDigest } = await import(
  "../../agent/session-manager.js"
);

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateSession.mockReturnValue({
    id: "new-session-1",
    messages: [],
    loadedKnowledge: new Map(),
    inferenceConfig: { provider: "test", model: "test", endpoint: "http://test", contextLimit: 65000, inputPricePerM: 1, outputPricePerM: 1, priceCurrency: "USD" },
  });
  mockCreateSessionRepo.mockResolvedValue(undefined);
  mockSetScope.mockResolvedValue(undefined);
  mockAddMessage.mockResolvedValue(undefined);
});

describe("createNewSession", () => {
  it("creates new session without previous (no summary)", async () => {
    const result = await createNewSession(null);
    expect(result).not.toBeNull();
    expect(result!.session.id).toBe("new-session-1");
    expect(result!.previousSummary).toBeNull();
    expect(mockCreateSessionRepo).toHaveBeenCalled();
  });

  it("summarizes previous session and injects summary", async () => {
    mockGetSession.mockResolvedValue({ compacted: false, message_count: 5 });
    mockHydrateSession.mockResolvedValue({
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
      loadedKnowledge: new Map(),
    });
    mockLoadInferenceConfig.mockResolvedValue({ model: "test" });
    mockInferNonStreaming.mockResolvedValue({
      content: "## Session Summary\nUser said hi.\n\n## Key Insights\nUser is friendly.",
    });
    mockCompactSession.mockResolvedValue(undefined);
    mockAppendMemory.mockResolvedValue(undefined);

    const result = await createNewSession("prev-session-1");
    expect(result!.previousSummary).toContain("User said hi.");
    expect(result!.session.messages).toHaveLength(1);
    expect(result!.session.messages[0].role).toBe("system");
  });

  it("creates session even when summarization fails", async () => {
    mockGetSession.mockRejectedValue(new Error("DB error"));

    const result = await createNewSession("prev-broken");
    expect(result).not.toBeNull();
    expect(result!.previousSummary).toBeNull();
  });

  it("returns null when engine not ready", async () => {
    mockCreateSession.mockReturnValue(null);
    const result = await createNewSession(null);
    expect(result).toBeNull();
  });

  it("sets scope correctly", async () => {
    await createNewSession(null, "telegram");
    expect(mockSetScope).toHaveBeenCalledWith("new-session-1", "telegram");
  });
});

describe("buildOvernightDigest", () => {
  it("builds formatted report from DB data", async () => {
    mockGetSession.mockResolvedValue({
      started_at: new Date(Date.now() - 7200_000).toISOString(),
    });
    mockQuery
      .mockResolvedValueOnce([{ count: 5, pnl: 25.5 }])   // trades
      .mockResolvedValueOnce([{ count: 10 }])               // cycles
      .mockResolvedValueOnce([{ count: 2 }])                 // subagents
      .mockResolvedValueOnce([{ total: 1.5 }]);              // usage

    const digest = await buildOvernightDigest("sess-1");
    expect(digest).toContain("Session Report");
    expect(digest).toContain("Trades: 5");
    expect(digest).toContain("+$25.50");
    expect(digest).toContain("Subagents spawned: 2");
  });

  it("returns null when session not found", async () => {
    mockGetSession.mockResolvedValue(null);
    const digest = await buildOvernightDigest("sess-not-found");
    expect(digest).toBeNull();
  });

  it("returns null on DB error", async () => {
    mockGetSession.mockRejectedValue(new Error("DB down"));
    const digest = await buildOvernightDigest("sess-error");
    expect(digest).toBeNull();
  });
});
