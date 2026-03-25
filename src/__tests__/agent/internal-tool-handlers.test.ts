import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockSession, mockInternalToolCall, createEmitSpy, getEmittedEvents } from "./_fixtures.js";

// DB + dependency mocks
const mockUpsertSoul = vi.fn();
const mockUpsertFile = vi.fn();
const mockGetFile = vi.fn();
const mockListFiles = vi.fn();
const mockDeleteFile = vi.fn();
const mockFileCount = vi.fn();
const mockAppendMemory = vi.fn();
const mockListEntriesWithIds = vi.fn();
const mockReplaceEntry = vi.fn();
const mockDeleteEntry = vi.fn();
const mockAddMessage = vi.fn();
const mockAddTrade = vi.fn();
const mockWebSearchFn = vi.fn();
const mockWebFetchFn = vi.fn();
const mockSpawnSubagent = vi.fn();
const mockGetSubagentStatus = vi.fn();
const mockStopSubagent = vi.fn();
const mockAddTask = vi.fn();
const mockRemoveTask = vi.fn();

vi.mock("../../agent/db/repos/soul.js", () => ({
  upsertSoul: (...args: unknown[]) => mockUpsertSoul(...args),
}));
vi.mock("../../agent/db/repos/knowledge.js", () => ({
  upsertFile: (...args: unknown[]) => mockUpsertFile(...args),
  getFile: (...args: unknown[]) => mockGetFile(...args),
  listFiles: (...args: unknown[]) => mockListFiles(...args),
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
  fileCount: () => mockFileCount(),
}));
vi.mock("../../agent/db/repos/memory.js", () => ({
  appendMemory: (...args: unknown[]) => mockAppendMemory(...args),
  listEntriesWithIds: () => mockListEntriesWithIds(),
  replaceEntry: (...args: unknown[]) => mockReplaceEntry(...args),
  deleteEntry: (...args: unknown[]) => mockDeleteEntry(...args),
}));
vi.mock("../../agent/db/repos/messages.js", () => ({
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
}));
vi.mock("../../agent/db/repos/trades.js", () => ({
  addTrade: (...args: unknown[]) => mockAddTrade(...args),
}));
vi.mock("../../agent/search.js", () => ({
  webSearch: (...args: unknown[]) => mockWebSearchFn(...args),
  webFetch: (...args: unknown[]) => mockWebFetchFn(...args),
}));
vi.mock("../../agent/subagent.js", () => ({
  spawnSubagent: (...args: unknown[]) => mockSpawnSubagent(...args),
  getSubagentStatus: (...args: unknown[]) => mockGetSubagentStatus(...args),
  stopSubagent: (...args: unknown[]) => mockStopSubagent(...args),
}));
vi.mock("../../agent/scheduler.js", () => ({
  addTask: (...args: unknown[]) => mockAddTask(...args),
  removeTask: (...args: unknown[]) => mockRemoveTask(...args),
}));
vi.mock("../../agent/trade-capture.js", () => ({
  deriveTradeIdFromTrade: () => "trade_derived_123",
}));
vi.mock("../../khalani/chains.js", () => ({ CHAIN_ALIASES: {} }));
vi.mock("../../kyberswap/chains.js", () => ({ getKyberChains: () => [], resolveChainSlug: (s: string) => s }));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { processInternalTools } = await import("../../agent/internal-tool-handlers.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockFileCount.mockResolvedValue(5);
  mockAddMessage.mockResolvedValue(undefined);
  mockUpsertSoul.mockResolvedValue(undefined);
  mockUpsertFile.mockResolvedValue(undefined);
  mockDeleteFile.mockResolvedValue(undefined);
  mockAppendMemory.mockResolvedValue(undefined);
  mockListEntriesWithIds.mockResolvedValue([]);
  mockAddTrade.mockResolvedValue(undefined);
  mockAddTask.mockResolvedValue(undefined);
});

// ── Dispatch ────────────────────────────────────────────────────────

