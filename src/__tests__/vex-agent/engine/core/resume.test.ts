/**
 * `approveAndResume` back-compat wrapper — focused on the wrapper semantics
 * over the new puzzle-5 phase-3 `prepareApprove` + `runResumeAfterDecision`
 * pair. Detailed snapshot/CAS/dispatch coverage lives in
 * `approval-runtime.test.ts`; this file pins:
 *
 *   - dispatched + missionRun continuation  → awaits runResumeAfterDecision
 *   - dispatched + no missionRun            → synthesises TurnResult from
 *                                             toolResult.output
 *   - cached_approved                       → synthesises "already resolved"
 *   - expired                               → consumes autoRejection
 *                                             continuation then throws
 *   - already_rejected                      → throws
 *   - run_terminated                        → throws
 *   - ApprovalDispatchError propagates      → re-thrown intact
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrepareApprove = vi.fn();
const mockRunResumeAfterDecision = vi.fn();
const mockDiscardContinuation = vi.fn();

class FakeApprovalDispatchError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly errorKind: string,
    public readonly errorHash: string,
  ) {
    super(`Tool dispatch failed after approval (${approvalId})`);
    this.name = "ApprovalDispatchError";
  }
}

class FakeApprovalDecisionInconsistencyError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly detail: string,
  ) {
    super(`Approval ${approvalId} inconsistency: ${detail}`);
    this.name = "ApprovalDecisionInconsistencyError";
  }
}

vi.mock("@vex-agent/engine/core/approval-runtime.js", () => ({
  prepareApprove: (...a: unknown[]) => mockPrepareApprove(...a),
  runResumeAfterDecision: (...a: unknown[]) =>
    mockRunResumeAfterDecision(...a),
  discardContinuation: (...a: unknown[]) => mockDiscardContinuation(...a),
  ApprovalDispatchError: FakeApprovalDispatchError,
  ApprovalDecisionInconsistencyError: FakeApprovalDecisionInconsistencyError,
}));

vi.mock("@utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { approveAndResume } = await import(
  "../../../../vex-agent/engine/core/resume.js"
);

const STUB_CONTINUATION = {
  missionRunId: "run-1",
  sessionId: "session-1",
  ownerId: "approve-test",
  leaseHandle: { lease: {}, ownerId: "approve-test", release: vi.fn() },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockRunResumeAfterDecision.mockResolvedValue({
    text: "Resumed",
    toolCallsMade: 3,
    pendingApprovals: [],
    stopReason: null,
    missionStatus: "running",
  });
});

describe("approveAndResume back-compat wrapper", () => {
  it("dispatched + continuation → awaits runResumeAfterDecision and returns its TurnResult", async () => {
    mockPrepareApprove.mockResolvedValueOnce({
      kind: "dispatched",
      approvalId: "a-1",
      resolvedAt: "2026-05-23T20:00:00.000Z",
      executionStatus: "succeeded",
      sessionId: "session-1",
      missionRunId: "run-1",
      continuation: STUB_CONTINUATION,
      toolResult: { success: true, output: "tool ran" },
    });

    const result = await approveAndResume("a-1");

    expect(mockRunResumeAfterDecision).toHaveBeenCalledWith(STUB_CONTINUATION);
    expect(result.text).toBe("Resumed");
    expect(result.missionStatus).toBe("running");
    expect(result.toolCallsMade).toBe(3);
  });

  it("dispatched + no missionRun → synthesises TurnResult from toolResult.output", async () => {
    mockPrepareApprove.mockResolvedValueOnce({
      kind: "dispatched",
      approvalId: "a-2",
      resolvedAt: "2026-05-23T20:01:00.000Z",
      executionStatus: "succeeded",
      sessionId: "session-1",
      missionRunId: null,
      continuation: null,
      toolResult: { success: true, output: "chat tool output" },
    });

    const result = await approveAndResume("a-2");

    expect(mockRunResumeAfterDecision).not.toHaveBeenCalled();
    expect(result.text).toBe("chat tool output");
    expect(result.toolCallsMade).toBe(1);
    expect(result.missionStatus).toBeNull();
  });

  it("cached_approved → no dispatch, synthesises 'already resolved' TurnResult", async () => {
    mockPrepareApprove.mockResolvedValueOnce({
      kind: "cached_approved",
      approvalId: "a-3",
      resolvedAt: "2026-05-23T20:02:00.000Z",
      executionStatus: "succeeded",
      missionRunId: "run-1",
    });

    const result = await approveAndResume("a-3");

    expect(mockRunResumeAfterDecision).not.toHaveBeenCalled();
    expect(result.toolCallsMade).toBe(0);
    expect(result.text).toContain("already resolved");
    expect(result.text).toContain("executionStatus=succeeded");
  });

  it("expired → consumes autoRejection.continuation then throws (back-compat semantics)", async () => {
    mockPrepareApprove.mockResolvedValueOnce({
      kind: "expired",
      approvalId: "a-4",
      expiresAt: "2026-05-23T19:30:00.000Z",
      autoRejection: {
        kind: "rejected",
        approvalId: "a-4",
        resolvedAt: "2026-05-23T20:03:00.000Z",
        sessionId: "session-1",
        missionRunId: "run-1",
        reason: "expired_ttl",
        continuation: STUB_CONTINUATION,
      },
    });

    await expect(approveAndResume("a-4")).rejects.toThrow(/expired/);
    // Continuation MUST be consumed (else lease leaks); wrapper awaits
    // runResumeAfterDecision before throwing.
    expect(mockRunResumeAfterDecision).toHaveBeenCalledWith(STUB_CONTINUATION);
  });

  it("policy_drift_blocked (B-001) → consumes continuation then throws; NO re-dispatch of the tool", async () => {
    mockPrepareApprove.mockResolvedValueOnce({
      kind: "policy_drift_blocked",
      approvalId: "a-4b",
      resolvedAt: "2026-05-23T20:03:00.000Z",
      sessionId: "session-1",
      missionRunId: "run-1",
      permissionAtEnqueue: "full",
      livePermission: "restricted",
      continuation: STUB_CONTINUATION,
    });

    await expect(approveAndResume("a-4b")).rejects.toThrow(
      /more restrictive/,
    );
    // Mirror the expired path: the continuation is consumed (no lease leak)
    // but the original tool is NEVER re-dispatched.
    expect(mockRunResumeAfterDecision).toHaveBeenCalledWith(STUB_CONTINUATION);
  });

  it("policy_drift_blocked (B-001) chat session (no continuation) → throws, no resume", async () => {
    mockPrepareApprove.mockResolvedValueOnce({
      kind: "policy_drift_blocked",
      approvalId: "a-4c",
      resolvedAt: "2026-05-23T20:03:00.000Z",
      sessionId: "session-1",
      missionRunId: null,
      permissionAtEnqueue: "full",
      livePermission: "restricted",
      continuation: null,
    });

    await expect(approveAndResume("a-4c")).rejects.toThrow(/more restrictive/);
    expect(mockRunResumeAfterDecision).not.toHaveBeenCalled();
  });

  it("already_rejected → throws without consuming any continuation", async () => {
    mockPrepareApprove.mockResolvedValueOnce({
      kind: "already_rejected",
      approvalId: "a-5",
      resolvedAt: "2026-05-23T20:04:00.000Z",
      decision: "rejected",
    });

    await expect(approveAndResume("a-5")).rejects.toThrow(/already rejected/);
    expect(mockRunResumeAfterDecision).not.toHaveBeenCalled();
  });

  it("run_terminated → throws with run status detail", async () => {
    mockPrepareApprove.mockResolvedValueOnce({
      kind: "run_terminated",
      approvalId: "a-6",
      missionRunId: "run-cancelled",
      runStatus: "cancelled",
    });

    await expect(approveAndResume("a-6")).rejects.toThrow(
      /run run-cancelled is cancelled/,
    );
    expect(mockRunResumeAfterDecision).not.toHaveBeenCalled();
  });

  it("prepareApprove rejects with not-found → wrapper re-throws", async () => {
    mockPrepareApprove.mockRejectedValueOnce(new Error("Approval a-7 not found"));

    await expect(approveAndResume("a-7")).rejects.toThrow(/not found/);
  });

  it("ApprovalDispatchError propagates through the wrapper unchanged", async () => {
    const dispatchErr = new FakeApprovalDispatchError(
      "a-8",
      "TypeError",
      "abc123",
    );
    mockPrepareApprove.mockRejectedValueOnce(dispatchErr);

    await expect(approveAndResume("a-8")).rejects.toBe(dispatchErr);
  });

  it("dispatched + executionStatus=failed + continuation → still awaits resume (agent sees failure in transcript)", async () => {
    // Controlled tool failure (success:false) — mission still resumes
    // because the agent needs to see the tool error and decide next.
    mockPrepareApprove.mockResolvedValueOnce({
      kind: "dispatched",
      approvalId: "a-9",
      resolvedAt: "2026-05-23T20:05:00.000Z",
      executionStatus: "failed",
      sessionId: "session-1",
      missionRunId: "run-1",
      continuation: STUB_CONTINUATION,
      toolResult: { success: false, output: "Insufficient funds" },
    });

    await approveAndResume("a-9");

    expect(mockRunResumeAfterDecision).toHaveBeenCalledWith(STUB_CONTINUATION);
  });
});
