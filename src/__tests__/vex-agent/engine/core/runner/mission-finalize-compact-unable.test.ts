/**
 * Mission-finalize regression — `compact_unable_at_critical` stop reason
 * must land the run as `paused_error` with the right reason string, and
 * leave the parent mission row at `running` (matches the `paused_error`
 * retry surface used by provider failures).
 *
 * Originally caught by codex P1 round 3: the turn-loop sets the stop
 * reason + paused_error, but `finalizeMissionRunStatus` previously had no
 * branch for it and fell through to `return "running"` without writing the
 * run row, orphaning state. This test pins the fix.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMissionRunsUpdateStatus = vi.fn();
const mockMissionsSetStatus = vi.fn();
const mockMissionsClearApprovedAt = vi.fn();
const mockConsumeAbortIntent = vi.fn().mockReturnValue(null);
const mockScheduleRuntimeContinuation = vi
  .fn()
  .mockResolvedValue({ dueAt: "2026-05-18T00:00:00Z", enqueued: true });
const mockIsContinuableRuntimeStop = vi.fn().mockReturnValue(false);

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  setStatus: (...a: unknown[]) => mockMissionsSetStatus(...a),
  clearApprovedAt: (...a: unknown[]) => mockMissionsClearApprovedAt(...a),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  updateStatus: (...a: unknown[]) => mockMissionRunsUpdateStatus(...a),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/abort.js", () => ({
  consumeMissionRunAbortIntent: (...a: unknown[]) => mockConsumeAbortIntent(...a),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/runtime-continuation.js", () => ({
  isContinuableRuntimeStop: (...a: unknown[]) => mockIsContinuableRuntimeStop(...a),
  scheduleRuntimeContinuation: (...a: unknown[]) =>
    mockScheduleRuntimeContinuation(...a),
}));

import { finalizeMissionRunStatus } from "../../../../../vex-agent/engine/core/runner/mission-finalize.js";

describe("finalizeMissionRunStatus — compact_unable_at_critical", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsContinuableRuntimeStop.mockReturnValue(false);
    mockConsumeAbortIntent.mockReturnValue(null);
  });

  it("writes the run row as paused_error with reason='compact_unable_at_critical'", async () => {
    const result = await finalizeMissionRunStatus(
      "mission-1",
      "run-1",
      "session-1",
      "compact_unable_at_critical",
      { summary: "test summary", evidence: { consecutiveNoops: 2 } },
    );

    // Parent mission stays running so getActiveRunBySession still surfaces it
    // for /retry and operator visibility.
    expect(result).toBe("running");

    // Mission ROW status NOT changed (paused_error retry surface contract).
    expect(mockMissionsSetStatus).not.toHaveBeenCalled();

    // Run row flipped to paused_error with the new reason + propagated stop payload.
    expect(mockMissionRunsUpdateStatus).toHaveBeenCalledTimes(1);
    const [runId, status, reason, payload] = mockMissionRunsUpdateStatus.mock.calls[0]!;
    expect(runId).toBe("run-1");
    expect(status).toBe("paused_error");
    expect(reason).toBe("compact_unable_at_critical");
    expect(payload).toMatchObject({
      summary: "test summary",
      evidence: { consecutiveNoops: 2 },
    });
  });

  it("falls back to a default summary when no stopPayload is provided", async () => {
    await finalizeMissionRunStatus(
      "mission-1",
      "run-1",
      "session-1",
      "compact_unable_at_critical",
    );

    expect(mockMissionRunsUpdateStatus).toHaveBeenCalledTimes(1);
    const payload = mockMissionRunsUpdateStatus.mock.calls[0]![3] as { summary: string };
    expect(payload.summary).toContain("operator review required");
  });

  it("does NOT route compact_unable_at_critical through the continuable-runtime path", async () => {
    // Pin the negative: this stop reason must NOT be scheduled as a
    // waiting_for_wake continuation. If a future refactor accidentally
    // adds it to isContinuableRuntimeStop, this assertion fails.
    await finalizeMissionRunStatus(
      "mission-1",
      "run-1",
      "session-1",
      "compact_unable_at_critical",
    );

    expect(mockScheduleRuntimeContinuation).not.toHaveBeenCalled();
  });
});
