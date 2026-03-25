import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInferenceConfig, mockMessage, mockInferenceResponse, mockSession, createEmitSpy, getEmittedEvents } from "./_fixtures.js";

const mockLoadInferenceConfig = vi.fn();
const mockInferWithTools = vi.fn();
const mockInferNonStreaming = vi.fn();
const mockExecuteTool = vi.fn();
const mockRecordBillingSnapshot = vi.fn();
const mockGetActiveProvider = vi.fn();
const mockProcessInternalTools = vi.fn();
const mockCaptureTradeFromResult = vi.fn();
const mockBuildSystemPrompt = vi.fn();

// DB mocks
const mockCreateSessionRepo = vi.fn();
const mockAddMessage = vi.fn();
const mockLogUsage = vi.fn();
const mockGetUsageStats = vi.fn();
const mockUpdateSessionTokenCount = vi.fn();
const mockEnqueueApproval = vi.fn();
const mockAppendMemory = vi.fn();
const mockArchiveMessages = vi.fn();
const mockCheckpointSession = vi.fn();

vi.mock("../../agent/inference.js", () => ({
  loadInferenceConfig: () => mockLoadInferenceConfig(),
  inferWithTools: (...args: unknown[]) => mockInferWithTools(...args),
  inferNonStreaming: (...args: unknown[]) => mockInferNonStreaming(...args),
}));
vi.mock("../../agent/executor.js", () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
}));
vi.mock("../../agent/billing.js", () => ({
  recordBillingSnapshot: (...args: unknown[]) => mockRecordBillingSnapshot(...args),
}));
vi.mock("../../agent/providers/registry.js", () => ({
  getActiveProvider: () => mockGetActiveProvider(),
}));
vi.mock("../../agent/internal-tool-handlers.js", () => ({
  processInternalTools: (...args: unknown[]) => mockProcessInternalTools(...args),
}));
vi.mock("../../agent/trade-capture.js", () => ({
  captureTradeFromResult: (...args: unknown[]) => mockCaptureTradeFromResult(...args),
}));
vi.mock("../../agent/tools.js", () => ({
  buildSystemPrompt: (...args: unknown[]) => mockBuildSystemPrompt(...args),
}));
vi.mock("../../agent/db/repos/sessions.js", () => ({
  createSession: (...args: unknown[]) => mockCreateSessionRepo(...args),
  updateSessionTokenCount: (...args: unknown[]) => mockUpdateSessionTokenCount(...args),
  archiveSessionMessages: (...args: unknown[]) => mockArchiveMessages(...args),
  checkpointSession: (...args: unknown[]) => mockCheckpointSession(...args),
}));
vi.mock("../../agent/db/repos/messages.js", () => ({
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
}));
vi.mock("../../agent/db/repos/usage.js", () => ({
  logUsage: (...args: unknown[]) => mockLogUsage(...args),
  getUsageStats: (...args: unknown[]) => mockGetUsageStats(...args),
}));
vi.mock("../../agent/db/repos/approvals.js", () => ({
  enqueue: (...args: unknown[]) => mockEnqueueApproval(...args),
}));
vi.mock("../../agent/db/repos/memory.js", () => ({
  appendMemory: (...args: unknown[]) => mockAppendMemory(...args),
}));
vi.mock("../../agent/prompts/compaction.js", () => ({
  getCompactionSystemPrompt: () => "Compaction system prompt",
  buildCompactionPrompt: () => "Compaction user prompt",
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { initEngine, createSession, processMessage, resumeAfterApproval } = await import(
  "../../agent/engine.js"
);

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildSystemPrompt.mockResolvedValue("System prompt");
  mockLogUsage.mockResolvedValue(undefined);
  mockGetUsageStats.mockResolvedValue({ sessionTokens: 100, sessionCost: 0.01, lifetimeTokens: 1000, lifetimeCost: 0.1, requestCount: 10, lastRequestAt: null, lastBackupAt: null });
  mockCreateSessionRepo.mockResolvedValue(undefined);
  mockAddMessage.mockResolvedValue(undefined);
  mockUpdateSessionTokenCount.mockResolvedValue(undefined);
  mockRecordBillingSnapshot.mockResolvedValue(undefined);
  mockGetActiveProvider.mockReturnValue({ getBalance: vi.fn().mockResolvedValue(null), displayName: "Test" });
  mockProcessInternalTools.mockResolvedValue(undefined);
  mockCaptureTradeFromResult.mockResolvedValue([]);
});

describe("initEngine", () => {
  it("returns true when config loads successfully", async () => {
    mockLoadInferenceConfig.mockResolvedValue(mockInferenceConfig());
    const result = await initEngine();
    expect(result).toBe(true);
  });

  it("returns false when config fails", async () => {
    mockLoadInferenceConfig.mockResolvedValue(null);
    const result = await initEngine();
    expect(result).toBe(false);
  });
});

describe("createSession", () => {
  it("returns session after successful initEngine", async () => {
    mockLoadInferenceConfig.mockResolvedValue(mockInferenceConfig());
    await initEngine();
    const session = createSession();
    expect(session).not.toBeNull();
    expect(session!.id).toMatch(/^session-/);
    expect(session!.messages).toEqual([]);
  });

  it("returns null before initEngine", async () => {
    // Reset by loading null config
    mockLoadInferenceConfig.mockResolvedValue(null);
    await initEngine();
    const session = createSession();
    expect(session).toBeNull();
  });
});

describe("processMessage", () => {
  it("emits text_delta and done for text-only response", async () => {
    mockLoadInferenceConfig.mockResolvedValue(mockInferenceConfig());
    await initEngine();
    const session = createSession()!;

    mockInferWithTools.mockResolvedValue(mockInferenceResponse({ content: "Hello!", toolCalls: null }));

    const emit = createEmitSpy();
    await processMessage(session, "Hi there", emit);

    const textEvents = getEmittedEvents(emit, "text_delta");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].data.text).toBe("Hello!");

    const doneEvents = getEmittedEvents(emit, "done");
    expect(doneEvents).toHaveLength(1);
  });

  it("emits usage event after each inference call", async () => {
    mockLoadInferenceConfig.mockResolvedValue(mockInferenceConfig());
    await initEngine();
    const session = createSession()!;

    mockInferWithTools.mockResolvedValue(mockInferenceResponse({ usage: { promptTokens: 500, completionTokens: 100 } }));

    const emit = createEmitSpy();
    await processMessage(session, "test", emit);

    const usageEvents = getEmittedEvents(emit, "usage");
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0].data.promptTokens).toBe(500);
  });

  it("routes internal tools to processInternalTools", async () => {
    mockLoadInferenceConfig.mockResolvedValue(mockInferenceConfig());
    await initEngine();
    const session = createSession()!;

    // First call returns tool call, second returns text
    mockInferWithTools
      .mockResolvedValueOnce(mockInferenceResponse({
        content: null,
        toolCalls: [{ id: "call_1", name: "web_search", arguments: { query: "test" } }],
      }))
      .mockResolvedValueOnce(mockInferenceResponse({ content: "Found it!", toolCalls: null }));

    const emit = createEmitSpy();
    await processMessage(session, "search for test", emit);

    expect(mockProcessInternalTools).toHaveBeenCalled();
  });

  it("emits error + done on inference failure", async () => {
    mockLoadInferenceConfig.mockResolvedValue(mockInferenceConfig());
    await initEngine();
    const session = createSession()!;

    mockInferWithTools.mockRejectedValue(new Error("API down"));

    const emit = createEmitSpy();
    await processMessage(session, "test", emit);

    const errorEvents = getEmittedEvents(emit, "error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].data.message).toContain("Inference failed");

    const doneEvents = getEmittedEvents(emit, "done");
    expect(doneEvents).toHaveLength(1);
  });

  it("persists user message to DB", async () => {
    mockLoadInferenceConfig.mockResolvedValue(mockInferenceConfig());
    await initEngine();
    const session = createSession()!;
    mockInferWithTools.mockResolvedValue(mockInferenceResponse());

    await processMessage(session, "hello", createEmitSpy());

    expect(mockAddMessage).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({ role: "user", content: "hello" }),
    );
  });

  it("emits balance_low when provider reports low balance", async () => {
    mockLoadInferenceConfig.mockResolvedValue(mockInferenceConfig());
    await initEngine();
    const session = createSession()!;

    mockGetActiveProvider.mockReturnValue({
      getBalance: vi.fn().mockResolvedValue({ availableRaw: 1, isLow: true, lowBalanceMessage: "Low!", currency: "0G" }),
      displayName: "Test",
    });
    mockInferWithTools.mockResolvedValue(mockInferenceResponse());

    const emit = createEmitSpy();
    await processMessage(session, "test", emit);

    const lowEvents = getEmittedEvents(emit, "balance_low");
    expect(lowEvents).toHaveLength(1);
  });
});

