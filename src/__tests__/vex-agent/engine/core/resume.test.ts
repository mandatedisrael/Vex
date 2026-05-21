import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockApprove = vi.fn();
const mockDispatchTool = vi.fn();
const mockAddMessage = vi.fn();
const mockUpdateRunStatus = vi.fn();
const mockHydrate = vi.fn();
const mockResumeMissionRun = vi.fn();
const mockRefreshBlobTtl = vi.fn();

vi.mock("@vex-agent/db/repos/approvals.js", () => ({
  approve: (...a: unknown[]) => mockApprove(...a),
}));

vi.mock("@vex-agent/tools/dispatcher.js", () => ({
  dispatchTool: (...a: unknown[]) => mockDispatchTool(...a),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: vi.fn(),
  addMessageReturningId: vi.fn().mockResolvedValue({
    id: 1, role: "assistant", content: "", timestamp: new Date().toISOString(),
  }),
  getLiveMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("@vex-agent/engine/events/index.js", () => ({
  appendMessage: (...a: unknown[]) => mockAddMessage(...a),
  appendEngineMessage: vi.fn(),
  emitTranscriptAppend: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  updateStatus: (...a: unknown[]) => mockUpdateRunStatus(...a),
  // Used by the defensive abort guard in `approveAndResume`. Default null
  // means "no run for the session", so happy-path tests skip the guard.
  getRunBySession: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../../vex-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: (...a: unknown[]) => mockHydrate(...a),
}));

// Mock runner — lazy imported by resume.ts for re-entering loop
vi.mock("../../../../vex-agent/engine/core/runner.js", () => ({
  resumeMissionRun: (...a: unknown[]) => mockResumeMissionRun(...a),
}));

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  getSession: vi.fn(),
  updateTokenCount: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMissionBySession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vex-agent/db/repos/session-links.js", () => ({
  getParentSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vex-agent/engine/wake/blob-refresh.js", () => ({
  refreshBlobTtlForRecentMessages: (...a: unknown[]) => mockRefreshBlobTtl(...a),
}));

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  getPool: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  }),
  queryWith: vi.fn().mockResolvedValue([]),
  queryOneWith: vi.fn().mockImplementation(async (_exec: unknown, sql: string) => {
    if (typeof sql === "string" && sql.includes("INSERT INTO messages") && sql.includes("RETURNING id, created_at")) {
      return { id: 1, created_at: new Date().toISOString() };
    }
    return null;
  }),
  executeWith: vi.fn().mockResolvedValue(1),
  withTransaction: vi.fn().mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => {
    const stubClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    return await fn(stubClient);
  }),
}));

vi.mock("@vex-agent/engine/runtime/lease-and-status.js", () => ({
  claimRunLeaseAndFlipToRunning: vi.fn().mockResolvedValue({
    outcome: "claimed", previousStatus: "paused_wake",
    lease: { sessionId: "s", missionRunId: "r", ownerId: "test-owner", processKind: "electron_main", acquiredAt: new Date(), heartbeatAt: new Date(), expiresAt: new Date() },
    wakeCancelledCount: 0,
  }),
  claimSessionLease: vi.fn().mockResolvedValue({
    outcome: "claimed",
    lease: { sessionId: "s", missionRunId: null, ownerId: "test-owner", processKind: "electron_main", acquiredAt: new Date(), heartbeatAt: new Date(), expiresAt: new Date() },
  }),
  observeAndApplyControl: vi.fn().mockResolvedValue({ outcome: "no_request" }),
}));

vi.mock("@vex-agent/engine/runtime/lease-handle.js", () => ({
  createLeaseHandle: vi.fn().mockReturnValue({
    lease: { sessionId: "s", missionRunId: null, ownerId: "test-owner", processKind: "electron_main", acquiredAt: new Date(), heartbeatAt: new Date(), expiresAt: new Date() },
    ownerId: "test-owner",
    release: vi.fn().mockResolvedValue(undefined),
    onLeaseLost: vi.fn(),
  }),
}));

vi.mock("@vex-agent/engine/runtime/release-and-emit.js", () => ({
  releaseLeaseAndEmitControlState: vi.fn().mockResolvedValue(undefined),
}));

const { approveAndResume } = await import("../../../../vex-agent/engine/core/resume.js");

