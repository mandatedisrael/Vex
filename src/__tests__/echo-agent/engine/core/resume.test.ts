import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockApprove = vi.fn();
const mockDispatchTool = vi.fn();
const mockAddMessage = vi.fn();
const mockUpdateRunStatus = vi.fn();
const mockHydrate = vi.fn();
const mockResumeMissionRun = vi.fn();

vi.mock("@echo-agent/db/repos/approvals.js", () => ({
  approve: (...a: unknown[]) => mockApprove(...a),
}));

vi.mock("@echo-agent/tools/dispatcher.js", () => ({
  dispatchTool: (...a: unknown[]) => mockDispatchTool(...a),
}));

vi.mock("@echo-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: vi.fn(),
  getLiveMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("@echo-agent/db/repos/mission-runs.js", () => ({
  updateStatus: (...a: unknown[]) => mockUpdateRunStatus(...a),
  getRunBySession: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../../echo-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: (...a: unknown[]) => mockHydrate(...a),
}));

// Mock runner — lazy imported by resume.ts for re-entering loop
vi.mock("../../../../echo-agent/engine/core/runner.js", () => ({
  resumeMissionRun: (...a: unknown[]) => mockResumeMissionRun(...a),
}));

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  getSession: vi.fn(),
  updateTokenCount: vi.fn(),
}));

vi.mock("@echo-agent/db/repos/missions.js", () => ({
  getMissionBySession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@echo-agent/db/repos/session-links.js", () => ({
  getParentSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const { approveAndResume } = await import("../../../../echo-agent/engine/core/resume.js");

describe("resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResumeMissionRun.mockResolvedValue({
      text: "Resumed execution", toolCallsMade: 3, pendingApprovals: [],
      stopReason: null, missionStatus: "running",
    });
  });

  describe("approveAndResume", () => {
    it("throws if approval not found", async () => {
      mockApprove.mockResolvedValueOnce(null);
      await expect(approveAndResume("nonexistent")).rejects.toThrow("not found");
    });

    it("throws if approval has no session", async () => {
      mockApprove.mockResolvedValueOnce({
        id: "approval-1",
        toolCall: { command: "execute_tool", args: {} },
        sessionId: null,
        toolCallId: "call-1",
        chatMode: "restricted",
        pendingContext: null,
      });
      await expect(approveAndResume("approval-1")).rejects.toThrow("no associated session");
    });

    it("dispatches approved tool, saves result, and re-enters loop", async () => {
      mockApprove.mockResolvedValueOnce({
        id: "approval-1",
        toolCall: { command: "execute_tool", args: { toolId: "solana.swap" } },
        sessionId: "session-1",
        toolCallId: "call-1",
        chatMode: "restricted",
        pendingContext: { toolCallId: "call-1" },
      });
      mockDispatchTool.mockResolvedValueOnce({ success: true, output: "Swap completed" });
      mockHydrate.mockResolvedValueOnce({
        context: { sessionId: "session-1", missionRunId: "run-1" },
      });

      const result = await approveAndResume("approval-1");

      // Dispatched with approved=true
      const [, toolContext] = mockDispatchTool.mock.calls[0];
      expect(toolContext.approved).toBe(true);

      // Tool result saved
      expect(mockAddMessage).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({ role: "tool", toolCallId: "call-1" }),
        expect.objectContaining({ source: "tool" }),
      );

      // Run status set to running
      expect(mockUpdateRunStatus).toHaveBeenCalledWith("run-1", "running");

      // Re-entered loop via resumeMissionRun
      expect(mockResumeMissionRun).toHaveBeenCalledWith("run-1");

      // Returns TurnResult from resumed loop
      expect(result.text).toBe("Resumed execution");
      expect(result.missionStatus).toBe("running");
    });

    it("returns tool result as chat response when no mission", async () => {
      mockApprove.mockResolvedValueOnce({
        id: "approval-1",
        toolCall: { command: "execute_tool", args: {} },
        sessionId: "session-1",
        toolCallId: "call-1",
        chatMode: "restricted",
        pendingContext: null,
      });
      mockDispatchTool.mockResolvedValueOnce({ success: true, output: "Tool OK" });
      mockHydrate.mockResolvedValueOnce({
        context: { sessionId: "session-1", missionRunId: null },
      });

      const result = await approveAndResume("approval-1");

      expect(mockUpdateRunStatus).not.toHaveBeenCalled();
      expect(mockResumeMissionRun).not.toHaveBeenCalled();
      expect(result.text).toBe("Tool OK");
      expect(result.toolCallsMade).toBe(1);
    });

    it("saves tool result with visibility internal (not user)", async () => {
      mockApprove.mockResolvedValueOnce({
        id: "approval-1",
        toolCall: { command: "execute_tool", args: { toolId: "solana.swap" } },
        sessionId: "session-1",
        toolCallId: "call-1",
        chatMode: "restricted",
        pendingContext: null,
      });
      mockDispatchTool.mockResolvedValueOnce({ success: true, output: "Swap completed" });
      mockHydrate.mockResolvedValueOnce({
        context: { sessionId: "session-1", missionRunId: null },
      });

      await approveAndResume("approval-1");

      const [, , metadata] = mockAddMessage.mock.calls[0];
      expect(metadata.visibility).toBe("internal");
    });

    it("extracts toolCallId from pendingContext when column is null", async () => {
      mockApprove.mockResolvedValueOnce({
        id: "approval-1",
        toolCall: { command: "execute_tool", args: { toolId: "khalani.bridge" } },
        sessionId: "session-1",
        toolCallId: null,
        chatMode: "restricted",
        pendingContext: { toolCallId: "call-from-context" },
      });
      mockDispatchTool.mockResolvedValueOnce({ success: true, output: "Bridged" });
      mockHydrate.mockResolvedValueOnce({
        context: { sessionId: "session-1", missionRunId: null },
      });

      await approveAndResume("approval-1");

      const [toolCallRequest] = mockDispatchTool.mock.calls[0];
      expect(toolCallRequest.toolCallId).toBe("call-from-context");
    });
  });
});
