/**
 * Backoff gate tests for the wallet private-key export throttle.
 *
 * Uses vi.useFakeTimers() to drive Date.now() because the module reads time
 * via the global Date constructor. Mirrors the unlock-throttle test pattern
 * — same fake-time idiom, shorter plateau (max 30s).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkExportAllowed,
  recordExportFailure,
  recordExportSuccess,
  resetExportThrottle,
} from "../export-throttle.js";

const T0 = new Date("2026-01-01T00:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  resetExportThrottle();
});

afterEach(() => {
  resetExportThrottle();
  vi.useRealTimers();
});

describe("checkExportAllowed", () => {
  it("returns allowed=true at rest", () => {
    expect(checkExportAllowed()).toEqual({ allowed: true });
  });

  it("returns allowed=false with retryAfterMs immediately after a failure", () => {
    recordExportFailure();
    const gate = checkExportAllowed();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.retryAfterMs).toBe(1_000);
      // First failure has not yet reached the 5-strike lockout.
      expect(gate.lockoutTriggered).toBe(false);
    }
  });

  it("flags lockoutTriggered=true once the gate is closed at >= EXPORT_FAIL_LIMIT", () => {
    for (let i = 0; i < 5; i += 1) {
      vi.setSystemTime(T0);
      recordExportFailure();
    }
    const gate = checkExportAllowed();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.lockoutTriggered).toBe(true);
      expect(gate.retryAfterMs).toBe(30_000);
    }
  });
});

describe("backoff schedule", () => {
  const expectBackoff = (afterCalls: number, expectedMs: number): void => {
    resetExportThrottle();
    vi.setSystemTime(T0);
    for (let i = 0; i < afterCalls; i += 1) {
      // Re-arm at T0 each iteration so the final retryAfterMs is unambiguous.
      vi.setSystemTime(T0);
      recordExportFailure();
    }
    const gate = checkExportAllowed();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.retryAfterMs).toBe(expectedMs);
    }
  };

  it("1st failure → 1s", () => {
    expectBackoff(1, 1_000);
  });
  it("2nd failure → 2s", () => {
    expectBackoff(2, 2_000);
  });
  it("3rd failure → 4s", () => {
    expectBackoff(3, 4_000);
  });
  it("4th failure → 8s", () => {
    expectBackoff(4, 8_000);
  });
  it("5th failure → 30s (lockout plateau begins)", () => {
    expectBackoff(5, 30_000);
  });
  it("7th failure → 30s (plateau holds)", () => {
    expectBackoff(7, 30_000);
  });
  it("15th failure → 30s (plateau still holds, no escalation)", () => {
    expectBackoff(15, 30_000);
  });
});

describe("recordExportFailure lockoutTriggered flag", () => {
  it("returns lockoutTriggered=false on failures 1..4", () => {
    expect(recordExportFailure().lockoutTriggered).toBe(false);
    vi.setSystemTime(T0);
    expect(recordExportFailure().lockoutTriggered).toBe(false);
    vi.setSystemTime(T0);
    expect(recordExportFailure().lockoutTriggered).toBe(false);
    vi.setSystemTime(T0);
    expect(recordExportFailure().lockoutTriggered).toBe(false);
  });

  it("returns lockoutTriggered=true on the 5th failure", () => {
    for (let i = 0; i < 4; i += 1) {
      vi.setSystemTime(T0);
      const r = recordExportFailure();
      expect(r.lockoutTriggered).toBe(false);
    }
    vi.setSystemTime(T0);
    const fifth = recordExportFailure();
    expect(fifth.lockoutTriggered).toBe(true);
  });

  it("keeps reporting lockoutTriggered=true on 6th+ failure within the same process lifetime", () => {
    for (let i = 0; i < 5; i += 1) {
      vi.setSystemTime(T0);
      recordExportFailure();
    }
    vi.setSystemTime(T0);
    expect(recordExportFailure().lockoutTriggered).toBe(true);
  });
});

describe("recordExportSuccess resets the counter", () => {
  it("clears the gate even after multiple failures", () => {
    recordExportFailure();
    recordExportFailure();
    recordExportFailure();
    recordExportSuccess();
    expect(checkExportAllowed()).toEqual({ allowed: true });
  });

  it("restarts backoff from 1s on the next failure", () => {
    for (let i = 0; i < 3; i += 1) recordExportFailure();
    recordExportSuccess();

    vi.setSystemTime(T0);
    recordExportFailure();
    const gate = checkExportAllowed();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.retryAfterMs).toBe(1_000);
      expect(gate.lockoutTriggered).toBe(false);
    }
  });

  it("clears the lockoutTriggered flag", () => {
    for (let i = 0; i < 5; i += 1) {
      vi.setSystemTime(T0);
      recordExportFailure();
    }
    recordExportSuccess();
    expect(checkExportAllowed()).toEqual({ allowed: true });
  });
});

describe("time advancement", () => {
  it("returns allowed=true after retryAfterMs elapses", () => {
    recordExportFailure();
    vi.setSystemTime(T0.getTime() + 1_001);
    expect(checkExportAllowed()).toEqual({ allowed: true });
  });

  it("still blocks while inside the window", () => {
    recordExportFailure();
    vi.setSystemTime(T0.getTime() + 500);
    const gate = checkExportAllowed();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.retryAfterMs).toBe(500);
    }
  });

  it("after the 30s lockout plateau elapses, fresh check is allowed", () => {
    for (let i = 0; i < 5; i += 1) recordExportFailure();
    // Advance just past the 30s window (last failure's arm point is "now").
    vi.setSystemTime(Date.now() + 30_001);
    expect(checkExportAllowed()).toEqual({ allowed: true });
  });
});

describe("resetExportThrottle (test helper)", () => {
  it("clears all state including the lockout flag", () => {
    for (let i = 0; i < 5; i += 1) recordExportFailure();
    resetExportThrottle();
    expect(checkExportAllowed()).toEqual({ allowed: true });
  });
});
