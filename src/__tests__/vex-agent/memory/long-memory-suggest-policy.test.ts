/**
 * Unit tests for the long-memory suggest policy — the pure, deterministic
 * system-field derivation the S2 boundary stamps on an accepted candidate.
 *
 * These cover the locked owner decisions: the source tier is a fixed floor,
 * sensitivity flips only on a residual masked address, the dual-trace window is
 * exactly seven days, and candidate retention is left for a later decision.
 */

import { describe, it, expect } from "vitest";

import {
  CANDIDATE_DUAL_TRACE_TTL_DAYS,
  SUGGEST_REJECT_REASONS,
  deriveCandidateSource,
  deriveCandidateSensitivity,
  computeRetrievalUntil,
} from "@vex-agent/memory/long-memory-suggest-policy.js";

describe("long-memory suggest policy", () => {
  it("always derives the hypothesis source floor", () => {
    expect(deriveCandidateSource()).toBe("hypothesis");
  });

  it("marks a candidate sensitive only when a masked address remains", () => {
    expect(deriveCandidateSensitivity(0)).toBe("normal");
    expect(deriveCandidateSensitivity(1)).toBe("sensitive");
    expect(deriveCandidateSensitivity(5)).toBe("sensitive");
  });

  it("treats a non-positive mask count as normal", () => {
    expect(deriveCandidateSensitivity(0)).toBe("normal");
  });

  it("opens the dual-trace window exactly seven days after the recorded time", () => {
    expect(CANDIDATE_DUAL_TRACE_TTL_DAYS).toBe(7);
    const recordedAt = new Date("2026-06-08T12:00:00.000Z");
    const retrievalUntil = computeRetrievalUntil(recordedAt);
    expect(retrievalUntil.toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });

  it("does not mutate the recorded-at date it is given", () => {
    const recordedAt = new Date("2026-06-08T12:00:00.000Z");
    const before = recordedAt.getTime();
    computeRetrievalUntil(recordedAt);
    expect(recordedAt.getTime()).toBe(before);
  });

  it("exposes a single bounded reject reason for the security boundary", () => {
    expect(SUGGEST_REJECT_REASONS).toEqual(["secret_or_live_state"]);
  });
});