describe("processInternalTools — dispatch", () => {
  it("emits tool_start and tool_result for each tool", async () => {
    mockGetFile.mockResolvedValue("file content");
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("file_read", { path: "test.md" })],
      session, emit,
    );

    expect(getEmittedEvents(emit, "tool_start")).toHaveLength(1);
    expect(getEmittedEvents(emit, "tool_result")).toHaveLength(1);
  });

  it("handles unknown tool type", async () => {
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("nonexistent" as any, {})],
      session, emit,
    );

    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
    expect(results[0].data.output).toContain("Unknown tool");
  });

  it("catches exceptions from handlers", async () => {
    mockGetFile.mockRejectedValue(new Error("DB crash"));
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("file_read", { path: "fail.md" })],
      session, emit,
    );

    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
  });
});

// ── File handlers ───────────────────────────────────────────────────

describe("file_write", () => {
  it("writes knowledge file", async () => {
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("file_write", { path: "notes.md", content: "Hello" })],
      session, emit,
    );

    expect(mockUpsertFile).toHaveBeenCalledWith("notes.md", "Hello");
  });

  it("writes soul.md via soul repo", async () => {
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("file_write", { path: "soul.md", content: "I am EchoClaw" })],
      session, emit,
    );

    expect(mockUpsertSoul).toHaveBeenCalledWith("I am EchoClaw");
  });

  it("blocks path traversal", async () => {
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("file_write", { path: "../../etc/passwd", content: "hack" })],
      session, emit,
    );

    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
    expect(results[0].data.output).toContain("Blocked");
  });

  it("returns error on missing path or content", async () => {
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("file_write", { path: "" })],
      session, emit,
    );

    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
  });
});

describe("file_read", () => {
  it("loads file into session knowledge", async () => {
    mockGetFile.mockResolvedValue("# Trading Strategy");
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("file_read", { path: "trading.md" })],
      session, emit,
    );

    expect(session.loadedKnowledge.has("trading.md")).toBe(true);
  });

  it("returns preview without loading into knowledge", async () => {
    mockGetFile.mockResolvedValue("x".repeat(2000));
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("file_read", { path: "big.md", preview: true })],
      session, emit,
    );

    expect(session.loadedKnowledge.has("big.md")).toBe(false);
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.output).toContain("Preview");
  });

  it("returns not found for missing file", async () => {
    mockGetFile.mockResolvedValue(null);
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("file_read", { path: "missing.md" })],
      session, emit,
    );

    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
  });
});

describe("file_delete", () => {
  it("deletes file and removes from loadedKnowledge", async () => {
    const session = mockSession();
    session.loadedKnowledge.set("old.md", "content");
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("file_delete", { path: "old.md" })],
      session, emit,
    );

    expect(mockDeleteFile).toHaveBeenCalledWith("old.md");
    expect(session.loadedKnowledge.has("old.md")).toBe(false);
  });

  it("blocks path traversal", async () => {
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("file_delete", { path: "../secret.md" })],
      session, emit,
    );

    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
  });
});

// ── Memory handlers ─────────────────────────────────────────────────

describe("memory_update", () => {
  it("appends to memory", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("memory_update", { append: "User likes SOL" })],
      mockSession(), emit,
    );
    expect(mockAppendMemory).toHaveBeenCalledWith("User likes SOL", undefined, "agent");
  });

  it("returns error on missing text", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("memory_update", {})],
      mockSession(), emit,
    );
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
  });
});

describe("memory_manage", () => {
  it("lists entries", async () => {
    mockListEntriesWithIds.mockResolvedValue([{ id: 1, content: "test" }]);
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("memory_manage", { action: "list" })],
      session, emit,
    );

    expect(mockListEntriesWithIds).toHaveBeenCalled();
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.output).toContain("1 memory entries");
  });

  it("replaces entry", async () => {
    mockReplaceEntry.mockResolvedValue(true);
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("memory_manage", { action: "replace", id: 5, content: "new text" })],
      mockSession(), emit,
    );

    expect(mockReplaceEntry).toHaveBeenCalledWith(5, "new text");
  });

  it("returns error for replace with missing id", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("memory_manage", { action: "replace", content: "text" })],
      mockSession(), emit,
    );
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
  });

  it("deletes entry", async () => {
    mockDeleteEntry.mockResolvedValue(true);
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("memory_manage", { action: "delete", id: 3 })],
      mockSession(), emit,
    );

    expect(mockDeleteEntry).toHaveBeenCalledWith(3);
  });

  it("returns error for unknown action", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("memory_manage", { action: "purge" })],
      mockSession(), emit,
    );
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
    expect(results[0].data.output).toContain("Unknown memory action");
  });
});

