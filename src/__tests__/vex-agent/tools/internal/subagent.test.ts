import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTestContext } from "../_test-context.js";

const mockInsert = vi.fn().mockResolvedValue(undefined);
const mockGetById = vi.fn().mockResolvedValue(null);
const mockGetActive = vi.fn().mockResolvedValue([]);
const mockGetRecent = vi.fn().mockResolvedValue([]);
const mockUpdateStatus = vi.fn().mockResolvedValue(undefined);

vi.mock("@vex-agent/db/repos/subagents.js", () => ({
  insert: (...args: unknown[]) => mockInsert(...args),
  getById: (...args: unknown[]) => mockGetById(...args),
  getActive: (...args: unknown[]) => mockGetActive(...args),
  getRecent: (...args: unknown[]) => mockGetRecent(...args),
  updateStatus: (...args: unknown[]) => mockUpdateStatus(...args),
}));

const mockCreateSession = vi.fn().mockResolvedValue(undefined);
const mockSetScope = vi.fn().mockResolvedValue(undefined);
const mockGetSessionForSubagent = vi.fn().mockResolvedValue(null);
const mockSetMemoryScopeKeyForSubagent = vi.fn().mockResolvedValue(undefined);

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  setScope: (...args: unknown[]) => mockSetScope(...args),
  getSession: (...args: unknown[]) => mockGetSessionForSubagent(...args),
  setMemoryScopeKey: (...args: unknown[]) => mockSetMemoryScopeKeyForSubagent(...args),
}));

const mockLinkSessions = vi.fn().mockResolvedValue({ id: 1 });
const mockGetSubagentSession = vi.fn().mockResolvedValue(null);
const mockGetParentSession = vi.fn().mockResolvedValue(null);

vi.mock("@vex-agent/db/repos/session-links.js", () => ({
  linkSessions: (...args: unknown[]) => mockLinkSessions(...args),
  getSubagentSession: (...args: unknown[]) => mockGetSubagentSession(...args),
  getParentSession: (...args: unknown[]) => mockGetParentSession(...args),
}));

vi.mock("@vex-agent/db/repos/subagent-messages.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(1),
  sendStructuredMessage: vi.fn().mockResolvedValue(1),
  getUnhandled: vi.fn().mockResolvedValue([]),
  getMessagesByType: vi.fn().mockResolvedValue([]),
  getMessagesByDirection: vi.fn().mockResolvedValue([]),
  markHandled: vi.fn().mockResolvedValue(undefined),
}));

// Mock engine subagent runner — returns immediately with result
vi.mock("@vex-agent/engine/subagents/runner.js", () => ({
  runSubagentEngine: vi.fn().mockResolvedValue({
    subagentId: "subagent-test",
    sessionId: "session-test",
    output: "Engine subagent completed",
    toolCallsMade: 0,
    success: true,
  }),
}));

const mockSendStructuredMessage = vi.mocked((await import("@vex-agent/db/repos/subagent-messages.js")).sendStructuredMessage);
const mockMarkHandled = vi.mocked((await import("@vex-agent/db/repos/subagent-messages.js")).markHandled);
const mockGetUnhandled = vi.mocked((await import("@vex-agent/db/repos/subagent-messages.js")).getUnhandled);
const mockGetMessagesByType = vi.mocked((await import("@vex-agent/db/repos/subagent-messages.js")).getMessagesByType);

const {
  handleSubagentSpawn,
  handleSubagentStatus,
  handleSubagentStop,
  handleSubagentReply,
  handleSubagentRequestParent,
  handleSubagentReportComplete,
} = await import(
  "../../../../vex-agent/tools/internal/subagent.js"
);

const baseContext = makeTestContext({
  sessionId: "test-session",
});

