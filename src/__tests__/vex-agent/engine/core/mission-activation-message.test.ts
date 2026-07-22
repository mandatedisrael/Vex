import { describe, expect, it, vi, beforeEach } from "vitest";

const mockResolveProvider = vi.fn();
const mockAddEngineMessage = vi.fn();
const mockHydrate = vi.fn();
const mockRunTurnLoop = vi.fn();
const mockGetMission = vi.fn();
const mockSetMissionStatus = vi.fn();
const mockSetApprovedAt = vi.fn();
const mockCreateRun = vi.fn();
const mockGetActiveRun = vi.fn();

vi.mock("@vex-agent/inference/registry.js", () => ({
  resolveProvider: () => mockResolveProvider(),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addEngineMessage: (...args: unknown[]) => mockAddEngineMessage(...args),
  addMessageReturningId: vi.fn().mockResolvedValue({
    id: 1, role: "system", content: "", timestamp: new Date().toISOString(),
  }),
}));

vi.mock("@vex-agent/engine/events/index.js", () => ({
  appendMessage: vi.fn(),
  appendEngineMessage: (...args: unknown[]) => mockAddEngineMessage(...args),
  emitTranscriptAppend: vi.fn(),
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

vi.mock("../../../../vex-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: (...args: unknown[]) => mockHydrate(...args),
}));

vi.mock("../../../../vex-agent/engine/core/turn-loop.js", () => ({
  runTurnLoop: (...args: unknown[]) => mockRunTurnLoop(...args),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMission: (...args: unknown[]) => mockGetMission(...args),
  // Puzzle 04 — gate's row-locked re-read forwards through the same
  // fixture so the gate sees the accepted contract this test sets up.
  getMissionForUpdate: (...args: unknown[]) => mockGetMission(args[1]),
  setStatus: (...args: unknown[]) => mockSetMissionStatus(...args),
  setApprovedAt: (...args: unknown[]) => mockSetApprovedAt(...args),
  updateAcceptance: vi.fn(),
  clearAcceptance: vi.fn(),
}));

// Puzzle 04 atomic gate — default = committed for these tests. The
// activation-message test verifies the system message wording, not
// gate enforcement; gate-rejection paths are covered in
// `runner.test.ts`.
vi.mock("../../../../vex-agent/engine/mission/commit-start.js", () => ({
  commitMissionStart: vi.fn().mockImplementation(async (input: { missionId: string; runId: string }) => ({
    outcome: "committed" as const,
    mission: {
      id: input.missionId,
      rootSessionId: "session-1",
      status: "running",
      title: "SOL Sprint",
      goal: "Double mission capital",
      constraintsJson: {},
      successCriteriaJson: ["Portfolio reaches 16 USD"],
      stopConditionsJson: ["deadline_reached"],
      riskProfile: "aggressive",
      capitalSourceJson: { type: "wallet", amount: "8 USD" },
      allowedProtocols: ["jupiter"],
      allowedChains: ["solana"],
      allowedWallets: ["solana-wallet"],
      createdAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-04T00:00:00.000Z",
      approvedAt: "2026-05-04T00:00:00.000Z",
      acceptedContractHash: "0".repeat(64),
      acceptedContractAt: "2026-05-04T00:00:00.000Z",
      acceptedContractBy: "host",
      contractHashVersion: 1,
      renewedFromMissionId: null,
    },
    runId: input.runId,
    contractSnapshot: {
      version: 1 as const,
      capturedAt: "2026-05-04T00:00:00.000Z",
      missionPromptContext: "# Mission",
      frozenMission: {},
    },
  })),
}));

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  getSession: vi.fn().mockResolvedValue({
    id: "session-1",
    mode: "mission",
    permission: "restricted",
    tokenCount: 0,
  }),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  createRun: (...args: unknown[]) => mockCreateRun(...args),
  getActiveRun: (...args: unknown[]) => mockGetActiveRun(...args),
  // Puzzle 04 phase 6 — `prepareMissionStart` calls these session-level
  // gates before commit; default = no active run / no failed run.
  getActiveRunBySession: vi.fn().mockResolvedValue(null),
  getLatestFailedRunBySession: vi.fn().mockResolvedValue(null),
  updateStatus: vi.fn(),
}));

vi.mock("@vex-agent/tools/registry.js", () => ({
  getOpenAITools: vi.fn().mockReturnValue([]),
}));

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@vex-agent/tools/protocols/catalog.js", () => ({
  PROTOCOL_TOOLS: [],
  PROTOCOL_NAMESPACE_ALLOWLIST: [],
}));

const { startMission } = await import(
  "../../../../vex-agent/engine/core/runner/mission.js"
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

function makeReadyMission() {
  return {
    id: "mission-1",
    rootSessionId: "session-1",
    status: "ready",
    title: "SOL Sprint",
    goal: "Double mission capital",
    capitalSourceJson: { type: "wallet", amount: "8 USD" },
    allowedWallets: ["solana-wallet"],
    allowedChains: ["solana"],
    allowedProtocols: ["jupiter"],
    riskProfile: "aggressive",
    successCriteriaJson: ["Portfolio reaches 16 USD"],
    stopConditionsJson: ["deadline_reached"],
    constraintsJson: {},
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
    approvedAt: null,
    // Puzzle 04: host-only acceptance. The mission has been accepted
    // via `mission.acceptContract` (mig 023) — non-null hash is the
    // sole signal `areStopConditionsAcceptedByUser` reads now.
    acceptedContractHash: "0".repeat(64),
    acceptedContractAt: "2026-05-04T00:00:00.000Z",
    acceptedContractBy: "host",
    contractHashVersion: 1,
    renewedFromMissionId: null,
  };
}

describe("mission activation message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProvider.mockResolvedValue(makeProvider());
    mockGetMission.mockResolvedValue(makeReadyMission());
    mockGetActiveRun.mockResolvedValue(null);
    mockHydrate.mockResolvedValue({
      context: {
        sessionId: "session-1",
        sessionKind: "mission",
        sessionPermission: "restricted",
        missionId: "mission-1",
        missionRunId: null,
        loadedDocuments: new Map(),
      },
      messages: [],
      summary: null,
      tokenCount: 0,
    });
    mockRunTurnLoop.mockResolvedValue({
      text: "Scanning now.",
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
    });
  });

  it("writes a mission_started banner before hydrating the first active turn", async () => {
    // Puzzle 04 — the atomic `commitMissionStart` helper internally
    // performs setStatus + setApprovedAt + createRun, then returns.
    // The activation message must land AFTER the helper resolves but
    // BEFORE hydration. We grab the helper's call order via the
    // module mock surface instead of the legacy createRun mock.
    const acceptanceModule = await import(
      "../../../../vex-agent/engine/mission/commit-start.js"
    );
    const commitMissionStartMock = vi.mocked(acceptanceModule.commitMissionStart);

    await startMission("mission-1");

    expect(mockAddEngineMessage).toHaveBeenCalledWith(
      "session-1",
      expect.stringContaining("mission_started"),
      expect.objectContaining({
        source: "engine",
        messageType: "mission_started",
        visibility: "internal",
        payload: expect.objectContaining({
          missionId: "mission-1",
          permission: "restricted",
        }),
      }),
    );
    expect(commitMissionStartMock.mock.invocationCallOrder[0]).toBeLessThan(
      mockAddEngineMessage.mock.invocationCallOrder[0],
    );
    expect(mockAddEngineMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mockHydrate.mock.invocationCallOrder[0],
    );
  });
});
