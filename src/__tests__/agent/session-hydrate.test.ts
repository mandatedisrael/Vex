import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockMessage } from "./_fixtures.js";

const mockCreateSession = vi.fn();
const mockGetSession = vi.fn();
const mockGetLiveMessages = vi.fn();
const mockGetFile = vi.fn();

vi.mock("../../agent/engine.js", () => ({
  createSession: () => mockCreateSession(),
}));
vi.mock("../../agent/db/repos/sessions.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));
vi.mock("../../agent/db/repos/messages.js", () => ({
  getLiveSessionMessages: (...args: unknown[]) => mockGetLiveMessages(...args),
}));
vi.mock("../../agent/db/repos/knowledge.js", () => ({
  getFile: (...args: unknown[]) => mockGetFile(...args),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { hydrateSession } = await import("../../agent/session-hydrate.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateSession.mockReturnValue({
    id: "temp-id",
    messages: [],
    loadedKnowledge: new Map(),
    inferenceConfig: { provider: "test", model: "test", endpoint: "http://test", contextLimit: 65000, inputPricePerM: 1, outputPricePerM: 1, priceCurrency: "USD" },
  });
});

describe("hydrateSession", () => {
  it("returns null when no sessionId", async () => {
    expect(await hydrateSession(undefined)).toBeNull();
    expect(await hydrateSession()).toBeNull();
  });

  it("returns null when engine not initialized (createSession returns null)", async () => {
    mockCreateSession.mockReturnValue(null);
    expect(await hydrateSession("sess-1")).toBeNull();
  });

  it("returns null when session not found in DB", async () => {
    mockGetSession.mockResolvedValue(null);
    expect(await hydrateSession("sess-not-found")).toBeNull();
  });

  it("returns null for compacted session", async () => {
    mockGetSession.mockResolvedValue({ compacted: true, token_count: 0 });
    expect(await hydrateSession("sess-compacted")).toBeNull();
  });

  it("returns hydrated session with messages", async () => {
    const messages = [
      mockMessage("user", "hello"),
      mockMessage("assistant", "hi"),
    ];
    mockGetSession.mockResolvedValue({ compacted: false, token_count: 500 });
    mockGetLiveMessages.mockResolvedValue(messages);

    const session = await hydrateSession("sess-valid");
    expect(session).not.toBeNull();
    expect(session!.id).toBe("sess-valid");
    expect(session!.messages).toEqual(messages);
    expect(session!.lastPromptTokens).toBe(500);
    expect(session!.messageCountAtSnapshot).toBe(2);
  });

  it("rebuilds loadedKnowledge from file_read tool calls", async () => {
    const messages = [
      mockMessage("assistant", "reading file", {
        toolCalls: [{ id: "tc1", command: "file_read", args: { path: "skills/trading.md" } }],
      }),
    ];
    mockGetSession.mockResolvedValue({ compacted: false, token_count: 0 });
    mockGetLiveMessages.mockResolvedValue(messages);
    mockGetFile.mockResolvedValue("# Trading Skills");

    const session = await hydrateSession("sess-knowledge");
    expect(session!.loadedKnowledge.has("skills/trading.md")).toBe(true);
    expect(session!.loadedKnowledge.get("skills/trading.md")).toBe("# Trading Skills");
  });

  it("does not seed snapshot when token_count is 0", async () => {
    mockGetSession.mockResolvedValue({ compacted: false, token_count: 0 });
    mockGetLiveMessages.mockResolvedValue([]);

    const session = await hydrateSession("sess-new");
    expect(session!.lastPromptTokens).toBeUndefined();
  });

  it("skips already-loaded knowledge paths", async () => {
    const messages = [
      mockMessage("assistant", "read 1", {
        toolCalls: [{ id: "tc1", command: "file_read", args: { path: "a.md" } }],
      }),
      mockMessage("assistant", "read 2", {
        toolCalls: [{ id: "tc2", command: "file_read", args: { path: "a.md" } }],
      }),
    ];
    mockGetSession.mockResolvedValue({ compacted: false, token_count: 0 });
    mockGetLiveMessages.mockResolvedValue(messages);
    mockGetFile.mockResolvedValue("content");

    await hydrateSession("sess-dedup");
    expect(mockGetFile).toHaveBeenCalledTimes(1); // Only loaded once
  });
});
