import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockAddMessage = vi.fn();
const mockLogUsage = vi.fn();
const mockUpdateTokenCount = vi.fn();

vi.mock("@echo-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: vi.fn(),
  getLiveMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("@echo-agent/db/repos/usage.js", () => ({
  logUsage: (...a: unknown[]) => mockLogUsage(...a),
}));

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  updateTokenCount: (...a: unknown[]) => mockUpdateTokenCount(...a),
  getSession: vi.fn(),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

vi.mock("@echo-agent/db/repos/session-episodes.js", () => ({
  recallTopK: vi.fn().mockResolvedValue([]),
  insertEpisodes: vi.fn(),
  listRecentBySession: vi.fn().mockResolvedValue([]),
}));

vi.mock("@echo-agent/embeddings/client.js", () => ({
  embedDocument: vi.fn(),
  embedQuery: vi.fn().mockResolvedValue({ embedding: [0], providerModel: "test" }),
}));

// Mock the protocols prompt to avoid loading all manifests
vi.mock("@echo-agent/tools/protocols/catalog.js", () => ({
  PROTOCOL_TOOLS: [],
  PROTOCOL_NAMESPACE_ALLOWLIST: [],
}));

const { executeTurn } = await import("../../../../echo-agent/engine/core/turn.js");

describe("turn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeContext() {
    return {
      sessionId: "session-1",
      sessionKind: "chat" as const,
      loopMode: "off" as const,
      missionId: null,
      missionRunId: null,
      isSubagent: false,
      loadedDocuments: new Map<string, string>(),
      memoryScopeKey: "session-1",
    };
  }

  function makeProvider(response: {
    content?: string | null;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
  }) {
    return {
      chatCompletion: vi.fn().mockResolvedValue({
        content: response.content ?? null,
        toolCalls: response.toolCalls ?? null,
        usage: { promptTokens: 1000, completionTokens: 200, cachedTokens: 0, reasoningTokens: 0 },
      }),
      // chatCompletionSimple stays on the contract (used by checkpoint extract/merge)
      // but the recall path no longer calls it — see "recall path" tests below.
      chatCompletionSimple: vi.fn(),
      calculateCost: vi.fn().mockReturnValue({ totalCost: 0.001, currency: "USD" }),
    };
  }

  function makeConfig() {
    return {
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
      contextLimit: 128000,
      maxOutputTokens: 4096,
      inputPricePerM: 3,
      outputPricePerM: 15,
    };
  }

  it("returns text response", async () => {
    const provider = makeProvider({ content: "Your balance is 2.5 SOL" });
    const result = await executeTurn(
      makeContext(), [], null, provider as any, makeConfig() as any, [],
    );

    expect(result.content).toBe("Your balance is 2.5 SOL");
    expect(result.toolCalls).toBeNull();
    expect(result.promptTokens).toBe(1000);
  });

  it("returns tool calls", async () => {
    const provider = makeProvider({
      toolCalls: [{ id: "call-1", name: "discover_tools", arguments: { query: "balance" } }],
    });
    const result = await executeTurn(
      makeContext(), [], null, provider as any, makeConfig() as any, [],
    );

    expect(result.content).toBeNull();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("discover_tools");
  });

  it("does NOT save assistant message to DB (deferred to turn-loop)", async () => {
    const provider = makeProvider({ content: "Hello" });
    await executeTurn(makeContext(), [], null, provider as any, makeConfig() as any, []);

    // executeTurn no longer saves — turn-loop handles deferred save after
    // determining the canonical batch prefix (trimming unexecuted tool calls).
    expect(mockAddMessage).not.toHaveBeenCalled();
  });

  it("logs usage after inference", async () => {
    const provider = makeProvider({ content: "Hi" });
    await executeTurn(makeContext(), [], null, provider as any, makeConfig() as any, []);

    expect(mockLogUsage).toHaveBeenCalledWith("session-1", expect.objectContaining({
      promptTokens: 1000,
      completionTokens: 200,
    }));
  });

  it("updates token count after inference", async () => {
    const provider = makeProvider({ content: "Hi" });
    await executeTurn(makeContext(), [], null, provider as any, makeConfig() as any, []);

    expect(mockUpdateTokenCount).toHaveBeenCalledWith("session-1", 1000);
  });

  it("includes summary in provider messages when available", async () => {
    const provider = makeProvider({ content: "Continuing..." });
    await executeTurn(
      makeContext(), [], "Previous session summary", provider as any, makeConfig() as any, [],
    );

    const [providerMessages] = provider.chatCompletion.mock.calls[0];
    const summaryMsg = providerMessages.find((m: any) => m.content.includes("Previous session summary"));
    expect(summaryMsg).toBeTruthy();
  });

  it("passes existing messages to provider", async () => {
    const provider = makeProvider({ content: "OK" });
    const messages = [
      { role: "user" as const, content: "Check balance", timestamp: "2026-03-29T10:00:00Z" },
    ];
    await executeTurn(
      makeContext(), messages, null, provider as any, makeConfig() as any, [],
    );

    const [providerMessages] = provider.chatCompletion.mock.calls[0];
    const userMsg = providerMessages.find((m: any) => m.content === "Check balance");
    expect(userMsg).toBeTruthy();
    expect(userMsg.role).toBe("user");
  });

  it("injects session episode recall as its own system block AFTER the summary and BEFORE history", async () => {
    const episodesMod = await import("@echo-agent/db/repos/session-episodes.js");
    (episodesMod.recallTopK as any).mockResolvedValue([
      {
        similarity: 0.9,
        episode: {
          id: 5,
          sessionId: "prev-session",
          memoryScopeKey: "session-1",
          episodeKind: "decision",
          summaryEn: "Earlier decision to hold SOL",
          facts: {},
          decisions: {},
          openLoops: {},
          entities: [],
          toolOutcomes: {},
          sourceSurface: "echo_agent",
          sourceSession: "prev-session",
          sourceStartMessageId: 1,
          sourceEndMessageId: 2,
          episodeHash: "h".repeat(64),
          embeddingModel: "test",
          embeddingDim: 1,
          createdAt: "2026-04-01T00:00:00Z",
        },
      },
    ]);

    const provider = makeProvider({ content: "OK" });
    const messages = [
      { role: "user" as const, content: "What did I decide?", timestamp: "2026-04-01T10:00:00Z" },
    ];
    await executeTurn(
      makeContext(), messages, "Previous session summary", provider as any, makeConfig() as any, [],
    );

    const [providerMessages] = provider.chatCompletion.mock.calls[0];
    const systemBlocks = providerMessages.filter((m: any) => m.role === "system");
    // At minimum: main system prompt, summary, recall.
    expect(systemBlocks.length).toBeGreaterThanOrEqual(3);
    const summaryIdx = providerMessages.findIndex((m: any) =>
      typeof m.content === "string" && m.content.includes("Previous conversation summary"),
    );
    const recallIdx = providerMessages.findIndex((m: any) =>
      typeof m.content === "string" && m.content.includes("[Session episode recall]"),
    );
    const firstUserIdx = providerMessages.findIndex((m: any) => m.role === "user");
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(recallIdx).toBeGreaterThan(summaryIdx);
    expect(firstUserIdx).toBeGreaterThan(recallIdx);
  });

  // ── Recall path: post-PR1 (no translation) ─────────────────────────

  it("embeds the last user input verbatim for recall — no translation remote call", async () => {
    const embeddingsMod = await import("@echo-agent/embeddings/client.js");
    const episodesMod = await import("@echo-agent/db/repos/session-episodes.js");
    (embeddingsMod.embedQuery as any).mockClear();
    (episodesMod.recallTopK as any).mockResolvedValue([]);

    const provider = makeProvider({ content: "OK" });
    const messages = [
      // Polish input — would have triggered translation pre-PR1. Now it must
      // go to embedQuery directly because EmbeddingGemma handles multilingual
      // recall natively (see docs/benchmarks/cross-lingual-recall.md).
      { role: "user" as const, content: "Sprawdź mój balance SOL", timestamp: "2026-04-01T10:00:00Z" },
    ];
    await executeTurn(
      makeContext(), messages, null, provider as any, makeConfig() as any, [],
    );

    // No translation round-trip for the recall path — chatCompletionSimple
    // stays on the provider contract (checkpoint extract/merge use it) but
    // the recall path doesn't touch it.
    expect(provider.chatCompletionSimple).not.toHaveBeenCalled();
    // embedQuery sees the raw user text verbatim.
    expect(embeddingsMod.embedQuery).toHaveBeenCalledWith("Sprawdź mój balance SOL");
  });

  it("embeds English queries verbatim too (no heuristic, just raw)", async () => {
    const embeddingsMod = await import("@echo-agent/embeddings/client.js");
    const episodesMod = await import("@echo-agent/db/repos/session-episodes.js");
    (embeddingsMod.embedQuery as any).mockClear();
    (episodesMod.recallTopK as any).mockResolvedValue([]);

    const provider = makeProvider({ content: "OK" });
    const messages = [
      { role: "user" as const, content: "what is the yield on solana", timestamp: "2026-04-01T10:00:00Z" },
    ];
    await executeTurn(
      makeContext(), messages, null, provider as any, makeConfig() as any, [],
    );

    expect(provider.chatCompletionSimple).not.toHaveBeenCalled();
    expect(embeddingsMod.embedQuery).toHaveBeenCalledWith("what is the yield on solana");
  });

  it("swallows embedQuery failures and omits the recall block (turn continues)", async () => {
    const embeddingsMod = await import("@echo-agent/embeddings/client.js");
    (embeddingsMod.embedQuery as any).mockRejectedValueOnce(new Error("embed provider down"));

    const provider = makeProvider({ content: "Hello" });
    const messages = [
      { role: "user" as const, content: "hello", timestamp: "2026-04-01T10:00:00Z" },
    ];

    // The turn must still complete cleanly even if recall embed throws —
    // fetchSessionEpisodeRecallBlock has its own try/catch that degrades to
    // an empty block.
    const result = await executeTurn(
      makeContext(), messages, null, provider as any, makeConfig() as any, [],
    );

    expect(result.content).toBe("Hello");
    expect(provider.chatCompletion).toHaveBeenCalled();
  });
});
