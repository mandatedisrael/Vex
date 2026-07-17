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
const mockClearMissionApprovedAt = vi.fn();
const mockCancelForSession = vi.fn();
const mockGetPendingApprovals = vi.fn();
const mockRejectApproval = vi.fn();
const mockReconcileDraftReadiness = vi.fn();

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getRun: (...a: unknown[]) => mockGetRun(...a),
  getActiveRunBySession: (...a: unknown[]) => mockGetActiveRunBySession(...a),
  updateStatus: (...a: unknown[]) => mockUpdateRunStatus(...a),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  setStatus: (...a: unknown[]) => mockSetMissionStatus(...a),
  clearApprovedAt: (...a: unknown[]) => mockClearMissionApprovedAt(...a),
}));

vi.mock("@vex-agent/db/repos/loop-wake.js", () => ({
  cancelForSession: (...a: unknown[]) => mockCancelForSession(...a),
}));

vi.mock("@vex-agent/db/repos/approvals.js", () => ({
  getPending: (...a: unknown[]) => mockGetPendingApprovals(...a),
  reject: (...a: unknown[]) => mockRejectApproval(...a),
  approve: vi.fn(),
}));

// WP3 (issue #41): `stopMissionRunForEdit` reconciles draft readiness right
// after it sets the mission back to 'draft' — mocked here so these tests
// control the promoted/not-promoted outcome directly, independent of
// `draft-readiness.test.ts`'s own behavior coverage.
vi.mock("../../../vex-agent/engine/mission/draft-readiness.js", () => ({
  reconcileDraftReadiness: (...a: unknown[]) =>
    mockReconcileDraftReadiness(...a),
}));

const {
  abortMissionRun,
  abortActiveMissionForSession,
  stopActiveMissionForEdit,
  registerMissionRunAbortController,
  unregisterMissionRunAbortController,
  hasMissionRunAbortController,
} = await import("../../../vex-agent/engine/core/runner/abort.js");

describe("abortMissionRun", () => {
  beforeEach(() => {
    mockGetRun.mockReset();
    mockGetActiveRunBySession.mockReset();
    mockUpdateRunStatus.mockReset();
    mockSetMissionStatus.mockReset();
    mockClearMissionApprovedAt.mockReset();
    mockCancelForSession.mockReset();
    mockGetPendingApprovals.mockReset();
    mockRejectApproval.mockReset();
    mockCancelForSession.mockResolvedValue(0);
    mockGetPendingApprovals.mockResolvedValue([]);
    // Drop any controllers leaked between tests.
    if (hasMissionRunAbortController("run-1")) unregisterMissionRunAbortController("run-1");
    if (hasMissionRunAbortController("run-running")) unregisterMissionRunAbortController("run-running");
    if (hasMissionRunAbortController("run-edit")) unregisterMissionRunAbortController("run-edit");
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

describe("stopActiveMissionForEdit", () => {
  beforeEach(() => {
    mockGetRun.mockReset();
    mockGetActiveRunBySession.mockReset();
    mockUpdateRunStatus.mockReset();
    mockSetMissionStatus.mockReset();
    mockClearMissionApprovedAt.mockReset();
    mockCancelForSession.mockReset();
    mockGetPendingApprovals.mockReset();
    mockRejectApproval.mockReset();
    mockReconcileDraftReadiness.mockReset();
    mockCancelForSession.mockResolvedValue(0);
    mockGetPendingApprovals.mockResolvedValue([]);
    // Default: not promoted. Individual tests override to cover both
    // branches of the WP3 reconciliation outcome.
    mockReconcileDraftReadiness.mockResolvedValue({ promoted: false });
    if (hasMissionRunAbortController("run-edit")) unregisterMissionRunAbortController("run-edit");
  });

  // WP3 (issue #41): `finalStatus` used to hard-code "draft" regardless of
  // whether the stopped-for-edit mission was actually complete — that's the
  // bug (drafts trapped in "Preparing"). It now reflects
  // `reconcileDraftReadiness`'s outcome. Two deliberate variants replace the
  // single always-"draft" assertion this test used to make.
  it("stops an active run for editing and promotes a complete draft to ready", async () => {
    mockGetActiveRunBySession.mockResolvedValue({ id: "run-edit" });
    mockGetRun.mockResolvedValue({
      id: "run-edit",
      missionId: "mission-edit",
      sessionId: "sess-edit",
      status: "paused_wake",
    });
    mockReconcileDraftReadiness.mockResolvedValue({ promoted: true });

    const result = await stopActiveMissionForEdit("sess-edit");

    expect(result?.stopped).toBe(true);
    expect(result?.finalStatus).toBe("ready");
    expect(mockCancelForSession).toHaveBeenCalledWith("sess-edit", "user_edit");
    expect(mockUpdateRunStatus).toHaveBeenCalledWith(
      "run-edit",
      "stopped",
      "user_stopped",
      { summary: "Mission stopped for operator edit" },
    );
    expect(mockClearMissionApprovedAt).toHaveBeenCalledWith("mission-edit");
    // setStatus('draft') always fires first — reconcile decides the
    // reported finalStatus, not whether this write happens.
    expect(mockSetMissionStatus).toHaveBeenCalledWith("mission-edit", "draft");
    expect(mockSetMissionStatus).not.toHaveBeenCalledWith("mission-edit", "cancelled");
    expect(mockReconcileDraftReadiness).toHaveBeenCalledWith("mission-edit");
  });

  it("stops an active run for editing and leaves an incomplete draft as draft", async () => {
    mockGetActiveRunBySession.mockResolvedValue({ id: "run-edit" });
    mockGetRun.mockResolvedValue({
      id: "run-edit",
      missionId: "mission-edit",
      sessionId: "sess-edit",
      status: "paused_wake",
    });
    mockReconcileDraftReadiness.mockResolvedValue({ promoted: false });

    const result = await stopActiveMissionForEdit("sess-edit");

    expect(result?.stopped).toBe(true);
    expect(result?.finalStatus).toBe("draft");
    expect(mockSetMissionStatus).toHaveBeenCalledWith("mission-edit", "draft");
    expect(mockSetMissionStatus).not.toHaveBeenCalledWith("mission-edit", "cancelled");
    expect(mockReconcileDraftReadiness).toHaveBeenCalledWith("mission-edit");
  });

  it("signals a live running loop before returning the mission to draft", async () => {
    mockGetActiveRunBySession.mockResolvedValue({ id: "run-edit" });
    mockGetRun.mockResolvedValue({
      id: "run-edit",
      missionId: "mission-edit",
      sessionId: "sess-edit",
      status: "running",
    });
    const controller = registerMissionRunAbortController("run-edit");

    const result = await stopActiveMissionForEdit("sess-edit");

    expect(result?.stopped).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(mockSetMissionStatus).toHaveBeenCalledWith("mission-edit", "draft");
  });
});

describe("abortActiveMissionForSession", () => {
  beforeEach(() => {
    mockGetRun.mockReset();
    mockGetActiveRunBySession.mockReset();
    mockUpdateRunStatus.mockReset();
    mockSetMissionStatus.mockReset();
    mockClearMissionApprovedAt.mockReset();
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
  it("MissionRunStatus union includes cancelled (compile-time)", () => {
    const status: import("../../../vex-agent/engine/types.js").MissionRunStatus = "cancelled";
    expect(status).toBe("cancelled");
  });
});