describe("subagent handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── subagent_spawn ────────────────────────────────────────────────

  describe("handleSubagentSpawn", () => {
    it("fails without name", async () => {
      const result = await handleSubagentSpawn({ task: "do something" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("name");
    });

    it("fails without task", async () => {
      const result = await handleSubagentSpawn({ name: "VexTest" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("task");
    });

    it("spawns subagent and returns id", async () => {
      const result = await handleSubagentSpawn(
        { name: "VexResearch", task: "research SOL ecosystem" },
        baseContext,
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.id).toMatch(/^subagent-/);
      expect(parsed.name).toBe("VexResearch");
      expect(parsed.allowTrades).toBe(false);
      expect(parsed.maxIterations).toBe(25);
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it("creates child session on spawn", async () => {
      await handleSubagentSpawn(
        { name: "VexSession", task: "test" },
        baseContext,
      );
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      const sessionId = mockCreateSession.mock.calls[0][0];
      expect(sessionId).toMatch(/^session-/);
    });

    it("sets child session scope to subagent", async () => {
      await handleSubagentSpawn(
        { name: "VexScope", task: "test" },
        baseContext,
      );
      expect(mockSetScope).toHaveBeenCalledTimes(1);
      expect(mockSetScope.mock.calls[0][1]).toBe("subagent");
    });

    it("creates session_links with correct parent, child, and subagentId", async () => {
      const result = await handleSubagentSpawn(
        { name: "VexLink", task: "test" },
        baseContext,
      );
      const parsed = JSON.parse(result.output);

      expect(mockLinkSessions).toHaveBeenCalledTimes(1);
      const [parentId, childId, relationType, subagentId] = mockLinkSessions.mock.calls[0];
      expect(parentId).toBe("test-session");
      expect(childId).toMatch(/^session-/);
      expect(relationType).toBe("subagent");
      expect(subagentId).toBe(parsed.id);
    });

    it("subagent finalizes via engine runner and does not stay zombie", async () => {
      await handleSubagentSpawn(
        { name: "VexFinalize", task: "test" },
        baseContext,
      );
      // runSubagent is async — give engine runner mock time to resolve
      await new Promise(r => setTimeout(r, 100));

      expect(mockUpdateStatus).toHaveBeenCalled();
      const completedCall = mockUpdateStatus.mock.calls.find(
        (c: unknown[]) => c[1] === "completed",
      );
      expect(completedCall).toBeTruthy();
    });

    it("respects allow_trades flag", async () => {
      const result = await handleSubagentSpawn(
        { name: "VexTrader", task: "trade SOL", allow_trades: true },
        baseContext,
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.allowTrades).toBe(true);
    });

    it("respects custom max_iterations", async () => {
      await handleSubagentSpawn(
        { name: "VexLong", task: "deep research", max_iterations: 50 },
        baseContext,
      );
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.maxIterations).toBe(50);
    });

    // ── scope_strategy resolution ────────────────────────────────────

    it("defaults memory scope to isolated (own childSessionId) when scope_strategy is omitted", async () => {
      const result = await handleSubagentSpawn(
        { name: "VexIsoDefault", task: "test" },
        baseContext,
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);

      // Child session id is unique per spawn; memory scope key must equal it.
      expect(mockSetMemoryScopeKeyForSubagent).toHaveBeenCalledTimes(1);
      const [childSessionId, scopeKey] = mockSetMemoryScopeKeyForSubagent.mock.calls[0];
      expect(childSessionId).toBe(parsed.sessionId);
      expect(scopeKey).toBe(parsed.sessionId);
      expect(parsed.scopeStrategy).toBe("isolated");
      // Parent session is not read in the isolated path.
      expect(mockGetSessionForSubagent).not.toHaveBeenCalled();
    });

    it("accepts explicit scope_strategy=isolated (same outcome as default)", async () => {
      const result = await handleSubagentSpawn(
        { name: "VexIsoExplicit", task: "test", scope_strategy: "isolated" },
        baseContext,
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      const [childSessionId, scopeKey] = mockSetMemoryScopeKeyForSubagent.mock.calls[0];
      expect(childSessionId).toBe(parsed.sessionId);
      expect(scopeKey).toBe(parsed.sessionId);
      expect(parsed.scopeStrategy).toBe("isolated");
    });

    it("inherits parent's memoryScopeKey when scope_strategy=shared", async () => {
      mockGetSessionForSubagent.mockResolvedValueOnce({
        id: "test-session",
        memoryScopeKey: "parent-scope-xyz",
      });
      const result = await handleSubagentSpawn(
        { name: "VexShared", task: "test", scope_strategy: "shared" },
        baseContext,
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);

      expect(mockGetSessionForSubagent).toHaveBeenCalledWith("test-session");
      const [childSessionId, scopeKey] = mockSetMemoryScopeKeyForSubagent.mock.calls[0];
      expect(childSessionId).toBe(parsed.sessionId);
      expect(scopeKey).toBe("parent-scope-xyz");
      expect(parsed.scopeStrategy).toBe("shared");
    });

    it("shared scope falls back to parent sessionId when parent has no memoryScopeKey", async () => {
      mockGetSessionForSubagent.mockResolvedValueOnce({
        id: "test-session",
        memoryScopeKey: null,
      });
      await handleSubagentSpawn(
        { name: "VexSharedFallback", task: "test", scope_strategy: "shared" },
        baseContext,
      );
      const [, scopeKey] = mockSetMemoryScopeKeyForSubagent.mock.calls[0];
      expect(scopeKey).toBe("test-session");
    });

    it("rejects invalid scope_strategy by falling back to isolated default", async () => {
      const result = await handleSubagentSpawn(
        { name: "VexBadScope", task: "test", scope_strategy: "garbage" },
        baseContext,
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.scopeStrategy).toBe("isolated");
      const [childSessionId, scopeKey] = mockSetMemoryScopeKeyForSubagent.mock.calls[0];
      expect(scopeKey).toBe(childSessionId);
    });

    it("rejects duplicate active name", async () => {
      await handleSubagentSpawn({ name: "VexDup", task: "first" }, baseContext);
      const result = await handleSubagentSpawn({ name: "VexDup", task: "second" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("already running");
    });
  });

  // ── subagent_status ───────────────────────────────────────────────

  describe("handleSubagentStatus", () => {
    it("returns message when no subagents", async () => {
      const result = await handleSubagentStatus({}, baseContext);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.message).toContain("No active");
    });

    it("returns specific subagent by id (with ownership)", async () => {
      mockGetById.mockResolvedValueOnce({
        id: "subagent-123", name: "VexTest", task: "test", status: "running",
        allowTrades: false, startedAt: new Date().toISOString(), endedAt: null,
        result: null, error: null, tokenCost: 0, iterations: 5, maxIterations: 25,
      });
      mockGetSubagentSession.mockResolvedValueOnce({
        parentSessionId: "test-session", childSessionId: "child-session", subagentId: "subagent-123",
      });

      const result = await handleSubagentStatus({ id: "subagent-123" }, baseContext);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.id).toBe("subagent-123");
    });

    it("merges active and recent deduped", async () => {
      mockGetActive.mockResolvedValueOnce([
        { id: "sub-1", name: "A", task: "t", status: "running", allowTrades: false, startedAt: new Date().toISOString(), endedAt: null, result: null, error: null, tokenCost: 0, iterations: 3, maxIterations: 25 },
      ]);
      mockGetRecent.mockResolvedValueOnce([
        { id: "sub-1", name: "A", task: "t", status: "running", allowTrades: false, startedAt: new Date().toISOString(), endedAt: null, result: null, error: null, tokenCost: 0, iterations: 3, maxIterations: 25 },
        { id: "sub-2", name: "B", task: "t2", status: "completed", allowTrades: false, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), result: "ok", error: null, tokenCost: 0, iterations: 10, maxIterations: 25 },
      ]);

      const result = await handleSubagentStatus({}, baseContext);
      const parsed = JSON.parse(result.output);
      expect(parsed.count).toBe(2);
    });
  });

  // ── subagent_stop ─────────────────────────────────────────────────

  describe("handleSubagentStop", () => {
    it("fails without id", async () => {
      const result = await handleSubagentStop({}, baseContext);
      expect(result.success).toBe(false);
    });

    it("stops and updates status (with ownership)", async () => {
      mockGetById.mockResolvedValueOnce({
        id: "subagent-123", name: "VexStop", task: "test", status: "running",
        allowTrades: false, startedAt: new Date().toISOString(), endedAt: null,
        result: null, error: null, tokenCost: 0, iterations: 0, maxIterations: 25,
      });
      mockGetSubagentSession.mockResolvedValueOnce({
        parentSessionId: "test-session", childSessionId: "child-session", subagentId: "subagent-123",
      });

      const result = await handleSubagentStop({ id: "subagent-123" }, baseContext);
      expect(result.success).toBe(true);
      expect(mockUpdateStatus).toHaveBeenCalledWith("subagent-123", "stopped");
    });

    it("rejects stop when not owned by this session", async () => {
      mockGetById.mockResolvedValueOnce({
        id: "subagent-other", name: "VexOther", task: "test", status: "running",
        allowTrades: false, startedAt: new Date().toISOString(), endedAt: null,
        result: null, error: null, tokenCost: 0, iterations: 0, maxIterations: 25,
      });
      mockGetSubagentSession.mockResolvedValueOnce({
        parentSessionId: "different-session", childSessionId: "child", subagentId: "subagent-other",
      });

      const result = await handleSubagentStop({ id: "subagent-other" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("not owned");
    });
  });

  // ── subagent_request_parent ──────────────────────────────────────

  describe("handleSubagentRequestParent", () => {
    const childContext = { ...baseContext, sessionId: "child-session", role: "subagent" as const };

    it("fails without question", async () => {
      const result = await handleSubagentRequestParent({}, childContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("question");
    });

    it("fails if not a subagent session", async () => {
      mockGetParentSession.mockResolvedValueOnce(null);
      const result = await handleSubagentRequestParent({ question: "help?" }, childContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("Not a subagent session");
    });

    it("sends structured message and returns wait_for_parent signal", async () => {
      mockGetParentSession.mockResolvedValueOnce({ parentSessionId: "parent-s", subagentId: "sub-1" });

      const result = await handleSubagentRequestParent(
        { question: "Which venue should handle this swap?" },
        childContext,
      );

      expect(result.success).toBe(true);
      expect(result.engineSignal).toBeDefined();
      expect(result.engineSignal!.type).toBe("wait_for_parent");
      expect(result.engineSignal!.reason).toBe("waiting_for_parent");
      expect(mockSendStructuredMessage).toHaveBeenCalledWith(
        "sub-1", "to_parent", "Which venue should handle this swap?", "request_parent",
        expect.objectContaining({ question: "Which venue should handle this swap?" }),
      );
      expect(mockUpdateStatus).toHaveBeenCalledWith("sub-1", "waiting_for_parent");
    });
  });

  // ── subagent_reply ───────────────────────────────────────────────

  describe("handleSubagentReply", () => {
    it("fails without id or reply", async () => {
      const r1 = await handleSubagentReply({ reply: "answer" }, baseContext);
      expect(r1.success).toBe(false);
      const r2 = await handleSubagentReply({ id: "sub-1" }, baseContext);
      expect(r2.success).toBe(false);
    });

    it("rejects if subagent is not waiting_for_parent", async () => {
      mockGetById.mockResolvedValueOnce({
        id: "sub-1", name: "E", task: "t", status: "running",
        allowTrades: false, startedAt: new Date().toISOString(), endedAt: null,
        result: null, error: null, tokenCost: 0, iterations: 0, maxIterations: 25,
      });
      mockGetSubagentSession.mockResolvedValueOnce({
        parentSessionId: "test-session", childSessionId: "child", subagentId: "sub-1",
      });

      const result = await handleSubagentReply({ id: "sub-1", reply: "answer" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("not waiting for parent");
    });

    it("sends reply, marks handled, resumes subagent", async () => {
      mockGetById.mockResolvedValueOnce({
        id: "sub-1", name: "VexWait", task: "t", status: "waiting_for_parent",
        allowTrades: false, startedAt: new Date().toISOString(), endedAt: null,
        result: null, error: null, tokenCost: 0, iterations: 0, maxIterations: 25,
      });
      mockGetSubagentSession.mockResolvedValueOnce({
        parentSessionId: "test-session", childSessionId: "child", subagentId: "sub-1",
      });

      const result = await handleSubagentReply(
        { id: "sub-1", reply: "Use KyberSwap", message_id: 42 },
        baseContext,
      );

      expect(result.success).toBe(true);
      expect(mockSendStructuredMessage).toHaveBeenCalledWith(
        "sub-1", "to_child", "Use KyberSwap", "reply",
        expect.objectContaining({ reply: "Use KyberSwap" }),
        42,
      );
      expect(mockMarkHandled).toHaveBeenCalledWith(42);
      expect(mockUpdateStatus).toHaveBeenCalledWith("sub-1", "running");
    });

    it("rejects when not owned by this session", async () => {
      mockGetById.mockResolvedValueOnce({
        id: "sub-other", name: "E", task: "t", status: "waiting_for_parent",
        allowTrades: false, startedAt: new Date().toISOString(), endedAt: null,
        result: null, error: null, tokenCost: 0, iterations: 0, maxIterations: 25,
      });
      mockGetSubagentSession.mockResolvedValueOnce({
        parentSessionId: "different-session", childSessionId: "child", subagentId: "sub-other",
      });

      const result = await handleSubagentReply({ id: "sub-other", reply: "hi" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("not owned");
    });
  });

  // ── subagent_report_complete ─────────────────────────────────────

  describe("handleSubagentReportComplete", () => {
    const childContext = { ...baseContext, sessionId: "child-session", role: "subagent" as const };

    it("fails without summary", async () => {
      const result = await handleSubagentReportComplete({}, childContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("summary");
    });

    it("fails if not a subagent session", async () => {
      mockGetParentSession.mockResolvedValueOnce(null);
      const result = await handleSubagentReportComplete({ summary: "done" }, childContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("Not a subagent session");
    });

    it("saves report then returns complete_subagent signal", async () => {
      mockGetParentSession.mockResolvedValueOnce({ parentSessionId: "parent-s", subagentId: "sub-1" });

      const result = await handleSubagentReportComplete(
        { summary: "SOL liquidity is $5M", findings: { volume: 5000000 } },
        childContext,
      );

      expect(result.success).toBe(true);
      expect(result.engineSignal).toBeDefined();
      expect(result.engineSignal!.type).toBe("complete_subagent");
      expect(result.engineSignal!.reason).toBe("goal_reached");

      // Report saved BEFORE signal returned
      expect(mockSendStructuredMessage).toHaveBeenCalledWith(
        "sub-1", "to_parent", "SOL liquidity is $5M", "report_complete",
        expect.objectContaining({ summary: "SOL liquidity is $5M", findings: { volume: 5000000 } }),
      );
    });
  });

  // ── subagent_status enrichment ───────────────────────────────────

  describe("handleSubagentStatus enrichment", () => {
    it("includes pendingRequest for waiting_for_parent subagent", async () => {
      mockGetById.mockResolvedValueOnce({
        id: "sub-wait", name: "VexWait", task: "t", status: "waiting_for_parent",
        allowTrades: false, startedAt: new Date().toISOString(), endedAt: null,
        result: null, error: null, tokenCost: 0, iterations: 3, maxIterations: 25,
      });
      mockGetSubagentSession.mockResolvedValueOnce({
        parentSessionId: "test-session", childSessionId: "child", subagentId: "sub-wait",
      });
      mockGetUnhandled.mockResolvedValueOnce([{
        id: 42, subagentId: "sub-wait", direction: "to_parent", content: "Which DEX?",
        messageType: "request_parent", payloadJson: { question: "Which DEX?" },
        replyToMessageId: null, handledAt: null, createdAt: "2026-03-30T10:00:00Z",
      }]);

      const result = await handleSubagentStatus({ id: "sub-wait" }, baseContext);
      const parsed = JSON.parse(result.output);
      expect(parsed.pendingRequest).toBeDefined();
      expect(parsed.pendingRequest.messageId).toBe(42);
      expect(parsed.pendingRequest.question).toBe("Which DEX?");
    });

    it("includes report for completed subagent", async () => {
      mockGetById.mockResolvedValueOnce({
        id: "sub-done", name: "VexDone", task: "t", status: "completed",
        allowTrades: false, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
        result: "ok", error: null, tokenCost: 0, iterations: 5, maxIterations: 25,
      });
      mockGetSubagentSession.mockResolvedValueOnce({
        parentSessionId: "test-session", childSessionId: "child", subagentId: "sub-done",
      });
      mockGetMessagesByType.mockResolvedValueOnce([{
        id: 99, subagentId: "sub-done", direction: "to_parent", content: "Research complete",
        messageType: "report_complete", payloadJson: { summary: "Research complete", findings: { x: 1 } },
        replyToMessageId: null, handledAt: null, createdAt: "2026-03-30T10:00:00Z",
      }]);

      const result = await handleSubagentStatus({ id: "sub-done" }, baseContext);
      const parsed = JSON.parse(result.output);
      expect(parsed.report).toBeDefined();
      expect(parsed.report.summary).toBe("Research complete");
    });
  });
});
