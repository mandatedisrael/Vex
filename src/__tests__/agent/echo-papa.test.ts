/**
 * Tests for Echo Papa — LLM-powered background knowledge steward.
 *
 * Focuses on: tool whitelist enforcement, safety rules (protected paths,
 * recency guard, must-read-before-delete), and cycle orchestration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB client
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();

vi.mock("../../agent/db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  execute: (...args: unknown[]) => mockExecute(...args),
}));

// Mock inference
vi.mock("../../agent/inference.js", () => ({
  inferWithTools: vi.fn(),
  loadInferenceConfig: vi.fn().mockResolvedValue({
    provider: "test", model: "test", endpoint: "http://test",
    contextLimit: 40000, inputPricePerM: 1, outputPricePerM: 3,
    recommendedMinLockedOg: 1, alertThresholdOg: 1.2,
  }),
}));

// Mock engine
vi.mock("../../agent/engine.js", () => ({
  createSession: vi.fn(() => ({
    id: "papa-test-session",
    messages: [],
    loadedKnowledge: new Map(),
    inferenceConfig: {
      provider: "test", model: "test", endpoint: "http://test",
      contextLimit: 40000, inputPricePerM: 1, outputPricePerM: 3,
      recommendedMinLockedOg: 1, alertThresholdOg: 1.2,
    },
  })),
}));

// Mock repos
vi.mock("../../agent/db/repos/sessions.js", () => ({
  createSession: vi.fn(),
  setScope: vi.fn(),
}));

vi.mock("../../agent/db/repos/messages.js", () => ({
  addMessage: vi.fn(),
}));

vi.mock("../../agent/db/repos/usage.js", () => ({
  logUsage: vi.fn(),
}));

vi.mock("../../agent/db/repos/memory.js", () => ({
  listEntriesWithIds: vi.fn().mockResolvedValue([]),
  appendMemory: vi.fn().mockResolvedValue(true),
  replaceEntry: vi.fn().mockResolvedValue(true),
  deleteEntry: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../agent/db/repos/knowledge.js", () => ({
  getFile: vi.fn(),
  getFileWithMeta: vi.fn(),
  upsertFile: vi.fn(),
  deleteFile: vi.fn(),
  listFiles: vi.fn().mockResolvedValue([]),
  fileCount: vi.fn().mockResolvedValue(0),
}));


vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { runEchoPapaCycle } = await import("../../agent/echo-papa.js");
const { inferWithTools } = await import("../../agent/inference.js");
const knowledgeRepo = await import("../../agent/db/repos/knowledge.js");
const sessionsRepo = await import("../../agent/db/repos/sessions.js");

const mockInfer = inferWithTools as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: model returns text (no tools) — "clean, no action needed"
  mockInfer.mockResolvedValue({
    content: "All clean, no action needed.",
    toolCalls: null,
    usage: { promptTokens: 1000, completionTokens: 200 },
  });
});

describe("runEchoPapaCycle", () => {
  it("creates a fresh session per cycle", async () => {
    await runEchoPapaCycle();
    expect(sessionsRepo.createSession).toHaveBeenCalled();
    expect(sessionsRepo.setScope).toHaveBeenCalledWith("papa-test-session", "papa");
  });

  it("returns success with model response", async () => {
    const result = await runEchoPapaCycle();
    expect(result.success).toBe(true);
    expect(result.result).toContain("All clean");
  });

  it("calls inferWithTools with Papa's limited tool set", async () => {
    await runEchoPapaCycle();

    const tools = mockInfer.mock.calls[0][2] as Array<{ function: { name: string } }>;
    const toolNames = tools.map(t => t.function.name);

    // Papa should only have CRUD tools
    expect(toolNames).toContain("file_read");
    expect(toolNames).toContain("file_write");
    expect(toolNames).toContain("file_list");
    expect(toolNames).toContain("file_delete");
    expect(toolNames).toContain("memory_manage");

    // Papa should NOT have trading/web/scheduling tools
    expect(toolNames).not.toContain("web_search");
    expect(toolNames).not.toContain("web_fetch");
    expect(toolNames).not.toContain("trade_log");
    expect(toolNames).not.toContain("schedule_create");
    expect(toolNames).not.toContain("subagent_spawn");
    expect(toolNames).not.toContain("wallet_balance");
  });

  it("uses Papa's own system prompt (not mama's)", async () => {
    await runEchoPapaCycle();

    const messages = mockInfer.mock.calls[0][1] as Array<{ role: string; content: string }>;
    const systemMsg = messages.find(m => m.role === "system");

    expect(systemMsg?.content).toContain("Echo Papa");
    expect(systemMsg?.content).toContain("knowledge steward");
    // Should NOT contain mama's trading-first identity
    expect(systemMsg?.content).not.toContain("autonomous entity");
    expect(systemMsg?.content).not.toContain("purpose is to win");
  });

  it("writes report to knowledge/ops/echo-papa-report.md", async () => {
    await runEchoPapaCycle();
    expect(knowledgeRepo.upsertFile).toHaveBeenCalledWith(
      "ops/echo-papa-report.md",
      expect.stringContaining("Echo Papa Report"),
    );
  });

  it("logs usage for billing", async () => {
    const { logUsage } = await import("../../agent/db/repos/usage.js");
    await runEchoPapaCycle();
    expect(logUsage).toHaveBeenCalledWith(
      "papa-test-session",
      1000, // promptTokens
      200,  // completionTokens
      expect.any(Number), // costOg
    );
  });
});

describe("Papa safety rules", () => {
  it("denies soul.md writes", async () => {
    // Model tries to write to soul.md
    mockInfer.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ name: "file_write", arguments: { path: "soul.md", content: "hacked" } }],
      usage: { promptTokens: 500, completionTokens: 100 },
    });
    // After denied tool, model gives up
    mockInfer.mockResolvedValueOnce({
      content: "Understood, skipping soul.md",
      toolCalls: null,
      usage: { promptTokens: 500, completionTokens: 50 },
    });

    await runEchoPapaCycle();

    // soul.md should NOT have been written
    expect(knowledgeRepo.upsertFile).not.toHaveBeenCalledWith("soul.md", expect.anything());
  });

  it("denies path traversal", async () => {
    mockInfer.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ name: "file_write", arguments: { path: "../../../etc/passwd", content: "bad" } }],
      usage: { promptTokens: 500, completionTokens: 100 },
    });
    mockInfer.mockResolvedValueOnce({
      content: "Skipped",
      toolCalls: null,
      usage: { promptTokens: 500, completionTokens: 50 },
    });

    await runEchoPapaCycle();

    expect(knowledgeRepo.upsertFile).not.toHaveBeenCalledWith(
      expect.stringContaining("../"),
      expect.anything(),
    );
  });

  it("denies delete without prior read", async () => {
    mockInfer.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ name: "file_delete", arguments: { path: "trades/old.md" } }],
      usage: { promptTokens: 500, completionTokens: 100 },
    });
    mockInfer.mockResolvedValueOnce({
      content: "Understood, need to read first",
      toolCalls: null,
      usage: { promptTokens: 500, completionTokens: 50 },
    });

    await runEchoPapaCycle();

    expect(knowledgeRepo.deleteFile).not.toHaveBeenCalled();
  });

  it("allows delete after read in same cycle", async () => {
    (knowledgeRepo.getFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce("old content");
    (knowledgeRepo.getFileWithMeta as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: "old content", updatedAt: "2026-03-01T00:00:00Z", sizeBytes: 100,
    });

    // First call: model reads the file
    mockInfer.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ name: "file_read", arguments: { path: "trades/old.md" } }],
      usage: { promptTokens: 500, completionTokens: 100 },
    });
    // Second call: model deletes it
    mockInfer.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ name: "file_delete", arguments: { path: "trades/old.md" } }],
      usage: { promptTokens: 500, completionTokens: 100 },
    });
    // Third call: done
    mockInfer.mockResolvedValueOnce({
      content: "Deleted old file",
      toolCalls: null,
      usage: { promptTokens: 500, completionTokens: 50 },
    });

    await runEchoPapaCycle();

    expect(knowledgeRepo.deleteFile).toHaveBeenCalledWith("trades/old.md");
  });

  it("denies recently modified file writes", async () => {
    (knowledgeRepo.getFileWithMeta as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: "fresh content", updatedAt: new Date().toISOString(), sizeBytes: 100,
    });

    mockInfer.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ name: "file_write", arguments: { path: "active/trade.md", content: "overwrite" } }],
      usage: { promptTokens: 500, completionTokens: 100 },
    });
    mockInfer.mockResolvedValueOnce({
      content: "Skipped recently modified file",
      toolCalls: null,
      usage: { promptTokens: 500, completionTokens: 50 },
    });

    await runEchoPapaCycle();

    // The write should have been denied (file was just modified)
    expect(knowledgeRepo.upsertFile).not.toHaveBeenCalledWith("active/trade.md", "overwrite");
  });

  it("rejects non-whitelisted tool calls", async () => {
    mockInfer.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ name: "web_search", arguments: { query: "bitcoin price" } }],
      usage: { promptTokens: 500, completionTokens: 100 },
    });
    mockInfer.mockResolvedValueOnce({
      content: "Cannot search the web",
      toolCalls: null,
      usage: { promptTokens: 500, completionTokens: 50 },
    });

    const result = await runEchoPapaCycle();
    expect(result.success).toBe(true);
    // web_search should not have been executed (it's not in the PAPA tools)
  });
});
