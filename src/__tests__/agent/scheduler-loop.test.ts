import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing scheduler
vi.mock("../../agent/db/repos/tasks.js", () => ({
  listTasks: vi.fn(async () => []),
  getEnabledTasks: vi.fn(async () => []),
  createTask: vi.fn(),
  recordRun: vi.fn(),
}));
vi.mock("../../agent/db/repos/loop.js", () => ({
  getLoopState: vi.fn(async () => ({ active: false, mode: "restricted", intervalMs: 300000 })),
  recordCycle: vi.fn(),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../agent/prompts/scheduler.js", () => ({
  buildScheduledAlertPrompt: vi.fn((msg: string) => `Alert: ${msg}`),
  getAutonomousLoopPrompt: vi.fn(() => "autonomous loop prompt"),
}));
vi.mock("../../agent/snapshot.js", () => ({
  takeSnapshot: vi.fn(async () => "snap-123"),
}));
vi.mock("../../agent/executor.js", () => ({
  isMutatingCommand: vi.fn(() => false),
}));
vi.mock("../../agent/tool-registry.js", () => ({
  supportsYes: vi.fn(() => false),
}));

import { startLoopEngine, stopLoopEngine, setInferenceHandler } from "../../agent/scheduler.js";

describe("loop engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopLoopEngine();
    vi.useRealTimers();
    setInferenceHandler(null);
  });

  it("starts and fires cycle at interval", async () => {
    const handler = vi.fn(async () => "done");
    setInferenceHandler(handler);

    startLoopEngine("restricted", 5000);

    // Advance past first interval
    await vi.advanceTimersByTimeAsync(5100);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("stops firing after stopLoopEngine", async () => {
    const handler = vi.fn(async () => "done");
    setInferenceHandler(handler);

    startLoopEngine("restricted", 5000);
    await vi.advanceTimersByTimeAsync(5100);
    expect(handler).toHaveBeenCalledTimes(1);

    stopLoopEngine();
    await vi.advanceTimersByTimeAsync(10000);
    expect(handler).toHaveBeenCalledTimes(1); // no additional calls
  });

  it("skips cycle when no inference handler", async () => {
    setInferenceHandler(null);
    startLoopEngine("restricted", 5000);
    await vi.advanceTimersByTimeAsync(5100);
    // Should not throw, just skip
  });

  it("handles cycle error without stopping loop", async () => {
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error("inference failed"))
      .mockResolvedValueOnce("ok");
    setInferenceHandler(handler);

    startLoopEngine("restricted", 5000);

    // First cycle — fails
    await vi.advanceTimersByTimeAsync(5100);
    expect(handler).toHaveBeenCalledTimes(1);

    // Second cycle — succeeds (loop didn't stop)
    await vi.advanceTimersByTimeAsync(5100);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
