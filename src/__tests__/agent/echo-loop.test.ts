import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreateSession = vi.fn();
const mockProcessMessage = vi.fn();
const mockGetInferenceConfig = vi.fn();
const mockHydrateSession = vi.fn();
const mockConsumeAll = vi.fn();
const mockFormatEventsForContext = vi.fn();
const mockGetLoopState = vi.fn();
const mockStartLoop = vi.fn();
const mockStopLoop = vi.fn();
const mockSetLoopSessionId = vi.fn();
const mockUpdatePhase = vi.fn();
const mockRecordCycle = vi.fn();
const mockInsertCycle = vi.fn();
const mockCreateSessionRepo = vi.fn();
const mockSetScope = vi.fn();

vi.mock("../../agent/engine.js", () => ({
  createSession: () => mockCreateSession(),
  processMessage: (...args: unknown[]) => mockProcessMessage(...args),
  getInferenceConfig: () => mockGetInferenceConfig(),
}));
vi.mock("../../agent/session-hydrate.js", () => ({
  hydrateSession: (...args: unknown[]) => mockHydrateSession(...args),
}));
vi.mock("../../agent/autonomy-inbox.js", () => ({
  consumeAll: () => mockConsumeAll(),
  formatEventsForContext: (...args: unknown[]) => mockFormatEventsForContext(...args),
}));
vi.mock("../../agent/db/repos/loop.js", () => ({
  getLoopState: () => mockGetLoopState(),
  startLoop: (...args: unknown[]) => mockStartLoop(...args),
  stopLoop: () => mockStopLoop(),
  setLoopSessionId: (...args: unknown[]) => mockSetLoopSessionId(...args),
  updatePhase: (...args: unknown[]) => mockUpdatePhase(...args),
  recordCycle: () => mockRecordCycle(),
  insertCycle: (...args: unknown[]) => mockInsertCycle(...args),
}));
vi.mock("../../agent/db/repos/sessions.js", () => ({
  createSession: (...args: unknown[]) => mockCreateSessionRepo(...args),
  setScope: (...args: unknown[]) => mockSetScope(...args),
}));
vi.mock("../../agent/session-lock.js", () => ({
  withSessionLock: (_id: string, fn: () => Promise<void>) => fn(),
}));
vi.mock("../../agent/resilience.js", () => ({
  withTimeout: (p: Promise<void>) => p,
}));
vi.mock("../../agent/prompts/loop-phases.js", () => ({
  buildPhasePrompt: (phase: string) => `[${phase} prompt]`,
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { startEchoLoop, stopEchoLoop, isLoopRunning, setLoopBroadcast } = await import(
  "../../agent/echo-loop.js"
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();

  mockGetLoopState.mockResolvedValue({
    active: true, mode: "full", intervalMs: 300000,
    cycleCount: 0, loopSessionId: null,
    currentPhase: "idle", phaseStartedAt: null,
    startedAt: null, lastCycleAt: null,
  });
  mockCreateSession.mockReturnValue({
    id: "loop-session-1", messages: [], loadedKnowledge: new Map(),
    inferenceConfig: { provider: "test", model: "test", endpoint: "http://test", contextLimit: 65000, inputPricePerM: 1, outputPricePerM: 1, priceCurrency: "USD" },
  });
  mockHydrateSession.mockResolvedValue(null);
  mockStartLoop.mockResolvedValue(undefined);
  mockStopLoop.mockResolvedValue(undefined);
  mockSetLoopSessionId.mockResolvedValue(undefined);
  mockUpdatePhase.mockResolvedValue(undefined);
  mockRecordCycle.mockResolvedValue(undefined);
  mockInsertCycle.mockResolvedValue(undefined);
  mockCreateSessionRepo.mockResolvedValue(undefined);
  mockSetScope.mockResolvedValue(undefined);
  mockConsumeAll.mockResolvedValue([]);
  mockFormatEventsForContext.mockReturnValue("");
  mockGetInferenceConfig.mockReturnValue({ model: "test" });
});

afterEach(async () => {
  await stopEchoLoop();
  vi.useRealTimers();
});

describe("startEchoLoop / stopEchoLoop / isLoopRunning", () => {
  it("starts loop and sets running state", async () => {
    await startEchoLoop("full", 300_000);
    expect(isLoopRunning()).toBe(true);
    expect(mockStartLoop).toHaveBeenCalledWith("full", 300_000);
  });

  it("stops loop and clears timer", async () => {
    await startEchoLoop("full", 300_000);
    await stopEchoLoop();
    expect(isLoopRunning()).toBe(false);
    expect(mockStopLoop).toHaveBeenCalled();
  });

  it("creates new session when no existing loop session", async () => {
    await startEchoLoop("full", 300_000);
    expect(mockCreateSessionRepo).toHaveBeenCalled();
    expect(mockSetLoopSessionId).toHaveBeenCalledWith("loop-session-1");
  });

  it("restores existing session if available", async () => {
    const existingSession = {
      id: "existing-loop-session",
      messages: [{ role: "user", content: "prev" }],
      loadedKnowledge: new Map(),
      inferenceConfig: { model: "test" },
    };
    mockGetLoopState.mockResolvedValue({
      active: true, mode: "full", intervalMs: 300000,
      cycleCount: 5, loopSessionId: "existing-loop-session",
    });
    mockHydrateSession.mockResolvedValue(existingSession);

    await startEchoLoop("full", 300_000);
    expect(mockSetLoopSessionId).toHaveBeenCalledWith("existing-loop-session");
  });

  it("does not start when session creation fails", async () => {
    mockCreateSession.mockReturnValue(null);
    mockHydrateSession.mockResolvedValue(null);
    await startEchoLoop("full", 300_000);
    expect(isLoopRunning()).toBe(false);
  });
});

describe("cycle execution", () => {
  it("executes sense → assess → decide → execute → verify → journal phases", async () => {
    const phaseOutputs: string[] = [];
    mockProcessMessage.mockImplementation((_s: unknown, prompt: string, emit: Function) => {
      // Simulate text response for each phase
      emit({ type: "text_delta", data: { text: `result for ${prompt}` } });
      emit({ type: "done", data: {} });
      phaseOutputs.push(prompt);
      return Promise.resolve();
    });

    await startEchoLoop("full", 100);
    await vi.advanceTimersByTimeAsync(150);

    // Verify phases were executed
    expect(mockUpdatePhase).toHaveBeenCalledWith("sense");
    expect(mockUpdatePhase).toHaveBeenCalledWith("journal");
    expect(mockUpdatePhase).toHaveBeenCalledWith("sleep");
  });

  it("short-circuits to journal when sense returns quiet marker", async () => {
    mockProcessMessage.mockImplementation((_s: unknown, prompt: string, emit: Function) => {
      if (prompt.includes("sense")) {
        emit({ type: "text_delta", data: { text: "[no significant changes]" } });
      } else {
        emit({ type: "text_delta", data: { text: "journaled" } });
      }
      emit({ type: "done", data: {} });
      return Promise.resolve();
    });

    await startEchoLoop("full", 100);
    await vi.advanceTimersByTimeAsync(150);

    // Should NOT have called assess/decide/execute phases
    const phaseUpdateCalls = mockUpdatePhase.mock.calls.map((c: unknown[]) => c[0]);
    expect(phaseUpdateCalls).toContain("sense");
    expect(phaseUpdateCalls).toContain("journal");
    expect(phaseUpdateCalls).not.toContain("execute");
  });

  it("injects inbox events in sense phase", async () => {
    mockConsumeAll.mockResolvedValue([{ eventType: "external_alert", payload: { message: "test" } }]);
    mockFormatEventsForContext.mockReturnValue("--- Events ---\n[ALERT] test");

    mockProcessMessage.mockImplementation((_s: unknown, prompt: string, emit: Function) => {
      emit({ type: "text_delta", data: { text: "[no significant changes]" } });
      emit({ type: "done", data: {} });
      return Promise.resolve();
    });

    await startEchoLoop("full", 100);
    await vi.advanceTimersByTimeAsync(150);

    // Sense phase prompt should include events
    const senseCall = mockProcessMessage.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Events"),
    );
    expect(senseCall).toBeTruthy();
  });
});
