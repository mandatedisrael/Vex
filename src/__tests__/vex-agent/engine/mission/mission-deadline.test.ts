/**
 * Hard mission deadline — computed from the run's immutable started_at + the
 * FROZEN per-mission duration (default 60 min). Integer-minute contract for
 * both the per-mission field and the env override.
 */

import { describe, it, expect } from "vitest";
import {
  hardDeadlineMinutes,
  resolveDurationMinutes,
  computeHardDeadlineMs,
  frozenDurationMinutes,
  resolveFrozenDeadlineMs,
} from "../../../../vex-agent/engine/mission/mission-deadline.js";

describe("hardDeadlineMinutes", () => {
  it("defaults to 60 minutes with no override", () => {
    expect(hardDeadlineMinutes({})).toBe(60);
  });
  it("honors a valid VEX_MISSION_HARD_DEADLINE_MIN override (e.g. a 2-min test box)", () => {
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "2" })).toBe(2);
  });
  it("falls back to 60 on a non-numeric or non-positive override", () => {
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "abc" })).toBe(60);
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "0" })).toBe(60);
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "-5" })).toBe(60);
  });
  it("clamps absurdly large values to a 24h ceiling", () => {
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "99999" })).toBe(1440);
  });
  // Integer-minute contract: the env override is whole minutes only (matches
  // the per-mission `durationMinutes` field). A fractional value TRUNCATES;
  // a sub-1-minute value is rejected -> default. No fractional test boxes.
  it("truncates a fractional override to whole minutes", () => {
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "5.9" })).toBe(5);
  });
  it("rejects a sub-1-minute override (no fractional test box) -> default 60", () => {
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "0.5" })).toBe(60);
  });
});

describe("resolveDurationMinutes (per-mission > env > default)", () => {
  it("uses the mission's own durationMinutes when set and valid", () => {
    expect(resolveDurationMinutes(5, {})).toBe(5);
    expect(resolveDurationMinutes(10, { VEX_MISSION_HARD_DEADLINE_MIN: "60" })).toBe(10);
  });
  it("clamps an absurd per-mission value to the 24h ceiling", () => {
    expect(resolveDurationMinutes(99999, {})).toBe(1440);
  });
  it("falls back to the env override when the mission has no duration", () => {
    expect(resolveDurationMinutes(null, { VEX_MISSION_HARD_DEADLINE_MIN: "2" })).toBe(2);
    expect(resolveDurationMinutes(undefined, { VEX_MISSION_HARD_DEADLINE_MIN: "2" })).toBe(2);
  });
  it("falls back to 60 when neither mission nor env specifies one", () => {
    expect(resolveDurationMinutes(null, {})).toBe(60);
    expect(resolveDurationMinutes(0, {})).toBe(60);
    expect(resolveDurationMinutes(-5, {})).toBe(60);
  });
  it("truncates a fractional per-mission value to whole minutes", () => {
    expect(resolveDurationMinutes(5.9, {})).toBe(5);
  });
  it("rejects a sub-1-minute per-mission value -> env/default", () => {
    expect(resolveDurationMinutes(0.5, {})).toBe(60);
    expect(resolveDurationMinutes(0.5, { VEX_MISSION_HARD_DEADLINE_MIN: "2" })).toBe(2);
  });
});

describe("frozenDurationMinutes (reads the immutable run contract snapshot)", () => {
  it("reads frozenMission.draft.durationMinutes when present and positive", () => {
    expect(
      frozenDurationMinutes({ frozenMission: { draft: { durationMinutes: 5 } } }),
    ).toBe(5);
  });
  it("returns null for any missing/malformed level (fail-open -> env/default)", () => {
    expect(frozenDurationMinutes(null)).toBeNull();
    expect(frozenDurationMinutes(undefined)).toBeNull();
    expect(frozenDurationMinutes(42)).toBeNull();
    expect(frozenDurationMinutes({})).toBeNull();
    expect(frozenDurationMinutes({ frozenMission: null })).toBeNull();
    expect(frozenDurationMinutes({ frozenMission: {} })).toBeNull();
    expect(frozenDurationMinutes({ frozenMission: { draft: null } })).toBeNull();
    expect(frozenDurationMinutes({ frozenMission: { draft: {} } })).toBeNull();
    expect(
      frozenDurationMinutes({ frozenMission: { draft: { durationMinutes: null } } }),
    ).toBeNull();
    expect(
      frozenDurationMinutes({ frozenMission: { draft: { durationMinutes: 0 } } }),
    ).toBeNull();
  });
});

describe("resolveFrozenDeadlineMs (the single start+resume resolver)", () => {
  const start = "2026-01-01T00:00:00.000Z";
  const startMs = Date.parse(start);

  it("uses the frozen per-mission box when the snapshot has one", () => {
    expect(
      resolveFrozenDeadlineMs(start, { frozenMission: { draft: { durationMinutes: 5 } } }),
    ).toBe(startMs + 5 * 60_000);
  });
  it("falls back to the 60-min default when the snapshot has no durationMinutes", () => {
    expect(resolveFrozenDeadlineMs(start, { frozenMission: {} })).toBe(startMs + 60 * 60_000);
    expect(resolveFrozenDeadlineMs(start, null)).toBe(startMs + 60 * 60_000);
  });
  it("is fail-open (null) when started_at is missing or unparseable", () => {
    expect(resolveFrozenDeadlineMs(null, { frozenMission: { draft: { durationMinutes: 5 } } })).toBeNull();
    expect(resolveFrozenDeadlineMs(undefined, {})).toBeNull();
    expect(resolveFrozenDeadlineMs("not-a-date", {})).toBeNull();
  });
  it("re-derives the identical deadline on repeated calls (wake/resume stability)", () => {
    const snap = { frozenMission: { draft: { durationMinutes: 5 } } };
    expect(resolveFrozenDeadlineMs(start, snap)).toBe(resolveFrozenDeadlineMs(start, snap));
  });
});

describe("computeHardDeadlineMs", () => {
  it("is started_at + duration in epoch ms", () => {
    const start = "2026-07-12T19:00:00.000Z";
    const startMs = Date.parse(start);
    expect(computeHardDeadlineMs(start, 2)).toBe(startMs + 2 * 60_000);
    expect(computeHardDeadlineMs(start, 60)).toBe(startMs + 60 * 60_000);
  });
  it("returns null for an unparseable start (fail-open: no false deadline)", () => {
    expect(computeHardDeadlineMs("not-a-date", 60)).toBeNull();
  });
});
