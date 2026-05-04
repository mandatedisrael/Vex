/**
 * PR-7 — ingress router unit tests. Covers the preempt-then-route matrix:
 *   - cancelForSession is ALWAYS called first,
 *   - paused_wake run → flip to running + save user msg + resumeMissionRun,
 *   - paused_approval / running run → persist interrupt, no new turn,
 *   - full_autonomous (no run) → stub falls through to processChatTurn (PR-10
 *     replaces this branch),
 *   - no run + active mission (draft) → processMissionSetupTurn,
 *   - no run + no mission → processChatTurn.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCancelForSession = vi.fn();
const mockGetActiveRunBySession = vi.fn();
const mockUpdateRunStatus = vi.fn();
const mockCasFlipToRunning = vi.fn();
const mockGetActiveFullAutonomousRunBySession = vi.fn();
const mockCasFullAutonomousToRunning = vi.fn();
const mockGetSession = vi.fn();
const mockGetActiveMission = vi.fn();
const mockAddMessage = vi.fn();
const mockAddEngineMessage = vi.fn();
const mockProcessChatTurn = vi.fn();
const mockProcessMissionSetupTurn = vi.fn();
const mockProcessFullAutonomousTurn = vi.fn();
const mockResumeMissionRun = vi.fn();

vi.mock("@vex-agent/db/repos/loop-wake.js", () => ({
  cancelForSession: (...a: unknown[]) => mockCancelForSession(...a),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getActiveRunBySession: (...a: unknown[]) => mockGetActiveRunBySession(...a),
  updateStatus: (...a: unknown[]) => mockUpdateRunStatus(...a),
  casFlipToRunning: (...a: unknown[]) => mockCasFlipToRunning(...a),
}));

vi.mock("@vex-agent/db/repos/full-autonomous-runs.js", () => ({
  getActiveRunBySession: (...a: unknown[]) => mockGetActiveFullAutonomousRunBySession(...a),
  casFlipToRunning: (...a: unknown[]) => mockCasFullAutonomousToRunning(...a),
}));

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  getSession: (...a: unknown[]) => mockGetSession(...a),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getActiveMission: (...a: unknown[]) => mockGetActiveMission(...a),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: (...a: unknown[]) => mockAddEngineMessage(...a),
}));

vi.mock("../../../vex-agent/engine/core/runner.js", () => ({
  processChatTurn: (...a: unknown[]) => mockProcessChatTurn(...a),
  processMissionSetupTurn: (...a: unknown[]) => mockProcessMissionSetupTurn(...a),
  processFullAutonomousTurn: (...a: unknown[]) => mockProcessFullAutonomousTurn(...a),
  resumeMissionRun: (...a: unknown[]) => mockResumeMissionRun(...a),
}));

const { routeUserMessage } = await import("../../../vex-agent/engine/ingress.js");

const chatResult = { text: "hi", toolCallsMade: 0, pendingApprovals: [], stopReason: null, missionStatus: null };
const setupResult = { ...chatResult, missionStatus: "draft" as const };
const resumeResult = { text: null, toolCallsMade: 2, pendingApprovals: [], stopReason: null, missionStatus: "running" as const };
const fullAutoResult = { text: "full-auto", toolCallsMade: 0, pendingApprovals: [], stopReason: null, missionStatus: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockCancelForSession.mockResolvedValue(0);
  mockProcessChatTurn.mockResolvedValue(chatResult);
  mockProcessMissionSetupTurn.mockResolvedValue(setupResult);
  mockProcessFullAutonomousTurn.mockResolvedValue(fullAutoResult);
  mockResumeMissionRun.mockResolvedValue(resumeResult);
  mockCasFlipToRunning.mockResolvedValue("paused_wake");
  mockGetActiveFullAutonomousRunBySession.mockResolvedValue(null);
  mockCasFullAutonomousToRunning.mockResolvedValue("paused_wake");
});

describe("ingress.routeUserMessage", () => {
  it("always cancels pending wakes before routing", async () => {
    mockGetActiveRunBySession.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ id: "s1", kind: "chat" });
    mockGetActiveMission.mockResolvedValue(null);

    await routeUserMessage("s1", "hello");

    expect(mockCancelForSession).toHaveBeenCalledWith("s1", "user_preempt");
    expect(mockCancelForSession).toHaveBeenCalledBefore(mockGetActiveRunBySession as never);
  });

  it("resumes a paused_wake mission run — flip status, save preempt msg, resume", async () => {
    mockGetActiveRunBySession.mockResolvedValue({ id: "run-1", status: "paused_wake" });

    const result = await routeUserMessage("s1", "can you pause?");

    expect(result).toBe(resumeResult);
    expect(mockCasFlipToRunning).toHaveBeenCalledWith("run-1", ["paused_wake"]);
    expect(mockAddMessage).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ role: "user", content: "can you pause?" }),
      expect.objectContaining({
        source: "user",
        messageType: "operator_interrupt",
        payload: expect.objectContaining({ preempt: "wake" }),
      }),
    );
    expect(mockAddEngineMessage).toHaveBeenCalled();
    expect(mockResumeMissionRun).toHaveBeenCalledWith("run-1");
    expect(mockProcessChatTurn).not.toHaveBeenCalled();
  });

  it("persists an interrupt (but does NOT fire a new turn) when the run is paused_approval", async () => {
    mockGetActiveRunBySession.mockResolvedValue({ id: "run-2", status: "paused_approval" });

    const result = await routeUserMessage("s1", "wait!");

    expect(result.text).toContain("queued");
    expect(result.toolCallsMade).toBe(0);
    expect(mockAddMessage).toHaveBeenCalled();
    expect(mockResumeMissionRun).not.toHaveBeenCalled();
    expect(mockProcessChatTurn).not.toHaveBeenCalled();
  });

  it("persists an interrupt when the run is still running", async () => {
    mockGetActiveRunBySession.mockResolvedValue({ id: "run-3", status: "running" });

    await routeUserMessage("s1", "FYI");

    expect(mockAddMessage).toHaveBeenCalled();
    expect(mockProcessChatTurn).not.toHaveBeenCalled();
  });

  it("returns a recovery hint instead of empty fallback for paused_error", async () => {
    mockGetActiveRunBySession.mockResolvedValue({ id: "run-4", status: "paused_error" });

    const result = await routeUserMessage("s1", "anything");

    expect(mockAddMessage).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ role: "user", content: "anything" }),
      expect.objectContaining({ source: "user", messageType: "operator_interrupt" }),
    );
    expect(result.text).toContain("/retry");
    expect(result.text).toContain("/rewind");
    expect(result.stopReason).toBeNull();
    expect(mockResumeMissionRun).not.toHaveBeenCalled();
    expect(mockProcessChatTurn).not.toHaveBeenCalled();
  });

  it("routes full_autonomous sessions to processFullAutonomousTurn", async () => {
    mockGetActiveRunBySession.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ id: "s1", kind: "full_autonomous" });
    mockGetActiveMission.mockResolvedValue(null);

    const result = await routeUserMessage("s1", "hello");

    expect(result).toBe(fullAutoResult);
    expect(mockProcessFullAutonomousTurn).toHaveBeenCalledWith("s1", "hello");
    expect(mockProcessChatTurn).not.toHaveBeenCalled();
  });

  it("routes to mission-setup when a draft mission exists and there is no run", async () => {
    mockGetActiveRunBySession.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ id: "s1", kind: "chat" });
    mockGetActiveMission.mockResolvedValue({ id: "m1", status: "draft" });

    const result = await routeUserMessage("s1", "goal is x");

    expect(result).toBe(setupResult);
    expect(mockProcessMissionSetupTurn).toHaveBeenCalledWith("s1", "goal is x");
  });

  it("routes to chat when no mission and no run exist", async () => {
    mockGetActiveRunBySession.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ id: "s1", kind: "chat" });
    mockGetActiveMission.mockResolvedValue(null);

    const result = await routeUserMessage("s1", "hi");

    expect(result).toBe(chatResult);
    expect(mockProcessChatTurn).toHaveBeenCalledWith("s1", "hi");
  });
});
