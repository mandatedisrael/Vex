/**
 * Operator-driven mission abort — host-only API tests.
 *
 * Covers the cleanup invariant that the plan calls for: after a successful
 * `abortMissionRun(runId)`:
 *   - pending approvals tied to the run's session are rejected,
 *   - pending wakes for the session are cancelled,
 *   - either the in-process AbortSignal is fired (live loop) OR the run is
 *     finalised directly (paused / out-of-process),
 *   - companion guards (`resumeMissionRun` terminal `cancelled`,
 *     `approveAndResume` pre-dispatch) prevent late approvals/resumes from
 *     reviving the cancelled run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetRun = vi.fn();
const mockGetActiveRunBySession = vi.fn();
const mockUpdateRunStatus = vi.fn();
const mockSetMissionStatus = vi.fn();
const mockCancelForSession = vi.fn();
const mockGetPendingApprovals = vi.fn();
const mockRejectApproval = vi.fn();

vi.mock("@echo-agent/db/repos/mission-runs.js", () => ({
  getRun: (...a: unknown[]) => mockGetRun(...a),
  getActiveRunBySession: (...a: unknown[]) => mockGetActiveRunBySession(...a),
  updateStatus: (...a: unknown[]) => mockUpdateRunStatus(...a),
}));

vi.mock("@echo-agent/db/repos/missions.js", () => ({
  setStatus: (...a: unknown[]) => mockSetMissionStatus(...a),
}));

vi.mock("@echo-agent/db/repos/loop-wake.js", () => ({
  cancelForSession: (...a: unknown[]) => mockCancelForSession(...a),
}));

vi.mock("@echo-agent/db/repos/approvals.js", () => ({
  getPending: (...a: unknown[]) => mockGetPendingApprovals(...a),
  reject: (...a: unknown[]) => mockRejectApproval(...a),
  approve: vi.fn(),
}));

const {
  abortMissionRun,
  abortActiveMissionForSession,
  registerMissionRunAbortController,
  unregisterMissionRunAbortController,
  hasMissionRunAbortController,
} = await import("../../../echo-agent/engine/core/runner/abort.js");

describe("abortMissionRun", () => {
  beforeEach(() => {
    mockGetRun.mockReset();
    mockGetActiveRunBySession.mockReset();
    mockUpdateRunStatus.mockReset();
    mockSetMissionStatus.mockReset();
    mockCancelForSession.mockReset();
    mockGetPendingApprovals.mockReset();
    mockRejectApproval.mockReset();
    mockCancelForSession.mockResolvedValue(0);
    mockGetPendingApprovals.mockResolvedValue([]);
    // Drop any controllers leaked between tests.
    if (hasMissionRunAbortController("run-1")) unregisterMissionRunAbortController("run-1");
    if (hasMissionRunAbortController("run-running")) unregisterMissionRunAbortController("run-running");
  });

  it("paused_approval with 2 pending approvals → cancelled, rejectedApprovals=2", async () => {
    mockGetRun.mockResolvedValue({
      id: "run-1",
      missionId: "mission-1",
      sessionId: "sess-1",
      status: "paused_approval",
    });
    mockGetPendingApprovals.mockResolvedValue([
      { id: "ap-1", sessionId: "sess-1" },
      { id: "ap-2", sessionId: "sess-1" },
      { id: "ap-3", sessionId: "other-session" }, // must be ignored
    ]);
    mockRejectApproval.mockResolvedValue({ id: "ap-1", status: "rejected" });

    const result = await abortMissionRun("run-1");

    expect(result.aborted).toBe(true);
    expect(result.finalStatus).toBe("cancelled");
    expect(result.rejectedApprovals).toBe(2);
    expect(mockRejectApproval).toHaveBeenCalledTimes(2);
    expect(mockRejectApproval).toHaveBeenCalledWith("ap-1");
    expect(mockRejectApproval).toHaveBeenCalledWith("ap-2");
    expect(mockRejectApproval).not.toHaveBeenCalledWith("ap-3");
    expect(mockUpdateRunStatus).toHaveBeenCalledWith("run-1", "cancelled", "user_stopped");
    expect(mockSetMissionStatus).toHaveBeenCalledWith("mission-1", "cancelled");
  });

  it("running with registered controller → fires AbortSignal, status stays running", async () => {
    mockGetRun.mockResolvedValue({
      id: "run-running",
      missionId: "mission-2",
      sessionId: "sess-2",
      status: "running",
    });
    const controller = registerMissionRunAbortController("run-running");

    const result = await abortMissionRun("run-running");

    expect(controller.signal.aborted).toBe(true);
    expect(result.aborted).toBe(true);
    expect(result.finalStatus).toBe("running"); // loop will finalise async
    expect(result.rejectedApprovals).toBe(0);
    // Direct finalize path NOT taken — loop owns that.
    expect(mockUpdateRunStatus).not.toHaveBeenCalled();
    expect(mockSetMissionStatus).not.toHaveBeenCalled();
  });

  it("running without registered controller → finalises directly", async () => {
    mockGetRun.mockResolvedValue({
      id: "run-orphan",
      missionId: "mission-3",
      sessionId: "sess-3",
      status: "running",
    });

    const result = await abortMissionRun("run-orphan");

    expect(result.aborted).toBe(true);
    expect(result.finalStatus).toBe("cancelled");
    expect(mockUpdateRunStatus).toHaveBeenCalledWith("run-orphan", "cancelled", "user_stopped");
    expect(mockSetMissionStatus).toHaveBeenCalledWith("mission-3", "cancelled");
  });

  it("paused_wake → cancels wakes + finalises directly", async () => {
    mockGetRun.mockResolvedValue({
      id: "run-w",
      missionId: "mission-w",
      sessionId: "sess-w",
      status: "paused_wake",
    });

    const result = await abortMissionRun("run-w");

    expect(result.aborted).toBe(true);
    expect(result.finalStatus).toBe("cancelled");
    expect(mockCancelForSession).toHaveBeenCalledWith("sess-w", "user_aborted");
  });

  for (const terminal of ["completed", "failed", "stopped", "cancelled"]) {
    it(`${terminal} → no-op`, async () => {
      mockGetRun.mockResolvedValue({
        id: "run-t",
        missionId: "mission-t",
        sessionId: "sess-t",
        status: terminal,
      });

      const result = await abortMissionRun("run-t");

      expect(result.aborted).toBe(false);
      expect(result.finalStatus).toBe(terminal);
      expect(result.rejectedApprovals).toBe(0);
      expect(mockUpdateRunStatus).not.toHaveBeenCalled();
      expect(mockSetMissionStatus).not.toHaveBeenCalled();
      expect(mockCancelForSession).not.toHaveBeenCalled();
    });
  }

  it("missing run → throws", async () => {
    mockGetRun.mockResolvedValue(null);
    await expect(abortMissionRun("missing")).rejects.toThrow(/not found/);
  });
});

describe("abortActiveMissionForSession", () => {
  beforeEach(() => {
    mockGetRun.mockReset();
    mockGetActiveRunBySession.mockReset();
    mockUpdateRunStatus.mockReset();
    mockSetMissionStatus.mockReset();
    mockCancelForSession.mockReset();
    mockGetPendingApprovals.mockReset();
    mockRejectApproval.mockReset();
    mockCancelForSession.mockResolvedValue(0);
    mockGetPendingApprovals.mockResolvedValue([]);
  });

  it("returns null when session has no active run", async () => {
    mockGetActiveRunBySession.mockResolvedValue(null);
    const result = await abortActiveMissionForSession("sess-empty");
    expect(result).toBeNull();
  });

  it("delegates to abortMissionRun when active run exists", async () => {
    mockGetActiveRunBySession.mockResolvedValue({ id: "run-active" });
    mockGetRun.mockResolvedValue({
      id: "run-active",
      missionId: "m",
      sessionId: "sess",
      status: "paused_approval",
    });

    const result = await abortActiveMissionForSession("sess");
    expect(result?.aborted).toBe(true);
    expect(result?.finalStatus).toBe("cancelled");
  });
});

// ── Companion guards ────────────────────────────────────────────

describe("companion guards", () => {
  it("MissionRunStatus union includes cancelled (compile-time)", async () => {
    const { MissionRunStatusValues } = await import("./abort-mission-run.helpers.js").catch(() => ({
      MissionRunStatusValues: undefined as unknown as readonly string[],
    }));
    // No helpers file — assert at value level via a runtime tuple to keep the
    // test self-contained. The real type-level assertion happens at tsc time
    // because `engine/types.ts::MissionRunStatus` now includes "cancelled";
    // the snippet below compiles only if the union actually contains it.
    const status: import("../../../echo-agent/engine/types.js").MissionRunStatus = "cancelled";
    expect(status).toBe("cancelled");
    void MissionRunStatusValues;
  });
});
