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
});