// ── Web handlers ────────────────────────────────────────────────────

describe("web_search", () => {
  it("searches and returns result count", async () => {
    mockWebSearchFn.mockResolvedValue([{ title: "Result 1", url: "http://test" }]);
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("web_search", { query: "solana price" })],
      session, emit,
    );

    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.output).toContain("1 results");
  });

  it("returns error on missing query", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("web_search", {})],
      mockSession(), emit,
    );
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
  });
});

describe("web_fetch", () => {
  it("fetches URL and returns title", async () => {
    mockWebFetchFn.mockResolvedValue({ markdown: "# Test Page\nContent", title: "Test Page" });
    const session = mockSession();
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("web_fetch", { url: "https://example.com" })],
      session, emit,
    );

    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.output).toContain("Test Page");
  });

  it("rejects invalid URL", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("web_fetch", { url: "not-a-url" })],
      mockSession(), emit,
    );
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
  });
});

// ── Trade handler ───────────────────────────────────────────────────

describe("trade_log", () => {
  it("logs valid trade", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("trade_log", {
        trade: {
          type: "swap", chain: "solana", status: "executed",
          input: { token: "SOL", amount: "1" },
          output: { token: "USDC", amount: "150" },
          signature: "sig123",
        },
      })],
      mockSession(), emit,
    );

    expect(mockAddTrade).toHaveBeenCalled();
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(true);
  });

  it("rejects incomplete trade", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("trade_log", { trade: { type: "swap" } })],
      mockSession(), emit,
    );
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
    expect(results[0].data.output).toContain("Incomplete");
  });

  it("parses string trade param as JSON", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("trade_log", {
        trade: JSON.stringify({
          type: "swap", chain: "solana", status: "executed",
          input: { token: "SOL", amount: "1" }, output: { token: "USDC", amount: "1" },
          signature: "s1",
        }),
      })],
      mockSession(), emit,
    );
    expect(mockAddTrade).toHaveBeenCalled();
  });

  it("rejects invalid JSON string trade", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("trade_log", { trade: "not json" })],
      mockSession(), emit,
    );
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
  });
});

// ── Subagent handlers ───────────────────────────────────────────────

describe("subagent_spawn", () => {
  it("spawns subagent with name and task", async () => {
    mockSpawnSubagent.mockResolvedValue({ id: "sub-1", name: "EchoSpark" });
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("subagent_spawn", { name: "EchoSpark", task: "Analyze trends" })],
      mockSession(), emit,
    );

    expect(mockSpawnSubagent).toHaveBeenCalledWith(expect.objectContaining({
      name: "EchoSpark", task: "Analyze trends",
    }));
  });

  it("returns error on missing name", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("subagent_spawn", { task: "test" })],
      mockSession(), emit,
    );
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
  });
});

describe("subagent_status", () => {
  it("returns formatted status", async () => {
    mockGetSubagentStatus.mockResolvedValue([{
      id: "sub-1", name: "EchoSpark", status: "running",
      startedAt: new Date().toISOString(), endedAt: null,
      iterations: 5, maxIterations: 25, result: null, error: null,
    }]);
    const emit = createEmitSpy();

    await processInternalTools(
      [mockInternalToolCall("subagent_status", {})],
      mockSession(), emit,
    );

    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.output).toContain("EchoSpark");
  });
});

describe("subagent_stop", () => {
  it("returns error on missing id", async () => {
    const emit = createEmitSpy();
    await processInternalTools(
      [mockInternalToolCall("subagent_stop", {})],
      mockSession(), emit,
    );
    const results = getEmittedEvents(emit, "tool_result");
    expect(results[0].data.success).toBe(false);
  });
});