describe("resumeAfterApproval", () => {
  it("executes approved tool and continues inference", async () => {
    mockLoadInferenceConfig.mockResolvedValue(mockInferenceConfig());
    await initEngine();
    const session = createSession()!;

    mockExecuteTool.mockResolvedValue({
      id: "t1", command: "solana swap execute", success: true,
      output: '{"success":true}', argv: ["solana", "swap", "execute"], durationMs: 100,
    });
    mockInferWithTools.mockResolvedValue(mockInferenceResponse({ content: "Swap done!", toolCalls: null }));

    const emit = createEmitSpy();
    const toolCall = { command: "solana swap execute", args: {}, confirm: true };
    await resumeAfterApproval(session, toolCall, emit, "restricted", "call_1");

    const toolStartEvents = getEmittedEvents(emit, "tool_start");
    expect(toolStartEvents).toHaveLength(1);

    const toolResultEvents = getEmittedEvents(emit, "tool_result");
    expect(toolResultEvents).toHaveLength(1);
    expect(toolResultEvents[0].data.success).toBe(true);
  });

  it("attempts trade capture on successful tool execution", async () => {
    mockLoadInferenceConfig.mockResolvedValue(mockInferenceConfig());
    await initEngine();
    const session = createSession()!;

    mockExecuteTool.mockResolvedValue({
      id: "t1", command: "solana swap execute", success: true,
      output: '{"success":true}', argv: ["solana", "swap", "execute"], durationMs: 100,
    });
    mockInferWithTools.mockResolvedValue(mockInferenceResponse());

    await resumeAfterApproval(session, { command: "solana swap execute", args: {}, confirm: true }, createEmitSpy(), "restricted");

    expect(mockCaptureTradeFromResult).toHaveBeenCalledWith(
      "solana swap execute",
      ["solana", "swap", "execute"],
      '{"success":true}',
    );
  });

  it("trade capture failure does not block the flow", async () => {
    mockLoadInferenceConfig.mockResolvedValue(mockInferenceConfig());
    await initEngine();
    const session = createSession()!;

    mockExecuteTool.mockResolvedValue({
      id: "t1", command: "test", success: true,
      output: "{}", argv: ["test"], durationMs: 100,
    });
    mockCaptureTradeFromResult.mockRejectedValue(new Error("capture error"));
    mockInferWithTools.mockResolvedValue(mockInferenceResponse());

    // Should not throw
    await expect(
      resumeAfterApproval(session, { command: "test", args: {}, confirm: true }, createEmitSpy(), "full"),
    ).resolves.toBeUndefined();
  });
});
