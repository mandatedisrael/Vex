import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../../../../local/vex-shell/platform/render.js";

const mocks = vi.hoisted(() => ({
  routeUserMessage: vi.fn(),
  submitOperatorInstruction: vi.fn(),
  startReadyMission: vi.fn(),
  startMissionFromSetup: vi.fn(),
  abortActiveMission: vi.fn(),
  approveById: vi.fn(),
  editMissionDraft: vi.fn(),
  recoverMission: vi.fn(),
  rejectById: vi.fn(),
  recordTurnLatency: vi.fn(),
  sessionInfo: vi.fn(),
  sessionError: vi.fn(),
}));

vi.mock("../../../../src/vex-agent/engine/index.js", () => ({
  routeUserMessage: (...args: unknown[]) => mocks.routeUserMessage(...args),
  submitOperatorInstruction: (...args: unknown[]) => mocks.submitOperatorInstruction(...args),
  ACTIVE_OR_PAUSED_RUN_STATUSES: new Set(["running", "paused_approval", "paused_wake", "paused_error"]),
  ACTIVE_OR_PAUSED_FULL_AUTONOMOUS_STATUSES: new Set(["running", "paused_wake", "paused_error"]),
}));

vi.mock("../../../../local/vex-shell/engine-actions.js", () => ({
  startReadyMission: (...args: unknown[]) => mocks.startReadyMission(...args),
  startMissionFromSetup: (...args: unknown[]) => mocks.startMissionFromSetup(...args),
  abortActiveMission: (...args: unknown[]) => mocks.abortActiveMission(...args),
  approveById: (...args: unknown[]) => mocks.approveById(...args),
  editMissionDraft: (...args: unknown[]) => mocks.editMissionDraft(...args),
  recoverMission: (...args: unknown[]) => mocks.recoverMission(...args),
  rejectById: (...args: unknown[]) => mocks.rejectById(...args),
}));

vi.mock("../../../../local/vex-shell/platform/diagnostics.js", () => ({
  recordTurnLatency: (...args: unknown[]) => mocks.recordTurnLatency(...args),
}));

vi.mock("../../../../local/vex-shell/platform/log.js", () => ({
  sessionLog: {
    info: (...args: unknown[]) => mocks.sessionInfo(...args),
    error: (...args: unknown[]) => mocks.sessionError(...args),
  },
}));

const { createInitialState, createStore } = await import(
  "../../../../local/vex-shell/app/state/store.js"
);
const { runSlashCommand } = await import(
  "../../../../local/vex-shell/app/flows/shellTurn.js"
);

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    kind: "chat",
    missionStatus: "ready",
    fullAutonomousStatus: null,
    missionCommand: "start",
    pendingApprovals: 0,
    usage: {
      sessionTokens: 0,
      sessionCost: 0,
      requestCount: 0,
      lastRequestAt: null,
    },
    context: {
      promptTokens: 0,
      limit: 128_000,
      percent: 0,
      band: "normal",
    },
    ...overrides,
  };
}

function makeStore() {
  const reporter = { recordEvent: vi.fn(), end: vi.fn() };
  const store = createStore(createInitialState({
    provider: { name: "openrouter", detail: "test-model" },
    mode: "mission",
    missionLoopMode: "full",
    wakeEnabled: true,
  }));
  store.setState({
    session: makeSession(),
    reporter,
  });
  return { store, reporter };
}

describe("vex-shell slash mission activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats /mission start as an active turn and renders the engine result", async () => {
    const { store, reporter } = makeStore();
    let resolveMission!: (value: unknown) => void;
    mocks.startReadyMission.mockReturnValueOnce(new Promise((resolve) => {
      resolveMission = resolve;
    }));

    const pending = runSlashCommand(store, "/mission start");

    expect(store.getState().pendingTurn).not.toBeNull();
    expect(store.getState().lastError).toBeNull();
    expect(mocks.startReadyMission).toHaveBeenCalledWith("session-1", "full");

    resolveMission({
      ok: true,
      value: {
        text: "Scanning Solana opportunities now.",
        toolCallsMade: 3,
        pendingApprovals: [],
        stopReason: null,
        missionStatus: "running",
      },
    });
    await pending;

    expect(store.getState().pendingTurn).toBeNull();
    expect(store.getState().messages.at(-2)).toMatchObject({
      role: "system",
      content: expect.stringContaining("Mission started in full mode; status=running"),
    });
    expect(store.getState().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Scanning Solana opportunities now.",
    });
    expect(mocks.recordTurnLatency).toHaveBeenCalledWith(expect.any(Number));
    expect(reporter.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: "turnCompleted",
      source: "slash_mission_start",
      toolCallsMade: 3,
      missionStatus: "running",
    }));
  });

  it("renders /mission continue fallback details when the engine returns no text", async () => {
    const { store } = makeStore();
    store.setState({
      missionLoopMode: "restricted",
      session: makeSession({
        missionStatus: "ready",
        missionCommand: "continue",
      }),
    });
    mocks.startReadyMission.mockResolvedValueOnce({
      ok: true,
      value: {
        text: null,
        toolCallsMade: 1,
        pendingApprovals: ["approval-1"],
        stopReason: "approval_required",
        missionStatus: "paused_approval",
      },
    });

    await runSlashCommand(store, "/mission continue");

    expect(store.getState().pendingTurn).toBeNull();
    expect(store.getState().messages.at(-1)).toMatchObject({
      role: "system",
      content: expect.stringContaining("Mission continued in restricted mode; status=paused_approval"),
    });
    expect(store.getState().messages.at(-1)?.content).toContain("stopReason=approval_required");
    expect(store.getState().messages.at(-1)?.content).toContain("pendingApprovals=approval-1");
  });

  it("clears pending turn and surfaces errors for /mission start failures", async () => {
    const { store, reporter } = makeStore();
    mocks.startReadyMission.mockResolvedValueOnce({
      ok: false,
      error: "Mission status is draft",
      hint: "Save the complete draft first.",
    });

    await runSlashCommand(store, "/mission start");

    expect(store.getState().pendingTurn).toBeNull();
    expect(store.getState().lastError).toContain("Mission start failed");
    expect(store.getState().messages.at(-1)).toMatchObject({
      role: "system",
      tone: "error",
      content: expect.stringContaining("Mission start failed: Mission status is draft"),
    });
    expect(reporter.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: "error",
      where: "mission_start",
    }));
  });
});
