import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockGetById = vi.fn();
const mockUpdateSubagentStatus = vi.fn();
const mockGetSubagentSession = vi.fn();

vi.mock("@vex-agent/db/repos/subagents.js", () => ({
  getById: (...a: unknown[]) => mockGetById(...a),
  updateStatus: (...a: unknown[]) => mockUpdateSubagentStatus(...a),
}));

vi.mock("@vex-agent/db/repos/session-links.js", () => ({
  getSubagentSession: (...a: unknown[]) => mockGetSubagentSession(...a),
  getParentSession: vi.fn().mockResolvedValue({ parentSessionId: "session-parent" }),
}));

const mockResolveProvider = vi.fn();
vi.mock("@vex-agent/inference/registry.js", () => ({
  resolveProvider: () => mockResolveProvider(),
}));

vi.mock("@vex-agent/tools/registry.js", () => ({
  getOpenAITools: vi.fn().mockReturnValue([]),
}));

// Mock turn loop
const mockRunTurnLoop = vi.fn();
vi.mock("../../../../vex-agent/engine/core/turn-loop.js", () => ({
  runTurnLoop: (...a: unknown[]) => mockRunTurnLoop(...a),
}));

// Mock hydrate
vi.mock("../../../../vex-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: vi.fn().mockResolvedValue({
    context: {
      sessionId: "session-child",
      sessionKind: "agent",
      sessionPermission: "restricted",
      missionId: null,
      missionRunId: null,
      isSubagent: true,
      loadedDocuments: new Map(),
    },
    messages: [],
    summary: null,
    tokenCount: 0,
  }),
}));

// Mock relay
const mockRelayToParent = vi.fn();
vi.mock("../../../../vex-agent/engine/subagents/relay.js", () => ({
  relayToParent: (...a: unknown[]) => mockRelayToParent(...a),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addMessage: vi.fn(),
  addEngineMessage: vi.fn(),
  addMessageReturningId: vi.fn().mockResolvedValue({
    id: 1, role: "assistant", content: "", timestamp: new Date().toISOString(),
  }),
  getLiveMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("@vex-agent/engine/events/index.js", () => ({
  appendMessage: vi.fn(),
  appendEngineMessage: vi.fn(),
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

const { runSubagentEngine } = await import("../../../../vex-agent/engine/subagents/runner.js");

describe("subagent runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockResolveProvider.mockResolvedValue({
      loadConfig: vi.fn().mockResolvedValue({
        provider: "openrouter",
        model: "test",
        contextLimit: 128000,
      }),
    });

    mockGetById.mockResolvedValue({
      id: "subagent-1",
      name: "researcher",
      task: "Research SOL/USDC liquidity on Jupiter",
      status: "pending",
      allowTrades: false,
      maxIterations: 5,
      iterations: 0,
      tokenCost: 0,
      startedAt: "2026-03-29T10:00:00Z",
      endedAt: null,
      result: null,
      error: null,
    });

    mockGetSubagentSession.mockResolvedValue({
      parentSessionId: "session-parent",
      childSessionId: "session-child",
      relationType: "subagent",
      subagentId: "subagent-1",
    });
  });

  it("runs subagent and returns result", async () => {
    mockRunTurnLoop.mockResolvedValue({
      text: "SOL/USDC liquidity is $5M on Jupiter",
      toolCallsMade: 2,
      pendingApprovals: [],
      stopReason: null,
    });

    const result = await runSubagentEngine("subagent-1");

    expect(result.subagentId).toBe("subagent-1");
    expect(result.output).toBe("SOL/USDC liquidity is $5M on Jupiter");
    expect(result.toolCallsMade).toBe(2);
    expect(result.success).toBe(true);
  });

  it("relays result to parent", async () => {
    mockRunTurnLoop.mockResolvedValue({
      text: "Done",
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
    });

    await runSubagentEngine("subagent-1");

    expect(mockRelayToParent).toHaveBeenCalledWith("subagent-1", "Done");
  });

  it("does not manage status — caller responsibility", async () => {
    mockRunTurnLoop.mockResolvedValue({
      text: "Done",
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
    });

    await runSubagentEngine("subagent-1");

    // Runner does NOT call updateStatus — caller (subagent.ts) manages lifecycle
    expect(mockUpdateSubagentStatus).not.toHaveBeenCalled();
  });

  it("handles errors gracefully and returns success=false", async () => {
    mockRunTurnLoop.mockRejectedValue(new Error("Inference failed"));

    const result = await runSubagentEngine("subagent-1");

    expect(result.success).toBe(false);
    expect(result.output).toContain("Inference failed");
    // Runner does NOT set status — just returns failure
    expect(mockUpdateSubagentStatus).not.toHaveBeenCalled();
    expect(mockRelayToParent).toHaveBeenCalledWith("subagent-1", expect.stringContaining("error"));
  });

  it("throws if subagent not found", async () => {
    mockGetById.mockResolvedValue(null);
    await expect(runSubagentEngine("nonexistent")).rejects.toThrow("not found");
  });

  it("throws if no session link", async () => {
    mockGetSubagentSession.mockResolvedValue(null);
    await expect(runSubagentEngine("subagent-1")).rejects.toThrow("No session link");
  });

  it("uses restricted permission when allowTrades is false", async () => {
    mockRunTurnLoop.mockResolvedValue({
      text: "Done",
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
    });

    await runSubagentEngine("subagent-1");

    // Check that the context passed to runTurnLoop has restricted permission
    const [context] = mockRunTurnLoop.mock.calls[0];
    expect(context.sessionPermission).toBe("restricted");
    expect(context.isSubagent).toBe(true);
  });

  it("passes buildToolsForBand to runTurnLoop so Tool Map + catalog stay in sync under pressure", async () => {
    // PR3-clarity catalog/Tool Map invariant: subagents must rebuild the
    // OpenAI tools array per-band, otherwise the system-prompt Tool Map
    // (rendered per-iteration from live band) and the actual visible
    // tools array (rendered once at startup) drift at barrier/critical.
    // The dispatcher hard-deny still backstops safety, but the contract
    // is that what the agent SEES in the Tool Map matches what it can
    // CALL — that invariant has to hold for subagents too.
    mockRunTurnLoop.mockResolvedValue({
      text: "Done",
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
    });

    await runSubagentEngine("subagent-1");

    // runTurnLoop(context, messages, summary, tokenCount, provider,
    // config, tools, loopConfig, promptOptions?, signal?)
    const args = mockRunTurnLoop.mock.calls[0];
    const loopConfig = args[7] as { buildToolsForBand?: unknown };
    expect(loopConfig.buildToolsForBand).toBeTypeOf("function");
  });
});
