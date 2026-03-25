import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInferenceConfig, mockMessage, mockInferenceResponse } from "./_fixtures.js";

const mockResolveProvider = vi.fn();
const mockGetActiveProvider = vi.fn();

vi.mock("../../agent/providers/registry.js", () => ({
  resolveProvider: () => mockResolveProvider(),
  getActiveProvider: () => mockGetActiveProvider(),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { loadInferenceConfig, inferWithTools, inferNonStreaming } = await import(
  "../../agent/inference.js"
);

beforeEach(() => { vi.clearAllMocks(); });

// ── loadInferenceConfig ─────────────────────────────────────────────

describe("loadInferenceConfig", () => {
  it("delegates to provider.loadConfig()", async () => {
    const config = mockInferenceConfig();
    mockResolveProvider.mockResolvedValue({ loadConfig: vi.fn().mockResolvedValue(config) });
    const result = await loadInferenceConfig();
    expect(result).toEqual(config);
  });

  it("returns null when no provider", async () => {
    mockResolveProvider.mockResolvedValue(null);
    const result = await loadInferenceConfig();
    expect(result).toBeNull();
  });
});

// ── inferWithTools ──────────────────────────────────────────────────

describe("inferWithTools", () => {
  it("delegates to provider.chatCompletion when available (SDK path)", async () => {
    const response = mockInferenceResponse();
    const mockProvider = {
      chatCompletion: vi.fn().mockResolvedValue(response),
    };
    mockGetActiveProvider.mockReturnValue(mockProvider);

    const config = mockInferenceConfig();
    const messages = [mockMessage("user", "hello")];
    const tools = [{ type: "function" as const, function: { name: "test", description: "test", parameters: { type: "object" as const, properties: {} } } }];

    const result = await inferWithTools(config, messages, tools);
    expect(result).toEqual(response);
    expect(mockProvider.chatCompletion).toHaveBeenCalledWith(messages, tools, config);
  });

  it("uses raw fetch when provider has no chatCompletion (0G path)", async () => {
    mockGetActiveProvider.mockReturnValue({
      getAuthHeaders: vi.fn().mockResolvedValue({ Authorization: "Bearer test" }),
    });

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "Hello!", tool_calls: null }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    const config = mockInferenceConfig({ endpoint: "http://test.local" });
    const messages = [mockMessage("user", "hello")];

    const result = await inferWithTools(config, messages, []);
    expect(result.content).toBe("Hello!");
    expect(result.toolCalls).toBeNull();
    expect(result.usage.promptTokens).toBe(100);

    vi.restoreAllMocks();
  });

  it("parses native tool_calls from raw fetch response", async () => {
    mockGetActiveProvider.mockReturnValue({
      getAuthHeaders: vi.fn().mockResolvedValue({}),
    });

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "web_search", arguments: '{"query":"test"}' },
            }],
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    const config = mockInferenceConfig({ endpoint: "http://test.local" });
    const result = await inferWithTools(config, [mockMessage("user", "search")], []);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("web_search");
    expect(result.toolCalls![0].arguments).toEqual({ query: "test" });
    expect(result.content).toBeNull();

    vi.restoreAllMocks();
  });

  it("skips malformed tool_call arguments", async () => {
    mockGetActiveProvider.mockReturnValue({
      getAuthHeaders: vi.fn().mockResolvedValue({}),
    });

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{
          message: {
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "bad", arguments: "NOT JSON" } },
              { id: "call_2", type: "function", function: { name: "good", arguments: '{"a":1}' } },
            ],
          },
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    const config = mockInferenceConfig({ endpoint: "http://test.local" });
    const result = await inferWithTools(config, [mockMessage("user", "test")], []);

    // Only the valid tool call should be returned
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("good");

    vi.restoreAllMocks();
  });

  it("falls through to text response when ALL tool_calls are malformed", async () => {
    mockGetActiveProvider.mockReturnValue({
      getAuthHeaders: vi.fn().mockResolvedValue({}),
    });

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{
          message: {
            content: "Fallback text",
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "bad", arguments: "{invalid" } },
            ],
          },
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    const config = mockInferenceConfig({ endpoint: "http://test.local" });
    const result = await inferWithTools(config, [mockMessage("user", "test")], []);

    expect(result.content).toBe("Fallback text");
    expect(result.toolCalls).toBeNull();

    vi.restoreAllMocks();
  });
});

// ── inferNonStreaming ───────────────────────────────────────────────

describe("inferNonStreaming", () => {
  it("delegates to provider.chatCompletionSimple when available", async () => {
    const mockProvider = {
      chatCompletionSimple: vi.fn().mockResolvedValue({
        content: "Summary text",
        usage: { promptTokens: 200, completionTokens: 50 },
      }),
    };
    mockGetActiveProvider.mockReturnValue(mockProvider);

    const config = mockInferenceConfig();
    const result = await inferNonStreaming(config, [mockMessage("user", "summarize")]);

    expect(result.content).toBe("Summary text");
    expect(result.usage.promptTokens).toBe(200);
  });

  it("uses raw fetch when provider has no chatCompletionSimple", async () => {
    mockGetActiveProvider.mockReturnValue({
      getAuthHeaders: vi.fn().mockResolvedValue({}),
    });

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: "Raw response" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 30 },
      }),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse as unknown as Response);

    const config = mockInferenceConfig({ endpoint: "http://test.local" });
    const result = await inferNonStreaming(config, [mockMessage("user", "test")]);

    expect(result.content).toBe("Raw response");
    vi.restoreAllMocks();
  });
});
