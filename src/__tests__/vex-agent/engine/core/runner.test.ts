import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockResolveProvider = vi.fn();
const mockAddMessage = vi.fn();
const mockAddEngineMessage = vi.fn();
const mockHydrate = vi.fn();
const mockRunTurnLoop = vi.fn();
const mockGetMission = vi.fn();
const mockCreateDraft = vi.fn();
const mockUpdateDraft = vi.fn();
const mockSetMissionStatus = vi.fn();
const mockSetApprovedAt = vi.fn();
const mockCreateRun = vi.fn();
const mockGetRun = vi.fn();
const mockUpdateRunStatus = vi.fn();
const mockEnqueueWake = vi.fn();

vi.mock("@vex-agent/inference/registry.js", () => ({
  resolveProvider: () => mockResolveProvider(),
}));

vi.mock("@vex-agent/engine/events/index.js", () => ({
  appendMessage: (...a: unknown[]) => mockAddMessage(...a),
  appendEngineMessage: (...a: unknown[]) => mockAddEngineMessage(...a),
  emitTranscriptAppend: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: (...a: unknown[]) => mockAddEngineMessage(...a),
  addMessageReturningId: vi.fn().mockResolvedValue({
    id: 1, role: "assistant", content: "", timestamp: new Date().toISOString(),
  }),
  getLiveMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../../vex-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: (...a: unknown[]) => mockHydrate(...a),
}));

vi.mock("../../../../vex-agent/engine/core/turn-loop.js", () => ({
  runTurnLoop: (...a: unknown[]) => mockRunTurnLoop(...a),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  createDraft: (...a: unknown[]) => mockCreateDraft(...a),
  getMission: (...a: unknown[]) => mockGetMission(...a),
  updateDraft: (...a: unknown[]) => mockUpdateDraft(...a),
  setStatus: (...a: unknown[]) => mockSetMissionStatus(...a),
  setApprovedAt: (...a: unknown[]) => mockSetApprovedAt(...a),
  getMissionBySession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  createRun: (...a: unknown[]) => mockCreateRun(...a),
  getRun: (...a: unknown[]) => mockGetRun(...a),
  updateStatus: (...a: unknown[]) => mockUpdateRunStatus(...a),
  getActiveRun: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vex-agent/db/repos/loop-wake.js", () => ({
  enqueue: (...a: unknown[]) => mockEnqueueWake(...a),
}));

vi.mock("@vex-agent/tools/registry.js", () => ({
  getOpenAITools: vi.fn().mockReturnValue([]),
}));

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  getSession: vi.fn(),
  updateTokenCount: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/session-links.js", () => ({
  getParentSession: vi.fn().mockResolvedValue(null),
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

vi.mock("@vex-agent/tools/protocols/catalog.js", () => ({
  PROTOCOL_TOOLS: [],
  PROTOCOL_NAMESPACE_ALLOWLIST: [],
}));

const { processAgentTurn, processMissionSetupTurn, startMission, resumeMissionRun } = await import(
  "../../../../vex-agent/engine/core/runner.js"
);
const { MissionRunPausedError } = await import(
  "../../../../vex-agent/engine/types.js"
);

function makeProvider() {
  return {
    loadConfig: vi.fn().mockResolvedValue({
      provider: "openrouter",
      model: "test",
      contextLimit: 128000,
      maxOutputTokens: 4096,
    }),
  };
}

function makeHydratedSession(overrides = {}) {
  return {
    context: {
      sessionId: "session-1",
      sessionKind: "agent",
      sessionPermission: "restricted",
      missionId: null,
      missionRunId: null,
      isSubagent: false,
      loadedDocuments: new Map(),
      ...overrides,
    },
    messages: [],
    summary: null,
    tokenCount: 0,
  };
}

function makeMission(overrides = {}) {
  return {
    id: "mission-1",
    rootSessionId: "session-1",
    status: "draft",
    title: null,
    goal: null,
    capitalSourceJson: {},
    allowedWallets: [],
    allowedChains: [],
    allowedProtocols: [],
    riskProfile: null,
    successCriteriaJson: [],
    stopConditionsJson: [],
    constraintsJson: {},
    createdAt: "2026-03-29",
    updatedAt: "2026-03-29",
    approvedAt: null,
    ...overrides,
  };
}

function makeReadyMission(overrides = {}) {
  return makeMission({
    status: "ready",
    title: "SOL DCA",
    goal: "Accumulate 10 SOL",
    capitalSourceJson: { type: "wallet", amount: "500 USDC" },
    allowedWallets: ["solana"],
    allowedChains: ["solana"],
    allowedProtocols: ["solana"],
    riskProfile: "conservative",
    successCriteriaJson: ["Accumulated 10 SOL"],
    stopConditionsJson: ["capital_depleted"],
    constraintsJson: { stopConditionsAccepted: true },
    ...overrides,
  });
}

