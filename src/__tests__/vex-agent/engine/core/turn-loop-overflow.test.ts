/**
 * PR-11 — turn-loop tool output overflow coverage.
 *
 * Verifies:
 *   - Small outputs (< 16 KiB) stay inline with no blob write.
 *   - Oversized outputs trigger a blob write and persist a stub with
 *     `metadata.payload.blob_key`.
 *   - A blob write failure falls back to inline persistence (no result
 *     dropped, even if the stub would have lost the pair-integrity
 *     guarantee).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAddMessage = vi.fn();
const mockAddEngineMessage = vi.fn();
const mockGetLiveMessages = vi.fn().mockResolvedValue([]);
const mockDispatchTool = vi.fn();
const mockIncrementIterations = vi.fn().mockResolvedValue(1);
const mockUpdateStatus = vi.fn();
const mockSetLastCheckpoint = vi.fn();
const mockEnqueueApproval = vi.fn();

const mockWriteBlob = vi.fn();
const mockGenerateBlobKey = vi.fn().mockReturnValue("tob-20260420-0000000000000001");

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: (...a: unknown[]) => mockAddEngineMessage(...a),
  getLiveMessages: (...a: unknown[]) => mockGetLiveMessages(...a),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  incrementIterations: (...a: unknown[]) => mockIncrementIterations(...a),
  updateStatus: (...a: unknown[]) => mockUpdateStatus(...a),
  setLastCheckpoint: (...a: unknown[]) => mockSetLastCheckpoint(...a),
}));

vi.mock("@vex-agent/tools/dispatcher.js", () => ({
  dispatchTool: (...a: unknown[]) => mockDispatchTool(...a),
}));

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  updateTokenCount: vi.fn(),
  setRollingSummary: vi.fn(),
  archivePrefix: vi.fn(),
  forkToolMessageToArchive: vi.fn(),
  setMemoryScopeKey: vi.fn(),
  getSession: vi.fn().mockResolvedValue({ tokenCount: 0 }),
}));

vi.mock("@vex-agent/engine/core/checkpoint.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../vex-agent/engine/core/checkpoint.js")>(
    "../../../../vex-agent/engine/core/checkpoint.js",
  );
  return {
    ...actual,
    executeCheckpoint: vi.fn().mockResolvedValue({ mode: "noop", summary: null, episodeIds: [] }),
  };
});

vi.mock("@vex-agent/db/repos/approvals.js", () => ({
  enqueue: (...a: unknown[]) => mockEnqueueApproval(...a),
}));

vi.mock("@vex-agent/db/repos/usage.js", () => ({
  logUsage: vi.fn(),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
}));

vi.mock("@vex-agent/db/repos/tool-output-blobs.js", () => ({
  writeBlob: (...a: unknown[]) => mockWriteBlob(...a),
  generateBlobKey: (...a: unknown[]) => mockGenerateBlobKey(...a),
}));

vi.mock("../../../../vex-agent/engine/core/turn.js", () => ({
  executeTurn: vi.fn(),
  saveAssistantMessage: vi.fn(),
}));

const turnLoopModule = await import("../../../../vex-agent/engine/core/turn-loop.js");
const turnModule = await import("../../../../vex-agent/engine/core/turn.js");

const mockExecuteTurn = vi.mocked(turnModule.executeTurn);
const mockSaveAssistant = vi.mocked(turnModule.saveAssistantMessage);

function makeContext(sessionKind: "chat" | "mission" | "full_autonomous" = "full_autonomous") {
  return {
    sessionId: "s1",
    sessionKind,
    loopMode: "full" as const,
    missionId: null,
    missionRunId: null,
    isSubagent: false,
    loadedDocuments: new Map<string, string>(),
    memoryScopeKey: "s1",
  };
}

const provider = {
  id: "test",
  displayName: "test",
  loadConfig: vi.fn(),
  chatCompletion: vi.fn(),
  chatCompletionSimple: vi.fn(),
  chatCompletionStream: vi.fn(),
  getBalance: vi.fn(),
  calculateCost: vi.fn(),
};
const config = { provider: "test", model: "m", contextLimit: 1_000_000, maxOutputTokens: 512, inputPricePerM: 0, outputPricePerM: 0, priceCurrency: "USD" as const, cachePricePerM: null, reasoningPricePerM: null };
const loopConfig = { maxIterations: 1, timeoutMs: 60000, contextLimit: 1_000_000 };

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveAssistant.mockResolvedValue(undefined);
  mockWriteBlob.mockResolvedValue({
    blobKey: "tob-20260420-0000000000000001",
    sessionId: "s1",
    payload: { fullOutput: "x", shapeKind: "text", sizeBytes: 100 },
    expiresAt: "2026-04-20T13:00:00.000Z",
    createdAt: "2026-04-20T12:45:00.000Z",
  });
});

describe("turn-loop tool output overflow", () => {
  it("keeps small outputs inline and does NOT write a blob", async () => {
    const smallOutput = "small tool result";
    mockExecuteTurn.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ id: "tc-1", name: "web_research", arguments: { query: "x" } }],
      promptTokens: 100,
    });
    mockDispatchTool.mockResolvedValueOnce({ success: true, output: smallOutput });

    await turnLoopModule.runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider,
      config,
      [],
      loopConfig,
    );

    expect(mockWriteBlob).not.toHaveBeenCalled();
    // Find the tool message persistence call.
    const toolSave = mockAddMessage.mock.calls.find(
      ([, msg]) => (msg as { role?: string }).role === "tool",
    );
    expect(toolSave).toBeDefined();
    expect((toolSave![1] as { content: string }).content).toBe(smallOutput);
  });

  it("writes a blob and persists a stub with metadata.payload.blob_key on overflow", async () => {
    const bigOutput = "x".repeat(20_000); // > 16 KiB
    mockExecuteTurn.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ id: "tc-1", name: "web_research", arguments: { query: "x" } }],
      promptTokens: 100,
    });
    mockDispatchTool.mockResolvedValueOnce({ success: true, output: bigOutput });

    await turnLoopModule.runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider,
      config,
      [],
      loopConfig,
    );

    expect(mockWriteBlob).toHaveBeenCalledTimes(1);
    const blobCall = mockWriteBlob.mock.calls[0]!;
    expect(blobCall[0]).toBe("tob-20260420-0000000000000001");
    expect(blobCall[1]).toBe("s1");
    expect((blobCall[2] as { fullOutput: string }).fullOutput).toBe(bigOutput);

    const toolSave = mockAddMessage.mock.calls.find(
      ([, msg]) => (msg as { role?: string }).role === "tool",
    );
    expect(toolSave).toBeDefined();
    const persistedMessage = toolSave![1] as { content: string };
    const persistedMeta = toolSave![2] as { payload?: Record<string, unknown> };
    expect(persistedMessage.content).toContain("tool_output_overflow");
    expect(persistedMessage.content).toContain("tob-20260420-0000000000000001");
    expect(persistedMeta.payload).toMatchObject({
      overflow: true,
      blobKey: "tob-20260420-0000000000000001",
      sizeBytes: expect.any(Number),
    });
  });

  it("falls back to inline persistence when blob write fails", async () => {
    const bigOutput = "y".repeat(20_000);
    mockExecuteTurn.mockResolvedValueOnce({
      content: null,
      toolCalls: [{ id: "tc-1", name: "web_research", arguments: { query: "x" } }],
      promptTokens: 100,
    });
    mockDispatchTool.mockResolvedValueOnce({ success: true, output: bigOutput });
    mockWriteBlob.mockRejectedValueOnce(new Error("db down"));

    await turnLoopModule.runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider,
      config,
      [],
      loopConfig,
    );

    const toolSave = mockAddMessage.mock.calls.find(
      ([, msg]) => (msg as { role?: string }).role === "tool",
    );
    const persistedMessage = toolSave![1] as { content: string };
    expect(persistedMessage.content).toBe(bigOutput);
  });
});