describe("resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshBlobTtl.mockResolvedValue(0);
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
        permissionAtEnqueue: "restricted",
        pendingContext: null,
      });
      await expect(approveAndResume("approval-1")).rejects.toThrow("no associated session");
    });

    it("rejects approval when terminal run ended after approval was created (abort race)", async () => {
      const missionRunsModule = await import("@vex-agent/db/repos/mission-runs.js");
      vi.mocked(missionRunsModule.getRunBySession).mockResolvedValueOnce({
        id: "run-cancelled",
        status: "cancelled",
        endedAt: "2026-05-04T13:30:00Z",
      } as never);

      mockApprove.mockResolvedValueOnce({
        id: "approval-late",
        toolCall: { command: "execute_tool", args: { toolId: "solana.swap" } },
        sessionId: "session-1",
        toolCallId: "call-late",
        permissionAtEnqueue: "restricted",
        pendingContext: null,
        // Approval queued before the abort terminated the run.
        createdAt: "2026-05-04T13:00:00Z",
      });

      await expect(approveAndResume("approval-late")).rejects.toThrow(/cancelled/);
      expect(mockDispatchTool).not.toHaveBeenCalled();
    });

    it("allows approval when terminal mission run ended before approval was created", async () => {
      // Old mission run finalised cleanly long ago; later, an unrelated chat
      // approval lands on the same session. The guard must not fire — that
      // race window only exists when `run.endedAt > approval.createdAt`.
      const missionRunsModule = await import("@vex-agent/db/repos/mission-runs.js");
      vi.mocked(missionRunsModule.getRunBySession).mockResolvedValueOnce({
        id: "run-old",
        status: "completed",
        endedAt: "2026-01-01T00:00:00Z",
      } as never);

      mockApprove.mockResolvedValueOnce({
        id: "approval-chat",
        toolCall: { command: "execute_tool", args: { toolId: "chat.tool" } },
        sessionId: "session-1",
        toolCallId: "call-chat",
        permissionAtEnqueue: "restricted",
        pendingContext: null,
        createdAt: "2026-05-04T13:00:00Z",
      });
      mockDispatchTool.mockResolvedValueOnce({ success: true, output: "Chat tool OK" });
      mockHydrate.mockResolvedValueOnce({
        context: { sessionId: "session-1", missionRunId: null },
      });

      const result = await approveAndResume("approval-chat");

      expect(mockDispatchTool).toHaveBeenCalledTimes(1);
      expect(result.text).toBe("Chat tool OK");
    });

    it("dispatches approved tool, saves result, and re-enters loop", async () => {
      mockApprove.mockResolvedValueOnce({
        id: "approval-1",
        toolCall: { command: "execute_tool", args: { toolId: "solana.swap" } },
        sessionId: "session-1",
        toolCallId: "call-1",
        permissionAtEnqueue: "restricted",
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
      expect(toolContext.sourceSurface).toBe("vex_agent");
      expect(toolContext.sourceSession).toBe("session-1");

      // Tool result saved
      expect(mockAddMessage).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({ role: "tool", toolCallId: "call-1" }),
        expect.objectContaining({ source: "tool" }),
      );

      // Run status set to running via atomic claim helper (puzzle 3 — replaces
      // the legacy `updateStatus(runId, "running")` with the lease+CAS combo).
      const lease = await import("@vex-agent/engine/runtime/lease-and-status.js");
      expect(lease.claimRunLeaseAndFlipToRunning).toHaveBeenCalledWith(
        expect.objectContaining({
          missionRunId: "run-1",
          fromStatuses: ["paused_approval", "running"],
        }),
      );

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
        permissionAtEnqueue: "restricted",
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
        permissionAtEnqueue: "restricted",
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

    it("refreshes blob TTLs before dispatching the approved tool (G-1)", async () => {
      mockApprove.mockResolvedValueOnce({
        id: "approval-1",
        toolCall: { command: "execute_tool", args: {} },
        sessionId: "session-1",
        toolCallId: "call-1",
        permissionAtEnqueue: "restricted",
        pendingContext: null,
      });
      mockDispatchTool.mockResolvedValueOnce({ success: true, output: "ok" });
      mockHydrate.mockResolvedValueOnce({
        context: { sessionId: "session-1", missionRunId: null },
      });

      await approveAndResume("approval-1");

      expect(mockRefreshBlobTtl).toHaveBeenCalledWith("session-1");
      const refreshOrder = mockRefreshBlobTtl.mock.invocationCallOrder[0]!;
      const dispatchOrder = mockDispatchTool.mock.invocationCallOrder[0]!;
      expect(refreshOrder).toBeLessThan(dispatchOrder);
    });

    it("extracts toolCallId from pendingContext when column is null", async () => {
      mockApprove.mockResolvedValueOnce({
        id: "approval-1",
        toolCall: { command: "execute_tool", args: { toolId: "khalani.bridge" } },
        sessionId: "session-1",
        toolCallId: null,
        permissionAtEnqueue: "restricted",
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
