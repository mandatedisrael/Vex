import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submitOperatorInstruction: vi.fn(),
  recordTurnLatency: vi.fn(),
}));

vi.mock("../../../../src/vex-agent/engine/index.js", () => ({
  submitOperatorInstruction: (...args: unknown[]) => mocks.submitOperatorInstruction(...args),
  ACTIVE_OR_PAUSED_RUN_STATUSES: new Set(["running", "paused_approval", "paused_wake", "paused_error"]),
  ACTIVE_OR_PAUSED_FULL_AUTONOMOUS_STATUSES: new Set(["running", "paused_wake", "paused_error"]),
}));

vi.mock("../../../../local/vex-shell/platform/diagnostics.js", () => ({
  recordTurnLatency: (...args: unknown[]) => mocks.recordTurnLatency(...args),
}));

const { createInitialState, createStore } = await import(
  "../../../../local/vex-shell/app/state/store.js"
);
const {
  sendOperatorInstruction,
  shouldSendOperatorInstruction,
} = await import("../../../../local/vex-shell/app/flows/operatorInstruction.js");

function makeStore() {
  const store = createStore(createInitialState({
    provider: { name: "openrouter", detail: "test" },
    mode: "mission",
    wakeEnabled: true,
  }));
  store.setState({
    session: {
      id: "session-1",
      kind: "chat",
      missionStatus: "running",
      fullAutonomousStatus: null,
      missionCommand: null,
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
    },
  });
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.submitOperatorInstruction.mockResolvedValue({
    text: "Instruction queued.",
    toolCallsMade: 0,
    pendingApprovals: [],
    stopReason: null,
    missionStatus: "running",
  });
});

describe("operator instruction shell flow", () => {
  it("detects active mission/full-autonomous sessions", () => {
    const store = makeStore();
    expect(shouldSendOperatorInstruction(store)).toBe(true);

    store.setState((s) => ({
      session: s.session ? { ...s.session, missionStatus: null, fullAutonomousStatus: "running" } : null,
    }));
    expect(shouldSendOperatorInstruction(store)).toBe(true);

    store.setState((s) => ({
      session: s.session ? { ...s.session, missionStatus: "ready", fullAutonomousStatus: null } : null,
    }));
    expect(shouldSendOperatorInstruction(store)).toBe(false);
  });

  it("appends a system acknowledgement without replacing the active pending turn", async () => {
    const store = makeStore();
    store.setState({ pendingTurn: { startedAt: 1 } });

    await sendOperatorInstruction(store, "do it this way");

    expect(mocks.submitOperatorInstruction).toHaveBeenCalledWith("session-1", "do it this way");
    expect(store.getState().pendingTurn).toEqual({ startedAt: 1 });
    expect(store.getState().messages.at(-1)).toMatchObject({
      role: "system",
      content: "Instruction queued.",
    });
  });
});
