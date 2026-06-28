/**
 * Ambient auto-check scheduler (M13 follow-up). Verifies the guards: feed gate,
 * quiet-state guard, persisted success throttle, focus debounce, and the
 * in-memory failure backoff. Auto-check never downloads — this only governs
 * WHEN checkForUpdates runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let isPackaged = true;
vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return isPackaged;
    },
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

let currentKind = "idle";
vi.mock("../statusCache.js", () => ({
  getCurrentStatus: () => ({ kind: currentKind, currentVersion: "1.0.0" }),
}));

let lastCheckedAt: string | null = null;
vi.mock("../../preferences/store.js", () => ({
  preferencesStore: { load: async () => ({ updater: { lastCheckedAt } }) },
}));

const silentCheck = vi.fn(async () => true);
vi.mock("../updateActions.js", () => ({ silentCheck: () => silentCheck() }));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { maybeAutoCheck, __resetAutoCheckForTests } = await import(
  "../autoCheck.js"
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-28T12:00:00Z"));
  isPackaged = true;
  currentKind = "idle";
  lastCheckedAt = null;
  silentCheck.mockReset();
  silentCheck.mockResolvedValue(true);
  __resetAutoCheckForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("maybeAutoCheck", () => {
  it("skips when no feed is configured (plain dev)", async () => {
    isPackaged = false;
    await maybeAutoCheck("startup");
    expect(silentCheck).not.toHaveBeenCalled();
  });

  it("runs when feed configured, quiet, and no prior check", async () => {
    await maybeAutoCheck("startup");
    expect(silentCheck).toHaveBeenCalledTimes(1);
  });

  it("skips from an actionable state (downloaded)", async () => {
    currentKind = "downloaded";
    await maybeAutoCheck("focus");
    expect(silentCheck).not.toHaveBeenCalled();
  });

  it("skips within the success throttle (recent lastCheckedAt)", async () => {
    lastCheckedAt = new Date().toISOString();
    await maybeAutoCheck("focus");
    expect(silentCheck).not.toHaveBeenCalled();
  });

  it("runs once lastCheckedAt is older than the throttle window", async () => {
    lastCheckedAt = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    await maybeAutoCheck("focus");
    expect(silentCheck).toHaveBeenCalledTimes(1);
  });

  it("debounces focus bursts within 60s", async () => {
    await maybeAutoCheck("focus");
    vi.advanceTimersByTime(30_000);
    await maybeAutoCheck("focus");
    expect(silentCheck).toHaveBeenCalledTimes(1);
  });

  it("backs off after a failure (no retry within the backoff window)", async () => {
    silentCheck.mockResolvedValue(false);
    await maybeAutoCheck("startup"); // fails -> backoff armed
    expect(silentCheck).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * 60 * 1000); // 2 min: past 60s debounce, within 20m backoff
    await maybeAutoCheck("focus");
    expect(silentCheck).toHaveBeenCalledTimes(1);
  });
});
