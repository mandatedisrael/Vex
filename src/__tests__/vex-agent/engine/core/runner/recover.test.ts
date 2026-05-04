import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetActiveRunBySession = vi.fn();
const mockGetLatestFailedRunBySession = vi.fn();
const mockCreateRun = vi.fn();
const mockGetMission = vi.fn();
const mockSetMissionStatus = vi.fn();
const mockSetApprovedAt = vi.fn();
const mockAddEngineMessage = vi.fn();
const mockResumeMissionRun = vi.fn();

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getActiveRunBySession: (...args: unknown[]) => mockGetActiveRunBySession(...args),
  getLatestFailedRunBySession: (...args: unknown[]) => mockGetLatestFailedRunBySession(...args),
  createRun: (...args: unknown[]) => mockCreateRun(...args),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMission: (...args: unknown[]) => mockGetMission(...args),
  setStatus: (...args: unknown[]) => mockSetMissionStatus(...args),
  setApprovedAt: (...args: unknown[]) => mockSetApprovedAt(...args),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addEngineMessage: (...args: unknown[]) => mockAddEngineMessage(...args),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/mission.js", () => ({
  resumeMissionRun: (...args: unknown[]) => mockResumeMissionRun(...args),
}));

const { recoverFailedMissionRun } = await import(
  "../../../../../vex-agent/engine/core/runner/recover.js"
);

const snapshot = {
  version: 1,
  capturedAt: "2026-05-04T08:00:00.000Z",
  missionPromptContext: "# Mission: recovered",
  frozenMission: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveRunBySession.mockResolvedValue(null);
  mockGetLatestFailedRunBySession.mockResolvedValue({
    id: "failed-run",
    missionId: "mission-1",
    sessionId: "session-1",
    status: "failed",
    loopMode: "full",
    contractSnapshotJson: snapshot,
  });
  mockGetMission.mockResolvedValue({ id: "mission-1" });
  mockCreateRun.mockResolvedValue(undefined);
  mockSetMissionStatus.mockResolvedValue(undefined);
  mockSetApprovedAt.mockResolvedValue(undefined);
  mockAddEngineMessage.mockResolvedValue(undefined);
  mockResumeMissionRun.mockResolvedValue({
    text: "recovered",
    toolCallsMade: 0,
    pendingApprovals: [],
    stopReason: null,
    missionStatus: "running",
  });
});

describe("recoverFailedMissionRun", () => {
  it("creates a new run from the failed run snapshot and leaves failed audit intact", async () => {
    const result = await recoverFailedMissionRun("session-1");

    expect(result.text).toBe("recovered");
    expect(mockSetMissionStatus).toHaveBeenCalledWith("mission-1", "running");
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.stringMatching(/^run-/),
      "mission-1",
      "session-1",
      "full",
      {
        contractSnapshotJson: snapshot,
        recoveredFromRunId: "failed-run",
      },
    );
    expect(mockAddEngineMessage).toHaveBeenCalledWith(
      "session-1",
      expect.stringContaining("mission_recovered"),
      expect.objectContaining({
        messageType: "mission_recovered",
        payload: expect.objectContaining({ recoveredFromRunId: "failed-run" }),
      }),
    );
    expect(mockResumeMissionRun).toHaveBeenCalledWith(expect.stringMatching(/^run-/));
  });

  it("refuses recovery while a run is still active", async () => {
    mockGetActiveRunBySession.mockResolvedValueOnce({ id: "run-active", status: "running" });

    await expect(recoverFailedMissionRun("session-1")).rejects.toThrow(/still active/);
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("refuses old failed runs without a contract snapshot", async () => {
    mockGetLatestFailedRunBySession.mockResolvedValueOnce({
      id: "failed-run",
      missionId: "mission-1",
      sessionId: "session-1",
      status: "failed",
      loopMode: "restricted",
      contractSnapshotJson: null,
    });

    await expect(recoverFailedMissionRun("session-1")).rejects.toThrow(/no recoverable contract snapshot/);
    expect(mockCreateRun).not.toHaveBeenCalled();
  });
});
