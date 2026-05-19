import { describe, expect, it } from "vitest";
import { createReportDedupe } from "../report-dedupe.js";

describe("createReportDedupe", () => {
  it("drops duplicates inside the window", () => {
    let now = 1_000_000;
    const d = createReportDedupe({ windowMs: 1000, now: () => now });
    expect(d.shouldDrop({ category: "x", key: "a" })).toBe(false);
    now += 500;
    expect(d.shouldDrop({ category: "x", key: "a" })).toBe(true);
    expect(d.shouldDrop({ category: "x", key: "b" })).toBe(false);
  });

  it("admits duplicates after the window expires", () => {
    let now = 1_000_000;
    const d = createReportDedupe({ windowMs: 1000, now: () => now });
    d.shouldDrop({ category: "x", key: "a" });
    now += 1500;
    expect(d.shouldDrop({ category: "x", key: "a" })).toBe(false);
  });

  it("evicts old entries above maxEntries", () => {
    let now = 1_000_000;
    const d = createReportDedupe({ windowMs: 10_000, maxEntries: 3, now: () => now });
    d.shouldDrop({ category: "x", key: "a" });
    now += 1;
    d.shouldDrop({ category: "x", key: "b" });
    now += 1;
    d.shouldDrop({ category: "x", key: "c" });
    now += 1;
    expect(d.size()).toBe(3);
    d.shouldDrop({ category: "x", key: "d" });
    expect(d.size()).toBe(3);
    // Oldest (a) should have been evicted — fresh insert of a is NOT a drop.
    now += 1;
    expect(d.shouldDrop({ category: "x", key: "a" })).toBe(false);
  });

  it("scopes duplicates by category", () => {
    let now = 1_000_000;
    const d = createReportDedupe({ windowMs: 1000, now: () => now });
    d.shouldDrop({ category: "x", key: "a" });
    expect(d.shouldDrop({ category: "y", key: "a" })).toBe(false);
  });
});
