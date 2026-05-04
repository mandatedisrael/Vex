import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockCreateSession = vi.fn();
const mockSetScope = vi.fn();
const mockEndSession = vi.fn();
const mockListSessions = vi.fn();
const mockGetPending = vi.fn();
const mockGetActiveRunBySession = vi.fn();
const mockGetActiveFullAutonomousRunBySession = vi.fn();
const mockGetRunBySession = vi.fn();
const mockGetActiveMission = vi.fn();
const mockGetMissionBySession = vi.fn();
const mockGetStats = vi.fn();
const mockLoadEnvConfig = vi.fn();

vi.mock("../../../../src/vex-agent/db/repos/sessions.js", () => ({
  createSession: (...a: unknown[]) => mockCreateSession(...a),
  setScope: (...a: unknown[]) => mockSetScope(...a),
  endSession: (...a: unknown[]) => mockEndSession(...a),
  getSession: (...a: unknown[]) => mockGetSession(...a),
  listSessions: (...a: unknown[]) => mockListSessions(...a),
}));

vi.mock("../../../../src/vex-agent/db/repos/approvals.js", () => ({
  getPending: (...a: unknown[]) => mockGetPending(...a),
}));

vi.mock("../../../../src/vex-agent/db/repos/mission-runs.js", () => ({
  getActiveRunBySession: (...a: unknown[]) => mockGetActiveRunBySession(...a),
  getRunBySession: (...a: unknown[]) => mockGetRunBySession(...a),
}));

vi.mock("../../../../src/vex-agent/db/repos/full-autonomous-runs.js", () => ({
  getActiveRunBySession: (...a: unknown[]) => mockGetActiveFullAutonomousRunBySession(...a),
}));

vi.mock("../../../../src/vex-agent/db/repos/missions.js", () => ({
  getActiveMission: (...a: unknown[]) => mockGetActiveMission(...a),
  getMissionBySession: (...a: unknown[]) => mockGetMissionBySession(...a),
}));

vi.mock("../../../../src/vex-agent/db/repos/usage.js", () => ({
  getStats: (...a: unknown[]) => mockGetStats(...a),
}));

vi.mock("../../../../src/vex-agent/inference/config.js", () => ({
  loadEnvConfig: (...a: unknown[]) => mockLoadEnvConfig(...a),
}));

const { getMissionStatus, getMissionCommand, summarizeSession } = await import(
  "../../../../local/vex-shell/platform/session-host.js"
);

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    scope: "local_shell",
    startedAt: "2026-05-03T08:00:00.000Z",
    endedAt: null,
    summary: null,
    compacted: false,
    messageCount: 4,
    tokenCount: 0,
    memoryScopeKey: null,
    memoryLanguageCode: null,
    checkpointGeneration: 0,
    kind: "chat",
    ...overrides,
  };
}

function makeUsageStats(overrides: Record<string, unknown> = {}) {
  return {
    sessionTokens: 0,
    sessionCost: 0,
    sessionRequestCount: 0,
    sessionLastRequestAt: null,
    lifetimeTokens: 0,
    lifetimeCost: 0,
    requestCount: 0,
    lastRequestAt: null,
    ...overrides,
  };
}

describe("local shell session-host", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(makeSession());
    mockGetPending.mockResolvedValue([]);
    mockGetActiveRunBySession.mockResolvedValue(null);
    mockGetActiveFullAutonomousRunBySession.mockResolvedValue(null);
    mockGetActiveMission.mockResolvedValue(null);
    mockGetMissionBySession.mockResolvedValue(null);
    mockGetRunBySession.mockResolvedValue(null);
    mockGetStats.mockResolvedValue(makeUsageStats());
    mockLoadEnvConfig.mockReturnValue({ contextLimit: 128_000 });
  });

  it("returns active run status before mission status", async () => {
    mockGetActiveRunBySession.mockResolvedValueOnce({ status: "paused_wake" });

    await expect(getMissionStatus("session-1")).resolves.toBe("paused_wake");
    expect(mockGetActiveMission).not.toHaveBeenCalled();
  });

  it("shows latest terminal mission status instead of none", async () => {
    mockGetMissionBySession.mockResolvedValueOnce({ status: "failed" });

    await expect(getMissionStatus("session-1")).resolves.toBe("failed");
  });

  it("does not offer a command for terminal mission status", async () => {
    await expect(getMissionCommand("session-1", "failed")).resolves.toBeNull();
  });

  it("summarizes mission, approvals, token usage, and context pressure", async () => {
    mockGetSession.mockResolvedValueOnce(makeSession({ tokenCount: 104_000 }));
    mockGetPending.mockResolvedValueOnce([
      { sessionId: "session-1" },
      { sessionId: "other-session" },
    ]);
    mockGetActiveMission.mockResolvedValueOnce({ status: "ready" });
    mockGetStats.mockResolvedValueOnce(makeUsageStats({
      sessionTokens: 12_345,
      sessionCost: 0.0123,
      sessionRequestCount: 4,
      sessionLastRequestAt: "2026-05-03T08:15:00.000Z",
    }));

    await expect(summarizeSession("session-1")).resolves.toMatchObject({
      id: "session-1",
      kind: "chat",
      missionStatus: "ready",
      missionCommand: "start",
      pendingApprovals: 1,
      usage: {
        sessionTokens: 12_345,
        sessionCost: 0.0123,
        requestCount: 4,
        lastRequestAt: "2026-05-03T08:15:00.000Z",
      },
      context: {
        promptTokens: 104_000,
        limit: 128_000,
        percent: 81.25,
        band: "warning",
      },
    });
    expect(mockGetStats).toHaveBeenCalledWith("session-1");
  });
});
