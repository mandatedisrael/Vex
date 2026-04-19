import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Mocks ─────────────────────────────────────────────────────

const mockAddMessage = vi.fn();
const mockAddEngineMessage = vi.fn();
const mockGetLiveMessages = vi.fn().mockResolvedValue([]);
const mockDispatchTool = vi.fn();
const mockIncrementIterations = vi.fn().mockResolvedValue(1);
const mockUpdateStatus = vi.fn();
const mockSetLastCheckpoint = vi.fn();

vi.mock("@echo-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: (...a: unknown[]) => mockAddEngineMessage(...a),
  getLiveMessages: (...a: unknown[]) => mockGetLiveMessages(...a),
}));

vi.mock("@echo-agent/db/repos/mission-runs.js", () => ({
  incrementIterations: (...a: unknown[]) => mockIncrementIterations(...a),
  updateStatus: (...a: unknown[]) => mockUpdateStatus(...a),
  setLastCheckpoint: (...a: unknown[]) => mockSetLastCheckpoint(...a),
}));

vi.mock("@echo-agent/tools/dispatcher.js", () => ({
  dispatchTool: (...a: unknown[]) => mockDispatchTool(...a),
}));

const mockGetSessionForLoop = vi.fn().mockResolvedValue({ tokenCount: 0 });

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  updateTokenCount: vi.fn(),
  setRollingSummary: vi.fn(),
  archivePrefix: vi.fn(),
  forkToolMessageToArchive: vi.fn(),
  setMemoryScopeKey: vi.fn(),
  getSession: (...a: unknown[]) => mockGetSessionForLoop(...a),
}));

const mockExecuteCheckpoint = vi.fn().mockResolvedValue({
  mode: "prefix",
  summary: "new rolling summary",
  episodeIds: [],
});

vi.mock("@echo-agent/engine/core/checkpoint.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../echo-agent/engine/core/checkpoint.js")>(
    "@echo-agent/engine/core/checkpoint.js",
  );
  return {
    ...actual,
    executeCheckpoint: (...a: unknown[]) => mockExecuteCheckpoint(...a),
  };
});

vi.mock("@echo-agent/db/repos/approvals.js", () => ({
  enqueue: vi.fn(),
}));

