import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInferenceResponse } from "./_fixtures.js";

const mockCreateSession = vi.fn();
const mockInferWithTools = vi.fn();
const mockCreateSessionRepo = vi.fn();
const mockSetScope = vi.fn();
const mockAddMessage = vi.fn();
const mockLogUsage = vi.fn();
const mockListEntriesWithIds = vi.fn();
const mockAppendMemory = vi.fn();
const mockReplaceEntry = vi.fn();
const mockDeleteEntry = vi.fn();
const mockFileCount = vi.fn();
const mockGetFile = vi.fn();
const mockGetFileWithMeta = vi.fn();
const mockUpsertFile = vi.fn();
const mockListFiles = vi.fn();
const mockDeleteFile = vi.fn();

vi.mock("../../agent/engine.js", () => ({
  createSession: () => mockCreateSession(),
}));
vi.mock("../../agent/inference.js", () => ({
  inferWithTools: (...args: unknown[]) => mockInferWithTools(...args),
}));
vi.mock("../../agent/db/repos/sessions.js", () => ({
  createSession: (...args: unknown[]) => mockCreateSessionRepo(...args),
  setScope: (...args: unknown[]) => mockSetScope(...args),
}));
vi.mock("../../agent/db/repos/messages.js", () => ({
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
}));
vi.mock("../../agent/db/repos/usage.js", () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
}));
vi.mock("../../agent/db/repos/memory.js", () => ({
  listEntriesWithIds: () => mockListEntriesWithIds(),
  appendMemory: (...args: unknown[]) => mockAppendMemory(...args),
  replaceEntry: (...args: unknown[]) => mockReplaceEntry(...args),
  deleteEntry: (...args: unknown[]) => mockDeleteEntry(...args),
}));
vi.mock("../../agent/db/repos/knowledge.js", () => ({
  fileCount: () => mockFileCount(),
  getFile: (...args: unknown[]) => mockGetFile(...args),
  getFileWithMeta: (...args: unknown[]) => mockGetFileWithMeta(...args),
  upsertFile: (...args: unknown[]) => mockUpsertFile(...args),
  listFiles: (...args: unknown[]) => mockListFiles(...args),
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
}));
vi.mock("../../agent/prompts/echo-papa.js", () => ({
  buildPapaSystemPrompt: () => "Papa system prompt",
  buildPapaCyclePrompt: () => "Run your cycle",
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { runEchoPapaCycle } = await import("../../agent/echo-papa.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateSession.mockReturnValue({
    id: "papa-session-1", messages: [], loadedKnowledge: new Map(),
    inferenceConfig: { provider: "test", model: "test", endpoint: "http://test", contextLimit: 40000, inputPricePerM: 1, outputPricePerM: 1, priceCurrency: "USD" },
  });
  mockCreateSessionRepo.mockResolvedValue(undefined);
  mockSetScope.mockResolvedValue(undefined);
  mockAddMessage.mockResolvedValue(undefined);
  mockLogUsage.mockResolvedValue(undefined);
  mockListEntriesWithIds.mockResolvedValue([{ id: 1, content: "test" }]);
  mockFileCount.mockResolvedValue(5);
  mockListFiles.mockResolvedValue([]);
  mockUpsertFile.mockResolvedValue(undefined);
  mockGetFileWithMeta.mockResolvedValue(null);
});

