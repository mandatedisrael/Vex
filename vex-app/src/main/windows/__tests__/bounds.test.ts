/**
 * Tests for first-run window sizing + BrowserWindow min-constraint
 * derivation. Pure helpers — no Electron runtime needed.
 *
 * Covers the edge case Codex flagged in plan review: workArea smaller
 * than the preferred absolute minimum (e.g. 800×600 monitor) must NOT
 * cause `minWidth > width` after `clampToVisibleArea`, which would make
 * `new BrowserWindow` throw.
 */

import { describe, expect, it } from "vitest";
import {
  computeFirstRunBounds,
  computeMinConstraints,
  isFirstRun,
} from "../bounds.js";

describe("computeFirstRunBounds", () => {
  it("clamps to MAX_W on 1920x1080 desktop", () => {
    expect(computeFirstRunBounds({ width: 1920, height: 1080 })).toEqual({
      width: 1600,
      height: 918,
    });
  });

  it("bumps height to SOFT_MIN and clamps to workArea on 1366x768 laptop", () => {
    expect(computeFirstRunBounds({ width: 1366, height: 768 })).toEqual({
      width: 1161,
      height: 768,
    });
  });

  it("clamps width to workArea on 1024x768 monitor", () => {
    expect(computeFirstRunBounds({ width: 1024, height: 768 })).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("falls back to ABSOLUTE_MIN for extreme tiny workArea", () => {
    expect(computeFirstRunBounds({ width: 800, height: 600 })).toEqual({
      width: 1000,
      height: 720,
    });
  });
});

describe("isFirstRun", () => {
  it("returns true when both x and y are null", () => {
    expect(isFirstRun({ width: 1280, height: 800, x: null, y: null })).toBe(
      true,
    );
  });

  it("returns false when both x and y are set", () => {
    expect(isFirstRun({ width: 1280, height: 800, x: 100, y: 50 })).toBe(false);
  });

  it("returns false when only one coordinate is set", () => {
    expect(isFirstRun({ width: 1280, height: 800, x: 100, y: null })).toBe(
      false,
    );
    expect(isFirstRun({ width: 1280, height: 800, x: null, y: 50 })).toBe(
      false,
    );
  });
});

describe("computeMinConstraints", () => {
  it("returns ABSOLUTE_MIN for normal-sized normalized bounds", () => {
    expect(computeMinConstraints({ width: 1600, height: 918 })).toEqual({
      minWidth: 1000,
      minHeight: 720,
    });
  });

  it("shrinks minWidth to bounds.width when width < ABSOLUTE_MIN_W", () => {
    expect(computeMinConstraints({ width: 800, height: 720 })).toEqual({
      minWidth: 800,
      minHeight: 720,
    });
  });

  it("shrinks minHeight to bounds.height when height < ABSOLUTE_MIN_H", () => {
    expect(computeMinConstraints({ width: 1200, height: 600 })).toEqual({
      minWidth: 1000,
      minHeight: 600,
    });
  });

  it("INVARIANT: minWidth/minHeight never exceed bounds.width/height", () => {
    const cases: ReadonlyArray<{ width: number; height: number }> = [
      { width: 500, height: 500 },
      { width: 999, height: 719 },
      { width: 1000, height: 720 },
      { width: 1600, height: 1000 },
    ];
    for (const c of cases) {
      const { minWidth, minHeight } = computeMinConstraints(c);
      expect(minWidth).toBeLessThanOrEqual(c.width);
      expect(minHeight).toBeLessThanOrEqual(c.height);
    }
  });
});