vi.mock("@echo-agent/db/repos/usage.js", () => ({
  logUsage: vi.fn(),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

vi.mock("@echo-agent/tools/protocols/catalog.js", () => ({
  PROTOCOL_TOOLS: [],
  PROTOCOL_NAMESPACE_ALLOWLIST: [],
}));

const { runTurnLoop } = await import("../../../../echo-agent/engine/core/turn-loop.js");

describe("turn-loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // PR-2: promotion hook was removed — lint against regression that
  // would silently reintroduce the session_episodes → knowledge_entries
  // auto-promotion pipeline on checkpoint. Memory contract:
  // `knowledge_*` is manual-write-only via `knowledge_write` /
  // `knowledge_supersede`. session_episodes are recall-only.
  it("does not call runPromotionForSession or import the removed promotion module", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/echo-agent/engine/core/turn-loop.ts"),
      "utf-8",
    );
    expect(src).not.toContain("runPromotionForSession");
    expect(src).not.toContain("knowledge/promotion");
  });

  function makeContext(overrides = {}) {
    return {
      sessionId: "session-1",
      sessionKind: "chat" as const,
      loopMode: "off" as const,
      missionId: null,
      missionRunId: null,
      isSubagent: false,
      loadedDocuments: new Map<string, string>(),
      memoryScopeKey: "session-1",
      ...overrides,
    };
  }

  function makeProvider(responses: Array<{
    content?: string | null;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
  }>) {
    let callIndex = 0;
    return {
      chatCompletion: vi.fn().mockImplementation(() => {
        const resp = responses[callIndex] ?? responses[responses.length - 1];
        callIndex++;
        return Promise.resolve({
          content: resp.content ?? null,
          toolCalls: resp.toolCalls ?? null,
          usage: { promptTokens: 1000, completionTokens: 200, cachedTokens: 0, reasoningTokens: 0 },
        });
      }),
      calculateCost: vi.fn().mockReturnValue({ totalCost: 0.001, currency: "USD" }),
    };
  }

  function makeConfig() {
    return {
      provider: "openrouter",
      model: "test-model",
      contextLimit: 128000,
      maxOutputTokens: 4096,
      inputPricePerM: 3,
      outputPricePerM: 15,
    };
  }

  const defaultLoopConfig = {
    maxIterations: 10,
    timeoutMs: 60000,
    contextLimit: 128000,
  };

  // ── Chat mode ───────────────────────────────────────────────

  describe("chat mode", () => {
    it("stops after text response", async () => {
      const provider = makeProvider([{ content: "Hello!" }]);
      const result = await runTurnLoop(
        makeContext(), [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.text).toBe("Hello!");
      expect(result.toolCallsMade).toBe(0);
      expect(result.stopReason).toBeNull();
      expect(provider.chatCompletion).toHaveBeenCalledTimes(1);
    });

    it("handles tool call then text response", async () => {
      const provider = makeProvider([
        { toolCalls: [{ id: "call-1", name: "discover_tools", arguments: { query: "balance" } }] },
        { content: "Your balance is 2.5 SOL" },
      ]);
      mockDispatchTool.mockResolvedValue({ success: true, output: '{"balance":"2.5"}' });

      const result = await runTurnLoop(
        makeContext(), [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.text).toBe("Your balance is 2.5 SOL");
      expect(result.toolCallsMade).toBe(1);
    });
  });

  // ── Mission mode ────────────────────────────────────────────

  describe("mission mode", () => {
    it("does not stop on text — adds continue message", async () => {
      const provider = makeProvider([
        { content: "Assessing market conditions..." },
        { content: "No opportunity found — stopping." },
      ]);

      const result = await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        { ...defaultLoopConfig, maxIterations: 3 },
      );

      // Should have called inference at least 2 times (text + continue)
      expect(provider.chatCompletion.mock.calls.length).toBeGreaterThanOrEqual(2);
      // Engine should have added continue message
      expect(mockAddEngineMessage).toHaveBeenCalled();
    });

    it("increments iterations for mission runs", async () => {
      const provider = makeProvider([{ content: "Working..." }]);

      await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        { ...defaultLoopConfig, maxIterations: 1 },
      );

      expect(mockIncrementIterations).toHaveBeenCalledWith("run-1");
    });
  });

  // ── Approval pause ──────────────────────────────────────────

  describe("approval pause", () => {
    it("pauses on pendingApproval from dispatch", async () => {
      const provider = makeProvider([
        { toolCalls: [{ id: "call-1", name: "execute_tool", arguments: { toolId: "solana.swap" } }] },
      ]);
      mockDispatchTool.mockResolvedValue({
        success: false,
        output: "Approval required for swap",
        pendingApproval: true,
      });

      const result = await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1", loopMode: "restricted" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.stopReason).toBe("approval_required");
      expect(result.pendingApprovals).toHaveLength(1);
      expect(result.pendingApprovals[0]).toMatch(/^approval-/);
      expect(mockUpdateStatus).toHaveBeenCalledWith("run-1", "paused_approval", "approval_required");
    });
  });

  // ── Iteration limit ─────────────────────────────────────────

  describe("iteration limit", () => {
    it("stops at maxIterations for mission", async () => {
      const provider = makeProvider([
        { content: "Still working..." },
        { content: "Still going..." },
      ]);

      const result = await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        { ...defaultLoopConfig, maxIterations: 0 },
      );

      expect(result.stopReason).toBe("iteration_limit");
    });
  });

  // ── Deferred save ──────────────────────────────────────────

  describe("deferred save", () => {
    it("saves assistant message with toolCalls to DB via deferred save", async () => {
      const provider = makeProvider([
        { toolCalls: [{ id: "call-1", name: "web_search", arguments: { query: "test" } }] },
        { content: "Done" },
      ]);
      mockDispatchTool.mockResolvedValue({ success: true, output: '{"results":[]}' });

      await runTurnLoop(
        makeContext(), [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      // First addMessage call should be the assistant message with toolCalls
      expect(mockAddMessage).toHaveBeenCalled();
      const firstCall = mockAddMessage.mock.calls[0];
      expect(firstCall[1].role).toBe("assistant");
      expect(firstCall[1].toolCalls).toHaveLength(1);
      expect(firstCall[1].toolCalls[0].command).toBe("web_search");
    });

    it("saves text-only assistant message via deferred save", async () => {
      const provider = makeProvider([{ content: "Hello!" }]);

      await runTurnLoop(
        makeContext(), [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(mockAddMessage).toHaveBeenCalled();
      const [, msg, metadata] = mockAddMessage.mock.calls[0];
      expect(msg.role).toBe("assistant");
      expect(msg.content).toBe("Hello!");
      expect(metadata.source).toBe("assistant");
    });

    it("saves assistant message BEFORE tool results (correct ordering)", async () => {
      const provider = makeProvider([
        { toolCalls: [{ id: "call-1", name: "web_search", arguments: { query: "test" } }] },
        { content: "Done" },
      ]);
      mockDispatchTool.mockResolvedValue({ success: true, output: '{"ok":true}' });

      await runTurnLoop(
        makeContext(), [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      // Find the tool-call turn's messages (first two addMessage calls)
      const calls = mockAddMessage.mock.calls;
      // call[0] = assistant with toolCalls, call[1] = tool result
      expect(calls[0][1].role).toBe("assistant");
      expect(calls[1][1].role).toBe("tool");
      expect(calls[1][1].toolCallId).toBe("call-1");
    });
  });

  // ── Batch approval trimming ────────────────────────────────

  describe("batch approval", () => {
    it("trims assistant message to canonical prefix on approval break", async () => {
      const provider = makeProvider([
        {
          toolCalls: [
            { id: "call-1", name: "web_search", arguments: { query: "test" } },
            { id: "call-2", name: "execute_tool", arguments: { toolId: "solana.swap" } },
            { id: "call-3", name: "web_fetch", arguments: { url: "https://x.com" } },
          ],
        },
      ]);

      let callIndex = 0;
      mockDispatchTool.mockImplementation(() => {
        callIndex++;
        if (callIndex === 2) {
          return Promise.resolve({ success: false, output: "Approval required", pendingApproval: true });
        }
        return Promise.resolve({ success: true, output: `result-${callIndex}` });
      });

      const result = await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1", loopMode: "restricted" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.stopReason).toBe("approval_required");

      // Assistant message should contain only call-1 and call-2 (dispatched), NOT call-3
      const assistantSave = mockAddMessage.mock.calls.find(
        (c: unknown[]) => (c[1] as Record<string, unknown>).role === "assistant",
      );
      expect(assistantSave).toBeTruthy();
      const savedToolCalls = (assistantSave![1] as Record<string, unknown>).toolCalls as Array<Record<string, unknown>>;
      expect(savedToolCalls).toHaveLength(2);
      expect(savedToolCalls[0].id).toBe("call-1");
      expect(savedToolCalls[1].id).toBe("call-2");
    });

    it("does NOT save tool_result for approval call", async () => {
      const provider = makeProvider([
        {
          toolCalls: [
            { id: "call-1", name: "web_search", arguments: { query: "test" } },
            { id: "call-2", name: "execute_tool", arguments: { toolId: "solana.swap" } },
          ],
        },
      ]);

      let callIndex = 0;
      mockDispatchTool.mockImplementation(() => {
        callIndex++;
        if (callIndex === 2) {
          return Promise.resolve({ success: false, output: "Approval required", pendingApproval: true });
        }
        return Promise.resolve({ success: true, output: "search-result" });
      });

      await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1", loopMode: "restricted" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      // Tool results saved: only call-1 (the successful one)
      const toolResults = mockAddMessage.mock.calls.filter(
        (c: unknown[]) => (c[1] as Record<string, unknown>).role === "tool",
      );
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0][1] as Record<string, unknown>).toolCallId).toBe("call-1");
    });

    it("returns current turn content as text on approval break", async () => {
      const provider = makeProvider([
        {
          content: "I'll swap SOL for USDC now.",
          toolCalls: [
            { id: "call-1", name: "execute_tool", arguments: { toolId: "solana.swap" } },
          ],
        },
      ]);

      mockDispatchTool.mockResolvedValue({ success: false, output: "Approval required", pendingApproval: true });

      const result = await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1", loopMode: "restricted" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.stopReason).toBe("approval_required");
      expect(result.text).toBe("I'll swap SOL for USDC now.");
    });
  });

  // ── Batch engine signal trimming ───────────────────────────

  describe("batch engine signal", () => {
    it("trims unexecuted calls after engine signal", async () => {
      const provider = makeProvider([
        {
          toolCalls: [
            { id: "call-1", name: "web_search", arguments: { query: "market" } },
            { id: "call-2", name: "mission_stop", arguments: { reason: "goal_reached", summary: "Done" } },
            { id: "call-3", name: "web_fetch", arguments: { url: "https://example.com" } },
          ],
        },
      ]);

      let callIndex = 0;
      mockDispatchTool.mockImplementation(() => {
        callIndex++;
        if (callIndex === 2) {
          return Promise.resolve({
            success: true,
            output: "Mission stop: goal_reached",
            engineSignal: { type: "stop_mission", reason: "goal_reached", summary: "Done" },
          });
        }
        return Promise.resolve({ success: true, output: `result-${callIndex}` });
      });

      const result = await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.stopReason).toBe("goal_reached");

      // Assistant message: call-1 + call-2, NOT call-3
      const assistantSave = mockAddMessage.mock.calls.find(
        (c: unknown[]) => (c[1] as Record<string, unknown>).role === "assistant",
      );
      const savedToolCalls = (assistantSave![1] as Record<string, unknown>).toolCalls as Array<Record<string, unknown>>;
      expect(savedToolCalls).toHaveLength(2);

      // Tool results: both call-1 and call-2 (engine signal call gets result saved)
      const toolResults = mockAddMessage.mock.calls.filter(
        (c: unknown[]) => (c[1] as Record<string, unknown>).role === "tool",
      );
      expect(toolResults).toHaveLength(2);
    });

    it("stop_mission returns stopPayload with summary and evidence", async () => {
      const provider = makeProvider([
        { toolCalls: [{ id: "call-1", name: "mission_stop", arguments: {} }] },
      ]);

      mockDispatchTool.mockResolvedValue({
        success: true,
        output: "Mission stop: goal_reached",
        engineSignal: {
          type: "stop_mission",
          reason: "goal_reached",
          summary: "Accumulated target SOL",
          evidence: { balanceSol: 10.5 },
        },
      });

      const result = await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.stopReason).toBe("goal_reached");
      expect(result.stopPayload).toBeDefined();
      expect(result.stopPayload!.summary).toBe("Accumulated target SOL");
      expect(result.stopPayload!.evidence).toEqual({ balanceSol: 10.5 });
    });
  });

  // ── wait_for_parent engine signal ──────────────────────────

  describe("wait_for_parent signal", () => {
    it("breaks loop with waiting_for_parent stopReason", async () => {
      const provider = makeProvider([
        { toolCalls: [{ id: "call-1", name: "subagent_request_parent", arguments: {} }] },
      ]);

      mockDispatchTool.mockResolvedValue({
        success: true,
        output: "Request sent to parent",
        engineSignal: { type: "wait_for_parent", reason: "waiting_for_parent", summary: "Need help" },
      });

      const result = await runTurnLoop(
        makeContext({ isSubagent: true }),
        [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.stopReason).toBe("waiting_for_parent");
      expect(result.text).toBe("Request sent to parent");
    });
  });

  // ── Checkpoint gating ──────────────────────────────────────

  describe("checkpoint gate", () => {
    it("fires executeCheckpoint after a tool-only batch when token count exceeds threshold", async () => {
      mockGetSessionForLoop.mockResolvedValue({ tokenCount: 120_000 });

      const provider = makeProvider([
        { toolCalls: [{ id: "call-1", name: "web_search", arguments: { query: "x" } }] },
        { content: "wrapped up" },
      ]);
      mockDispatchTool.mockResolvedValue({ success: true, output: "huge-output" });

      await runTurnLoop(
        makeContext(), [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      // Must have fired at least once on the tool-only batch branch (before the
      // text-response branch would have fired it again).
      expect(mockExecuteCheckpoint).toHaveBeenCalled();
      const [[sessionId, scopeKey]] = mockExecuteCheckpoint.mock.calls;
      expect(sessionId).toBe("session-1");
      expect(scopeKey).toBe("session-1");
    });

    it("does not fire executeCheckpoint when token count is below threshold", async () => {
      mockGetSessionForLoop.mockResolvedValue({ tokenCount: 1_000 });

      const provider = makeProvider([{ content: "done" }]);

      await runTurnLoop(
        makeContext(), [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(mockExecuteCheckpoint).not.toHaveBeenCalled();
    });

    it("noop checkpoint: [Engine: continue] fires in SAME iteration, not the next", async () => {
      // Load-bearing invariant: when maybeRunCheckpoint sees `mode: "noop"`
      // it must return false so the text branch falls through to the
      // mission-continue injection — NOT short-circuit with `continue`.
      // `maxIterations: 1` is deliberate: if continue appears in `order`,
      // it cannot have come from a later iteration, so it must have fired
      // in the SAME iteration as the noop checkpoint.
      const order: string[] = [];
      mockGetSessionForLoop.mockResolvedValue({ tokenCount: 120_000 });
      mockExecuteCheckpoint.mockImplementationOnce(async () => {
        order.push("ckpt");
        return { mode: "noop" as const, summary: null, episodeIds: [] };
      });
      mockAddEngineMessage.mockImplementationOnce(async () => {
        order.push("continue");
      });

      const chatCompletion = vi.fn().mockImplementationOnce(async () => {
        order.push("turn");
        return {
          content: "assessing",
          toolCalls: null,
          usage: { promptTokens: 120_000, completionTokens: 200, cachedTokens: 0, reasoningTokens: 0 },
        };
      });
      const provider = {
        chatCompletion,
        calculateCost: vi.fn().mockReturnValue({ totalCost: 0.001, currency: "USD" }),
      };

      await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        { ...defaultLoopConfig, maxIterations: 1 },
      );

      expect(order).toEqual(["turn", "ckpt", "continue"]);
    });
  });

  // ── complete_subagent engine signal ────────────────────────

  describe("complete_subagent signal", () => {
    it("breaks loop with goal_reached stopReason and stopPayload", async () => {
      const provider = makeProvider([
        { toolCalls: [{ id: "call-1", name: "subagent_report_complete", arguments: {} }] },
      ]);

      mockDispatchTool.mockResolvedValue({
        success: true,
        output: "Report submitted",
        engineSignal: {
          type: "complete_subagent",
          reason: "goal_reached",
          summary: "Research complete",
          evidence: { volume: 5000000 },
        },
      });

      const result = await runTurnLoop(
        makeContext({ isSubagent: true }),
        [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.stopReason).toBe("goal_reached");
      expect(result.stopPayload).toBeDefined();
      expect(result.stopPayload!.summary).toBe("Research complete");
    });
  });
});