// Resolve the sessions repo once; mocks are reused inside beforeEach.
const sessionsRepoMockedSetup = await import("@vex-agent/db/repos/sessions.js");

describe("runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProvider.mockResolvedValue(makeProvider());
    mockEnqueueWake.mockResolvedValue({
      id: "wake-1",
      sessionId: "session-1",
      missionRunId: "run-1",
      dueAt: "2026-03-29T00:00:05.000Z",
      status: "pending",
      reason: "iteration_limit: runtime slice exhausted; continue autonomously",
      payload: { trigger: "iteration_limit", automatic: true },
      createdAt: "2026-03-29T00:00:00.000Z",
      consumedAt: null,
      cancelledAt: null,
      cancelledReason: null,
    });
    // sessionsRepo.getSession is needed by startMission to read session.permission
    vi.mocked(sessionsRepoMockedSetup.getSession).mockResolvedValue({
      id: "session-1",
      mode: "mission",
      permission: "restricted",
      tokenCount: 0,
    } as unknown as Awaited<ReturnType<typeof sessionsRepoMockedSetup.getSession>>);
  });

  // ── processAgentTurn ─────────────────────────────────────────

  describe("processAgentTurn", () => {
    it("saves user message and runs turn loop", async () => {
      mockHydrate.mockResolvedValueOnce(makeHydratedSession());
      mockRunTurnLoop.mockResolvedValueOnce({
        text: "Hello!", toolCallsMade: 0, pendingApprovals: [], stopReason: null,
      });

      const result = await processAgentTurn("session-1", "Hi");

      expect(mockAddMessage).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({ role: "user", content: "Hi" }),
        expect.objectContaining({ source: "user", messageType: "chat" }),
      );
      expect(result.text).toBe("Hello!");
      expect(result.missionStatus).toBeNull();
    });

    it("throws if no provider", async () => {
      mockResolveProvider.mockResolvedValueOnce(null);
      await expect(processAgentTurn("session-1", "Hi")).rejects.toThrow("No inference provider");
    });

    it("throws if session not found", async () => {
      mockHydrate.mockResolvedValueOnce(null);
      await expect(processAgentTurn("nonexistent", "Hi")).rejects.toThrow("not found");
    });
  });

  // ── processMissionSetupTurn ────────────────────────────────

  describe("processMissionSetupTurn", () => {
    it("adds a DB-not-ready correction when setup text suggests starting a draft", async () => {
      mockHydrate.mockResolvedValueOnce(makeHydratedSession({
        sessionKind: "mission",
        missionId: "mission-1",
      }));
      mockGetMission
        .mockResolvedValueOnce(makeMission({ title: "SOL Flip" }))
        .mockResolvedValueOnce(makeMission({ title: "SOL Flip" }));
      mockRunTurnLoop.mockResolvedValueOnce({
        text: "Ready to start? Reply /mission start.",
        toolCallsMade: 1,
        pendingApprovals: [],
        stopReason: null,
      });

      const result = await processMissionSetupTurn("session-1", "ready");

      expect(result.missionStatus).toBe("draft");
      expect(result.text).toContain("Ready to start? Reply /mission start.");
      expect(result.text).toContain("Mission draft is not ready in the database.");
      expect(result.text).toContain("Missing fields:");
      expect(mockAddEngineMessage).toHaveBeenCalledWith(
        "session-1",
        expect.stringContaining("Mission draft is not ready in the database."),
        expect.objectContaining({
          source: "engine",
          messageType: "mission_setup",
          visibility: "internal",
          payload: expect.objectContaining({
            missionId: "mission-1",
            status: "draft",
            correction: "db_not_ready_start_suggestion",
          }),
        }),
      );
    });
  });

  // ── startMission ────────────────────────────────────────────

  describe("startMission", () => {
    it("validates, freezes, creates run, and enters loop", async () => {
      mockGetMission.mockResolvedValueOnce(makeReadyMission());
      mockHydrate.mockResolvedValueOnce(makeHydratedSession({ sessionKind: "mission" }));
      mockRunTurnLoop.mockResolvedValueOnce({
        text: "Starting mission...", toolCallsMade: 2, pendingApprovals: [], stopReason: null,
      });

      const result = await startMission("mission-1");

      expect(mockSetMissionStatus).toHaveBeenCalledWith("mission-1", "running");
      expect(mockSetApprovedAt).toHaveBeenCalledWith("mission-1");
      expect(mockCreateRun).toHaveBeenCalled();
      expect(result.text).toBe("Starting mission...");
      expect(result.missionStatus).toBe("running");
    });

    it("marks only goal_reached as completed", async () => {
      mockGetMission.mockResolvedValueOnce(makeReadyMission());
      mockHydrate.mockResolvedValueOnce(makeHydratedSession({ sessionKind: "mission" }));
      mockRunTurnLoop.mockResolvedValueOnce({
        text: "Done",
        toolCallsMade: 1,
        pendingApprovals: [],
        stopReason: "goal_reached",
        stopPayload: { summary: "Target hit" },
      });

      const result = await startMission("mission-1");

      expect(result.missionStatus).toBe("completed");
      expect(mockSetMissionStatus).toHaveBeenLastCalledWith("mission-1", "completed");
      expect(mockUpdateRunStatus).toHaveBeenCalledWith(
        expect.any(String),
        "completed",
        "goal_reached",
        { summary: "Target hit" },
      );
    });

    it("marks accepted non-success stop reasons as failed", async () => {
      mockGetMission.mockResolvedValueOnce(makeReadyMission({
        stopConditionsJson: ["no_viable_opportunity"],
      }));
      mockHydrate.mockResolvedValueOnce(makeHydratedSession({ sessionKind: "mission" }));
      mockRunTurnLoop.mockResolvedValueOnce({
        text: "No viable setup",
        toolCallsMade: 1,
        pendingApprovals: [],
        stopReason: "no_viable_opportunity",
        stopPayload: { summary: "No viable setup" },
      });

      const result = await startMission("mission-1");

      expect(result.missionStatus).toBe("failed");
      expect(mockSetMissionStatus).toHaveBeenLastCalledWith("mission-1", "failed");
      expect(mockUpdateRunStatus).toHaveBeenCalledWith(
        expect.any(String),
        "failed",
        "no_viable_opportunity",
        { summary: "No viable setup" },
      );
    });

    it("marks emergency stops as failed", async () => {
      mockGetMission.mockResolvedValueOnce(makeReadyMission());
      mockHydrate.mockResolvedValueOnce(makeHydratedSession({ sessionKind: "mission" }));
      mockRunTurnLoop.mockResolvedValueOnce({
        text: "Emergency",
        toolCallsMade: 1,
        pendingApprovals: [],
        stopReason: "emergency_stop",
        stopPayload: { summary: "Wallet state cannot be verified" },
      });

      const result = await startMission("mission-1");

      expect(result.missionStatus).toBe("failed");
      expect(mockSetMissionStatus).toHaveBeenLastCalledWith("mission-1", "failed");
      expect(mockUpdateRunStatus).toHaveBeenCalledWith(
        expect.any(String),
        "failed",
        "emergency_stop",
        { summary: "Wallet state cannot be verified" },
      );
    });

    it("schedules wake continuation instead of failing on iteration_limit", async () => {
      mockGetMission.mockResolvedValueOnce(makeReadyMission());
      mockHydrate.mockResolvedValueOnce(makeHydratedSession({ sessionKind: "mission" }));
      mockRunTurnLoop.mockResolvedValueOnce({
        text: "Still working",
        toolCallsMade: 50,
        pendingApprovals: [],
        stopReason: "iteration_limit",
      });

      const result = await startMission("mission-1");

      expect(result.missionStatus).toBe("running");
      expect(mockSetMissionStatus).not.toHaveBeenCalledWith("mission-1", "failed");
      expect(mockEnqueueWake).toHaveBeenCalled();
      const wakeInput = mockEnqueueWake.mock.calls[0]![0] as {
        sessionId: string;
        missionRunId: string;
        payload: Record<string, unknown>;
      };
      expect(wakeInput.sessionId).toBe("session-1");
      expect(wakeInput.missionRunId).toEqual(expect.stringMatching(/^run-/));
      expect(wakeInput.payload).toMatchObject({ trigger: "iteration_limit", automatic: true });
      expect(mockUpdateRunStatus).toHaveBeenCalledWith(
        expect.any(String),
        "paused_wake",
        "waiting_for_wake",
        expect.objectContaining({
          summary: expect.stringContaining("iteration_limit"),
          evidence: expect.objectContaining({ trigger: "iteration_limit" }),
        }),
      );
      expect(mockAddEngineMessage).toHaveBeenCalledWith(
        "session-1",
        expect.stringContaining("runtime_yield"),
        expect.objectContaining({
          messageType: "runtime_yield",
          payload: expect.objectContaining({ trigger: "iteration_limit" }),
        }),
      );
    });

    it("pauses the run with evidence when the mission loop throws", async () => {
      mockGetMission.mockResolvedValueOnce(makeReadyMission());
      mockHydrate.mockResolvedValueOnce(makeHydratedSession({ sessionKind: "mission" }));
      mockRunTurnLoop.mockRejectedValueOnce(new Error("provider exploded"));

      await expect(startMission("mission-1")).rejects.toBeInstanceOf(MissionRunPausedError);

      expect(mockUpdateRunStatus).toHaveBeenCalledWith(
        expect.any(String),
        "paused_error",
        "provider_error",
        expect.objectContaining({
          summary: "provider exploded",
          evidence: expect.objectContaining({
            errorMessage: "provider exploded",
            errorClass: "Error",
            missionId: "mission-1",
          }),
        }),
      );
    });

    it("pauses the run when hydration fails after createRun", async () => {
      mockGetMission.mockResolvedValueOnce(makeReadyMission());
      mockHydrate.mockResolvedValueOnce(null);

      await expect(startMission("mission-1")).rejects.toBeInstanceOf(MissionRunPausedError);

      expect(mockCreateRun).toHaveBeenCalled();
      expect(mockUpdateRunStatus).toHaveBeenCalledWith(
        expect.any(String),
        "paused_error",
        "provider_error",
        expect.objectContaining({
          evidence: expect.objectContaining({
            errorMessage: "Session session-1 not found",
          }),
        }),
      );
    });

    it("throws if mission not found", async () => {
      mockGetMission.mockResolvedValueOnce(null);
      await expect(startMission("nonexistent")).rejects.toThrow("not found");
    });

    it("throws if mission not ready", async () => {
      mockGetMission.mockResolvedValueOnce({
        id: "mission-1", status: "draft", title: null, goal: null,
        capitalSourceJson: {}, allowedWallets: [], allowedChains: [],
        allowedProtocols: [], riskProfile: null, successCriteriaJson: [],
        stopConditionsJson: [], constraintsJson: {},
        rootSessionId: "s", createdAt: "", updatedAt: "", approvedAt: null,
      });
      await expect(startMission("mission-1")).rejects.toThrow("not ready");
    });
  });

  // ── resumeMissionRun ────────────────────────────────────────

  describe("resumeMissionRun", () => {
    it("resumes run and enters loop", async () => {
      mockGetRun.mockResolvedValueOnce({
        id: "run-1", missionId: "mission-1", sessionId: "session-1",
        status: "running", iterationCount: 5,
      });
      mockGetMission.mockResolvedValueOnce({
        id: "mission-1", rootSessionId: "session-1", status: "running",
        title: "SOL DCA", goal: "Accumulate", capitalSourceJson: {},
        allowedWallets: ["sol"], allowedChains: ["sol"], allowedProtocols: ["sol"],
        riskProfile: "conservative", successCriteriaJson: [], stopConditionsJson: [],
        constraintsJson: {}, createdAt: "", updatedAt: "", approvedAt: "",
      });
      mockHydrate.mockResolvedValueOnce(makeHydratedSession({
        sessionKind: "mission", missionId: "mission-1", missionRunId: "run-1",
      }));
      mockRunTurnLoop.mockResolvedValueOnce({
        text: "Resumed", toolCallsMade: 1, pendingApprovals: [], stopReason: null,
      });

      const result = await resumeMissionRun("run-1");

      expect(result.text).toBe("Resumed");
      expect(result.missionStatus).toBe("running");
    });

    it("pauses the run with evidence when resume throws inside the loop", async () => {
      mockGetRun.mockResolvedValueOnce({
        id: "run-1", missionId: "mission-1", sessionId: "session-1",
        status: "paused_wake", iterationCount: 5,
      });
      mockGetMission.mockResolvedValueOnce(makeReadyMission({ status: "running" }));
      mockHydrate.mockResolvedValueOnce(makeHydratedSession({
        sessionKind: "mission", missionId: "mission-1", missionRunId: "run-1",
      }));
      mockRunTurnLoop.mockRejectedValueOnce(new Error("provider exploded"));

      await expect(resumeMissionRun("run-1")).rejects.toBeInstanceOf(MissionRunPausedError);

      expect(mockUpdateRunStatus).toHaveBeenCalledWith("run-1", "running");
      expect(mockUpdateRunStatus).toHaveBeenCalledWith(
        "run-1",
        "paused_error",
        "provider_error",
        expect.objectContaining({
          evidence: expect.objectContaining({
            errorMessage: "provider exploded",
            runId: "run-1",
          }),
        }),
      );
    });

    it("throws if run not found", async () => {
      mockGetRun.mockResolvedValueOnce(null);
      await expect(resumeMissionRun("nonexistent")).rejects.toThrow("not found");
    });
  });
});
