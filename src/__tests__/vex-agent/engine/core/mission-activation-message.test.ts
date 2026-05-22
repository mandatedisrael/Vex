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
  setStatus: (...args: unknown[]) => mockSetMissionStatus(...args),
  setApprovedAt: (...args: unknown[]) => mockSetApprovedAt(...args),
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
        isSubagent: false,
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
    expect(mockCreateRun.mock.invocationCallOrder[0]).toBeLessThan(
      mockAddEngineMessage.mock.invocationCallOrder[0],
    );
    expect(mockAddEngineMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mockHydrate.mock.invocationCallOrder[0],
    );
  });
});