describe("runEchoPapaCycle", () => {
  it("returns agent not ready when session cannot be created", async () => {
    mockCreateSession.mockReturnValue(null);
    const result = await runEchoPapaCycle();
    expect(result.success).toBe(false);
    expect(result.result).toContain("not ready");
  });

  it("completes with text-only response (no tool calls)", async () => {
    mockInferWithTools.mockResolvedValue(
      mockInferenceResponse({ content: "Everything looks clean.", toolCalls: null }),
    );

    const result = await runEchoPapaCycle();
    expect(result.success).toBe(true);
    expect(result.result).toContain("clean");
    expect(result.toolCalls).toBe(0);
  });

  it("executes tool calls and continues loop", async () => {
    mockInferWithTools
      .mockResolvedValueOnce(mockInferenceResponse({
        content: null,
        toolCalls: [{ id: "tc1", name: "file_list", arguments: { path: "" } }],
      }))
      .mockResolvedValueOnce(mockInferenceResponse({
        content: "Maintenance complete.", toolCalls: null,
      }));

    mockListFiles.mockResolvedValue([{ name: "test.md", type: "file" }]);

    const result = await runEchoPapaCycle();
    expect(result.success).toBe(true);
    expect(result.toolCalls).toBe(1);
  });

  it("enforces tool whitelist — denies non-whitelisted tools", async () => {
    mockInferWithTools
      .mockResolvedValueOnce(mockInferenceResponse({
        content: null,
        toolCalls: [{ id: "tc1", name: "web_search", arguments: { query: "test" } }],
      }))
      .mockResolvedValueOnce(mockInferenceResponse({
        content: "Done.", toolCalls: null,
      }));

    const result = await runEchoPapaCycle();
    // web_search is not in Papa's whitelist — should get DENIED message in tool result
    expect(result.toolCalls).toBe(1);
    // The tool should have executed but returned DENIED
    const addMessageCalls = mockAddMessage.mock.calls;
    const toolMessages = addMessageCalls.filter(
      (c: unknown[]) => (c[1] as any).role === "tool",
    );
    expect(toolMessages.some((c: unknown[]) => (c[1] as any).content.includes("DENIED"))).toBe(true);
  });

  it("enforces protected path — denies soul.md write", async () => {
    mockInferWithTools
      .mockResolvedValueOnce(mockInferenceResponse({
        content: null,
        toolCalls: [{ id: "tc1", name: "file_write", arguments: { path: "soul.md", content: "hacked" } }],
      }))
      .mockResolvedValueOnce(mockInferenceResponse({
        content: "Done.", toolCalls: null,
      }));

    await runEchoPapaCycle();

    const toolMessages = mockAddMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as any).role === "tool",
    );
    expect(toolMessages.some((c: unknown[]) => (c[1] as any).content.includes("DENIED"))).toBe(true);
  });

  it("enforces must-read-before-delete", async () => {
    mockInferWithTools
      .mockResolvedValueOnce(mockInferenceResponse({
        content: null,
        toolCalls: [{ id: "tc1", name: "file_delete", arguments: { path: "old-notes.md" } }],
      }))
      .mockResolvedValueOnce(mockInferenceResponse({
        content: "Done.", toolCalls: null,
      }));

    await runEchoPapaCycle();

    const toolMessages = mockAddMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as any).role === "tool",
    );
    expect(toolMessages.some((c: unknown[]) => (c[1] as any).content.includes("must file_read"))).toBe(true);
  });

  it("enforces recency guard — denies write to recently modified file", async () => {
    mockGetFileWithMeta.mockResolvedValue({
      updatedAt: new Date().toISOString(), // just now
    });

    mockInferWithTools
      .mockResolvedValueOnce(mockInferenceResponse({
        content: null,
        toolCalls: [{ id: "tc1", name: "file_write", arguments: { path: "recent.md", content: "overwrite" } }],
      }))
      .mockResolvedValueOnce(mockInferenceResponse({
        content: "Done.", toolCalls: null,
      }));

    await runEchoPapaCycle();

    const toolMessages = mockAddMessage.mock.calls.filter(
      (c: unknown[]) => (c[1] as any).role === "tool",
    );
    expect(toolMessages.some((c: unknown[]) => (c[1] as any).content.includes("modified less than 5 minutes"))).toBe(true);
  });

  it("handles inference error gracefully", async () => {
    mockInferWithTools.mockRejectedValue(new Error("API timeout"));

    const result = await runEchoPapaCycle();
    expect(result.success).toBe(false);
    expect(result.result).toContain("API timeout");
  });

  it("writes report to knowledge after cycle", async () => {
    mockInferWithTools.mockResolvedValue(
      mockInferenceResponse({ content: "All clean.", toolCalls: null }),
    );

    await runEchoPapaCycle();

    expect(mockUpsertFile).toHaveBeenCalledWith(
      "ops/echo-papa-report.md",
      expect.stringContaining("Echo Papa Report"),
    );
  });

  it("stops after max iterations (15)", async () => {
    // Return tool calls forever
    mockInferWithTools.mockResolvedValue(mockInferenceResponse({
      content: null,
      toolCalls: [{ id: "tc1", name: "file_list", arguments: { path: "" } }],
    }));
    mockListFiles.mockResolvedValue([]);

    const result = await runEchoPapaCycle();
    // Should have stopped at 15 iterations
    expect(result.toolCalls).toBeLessThanOrEqual(15);
  });
});
