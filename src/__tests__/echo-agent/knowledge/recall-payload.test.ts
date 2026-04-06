import { describe, it, expect } from "vitest";
import { splitInlineAndOverflow } from "@echo-agent/knowledge/recall-payload.js";
import {
  RECALL_INLINE_CAP,
  RECALL_INLINE_CHARS_CAP,
} from "@echo-agent/knowledge/policy.js";
import type { RankedRecallResult } from "@echo-agent/knowledge/ranking.js";

const NOW = new Date("2026-04-06T12:00:00Z");

function entry(id: number, contentChars: number, score = 0.5): RankedRecallResult {
  return {
    id,
    kind: "memo",
    title: `entry ${id}`,
    summary: "summary",
    contentMd: "x".repeat(contentChars),
    similarity: 0.5,
    confidence: null,
    status: "active",
    pinned: false,
    validUntil: null,
    validFrom: NOW,
    updatedAt: NOW,
    sourceRefs: {},
    tags: [],
    score,
  };
}

describe("splitInlineAndOverflow", () => {
  it("empty input → empty inline + empty overflow", () => {
    const result = splitInlineAndOverflow([]);
    expect(result.inline).toEqual([]);
    expect(result.overflow).toEqual([]);
  });

  it("k <= cap and small entries → all inline", () => {
    const entries = Array.from({ length: 5 }, (_, i) => entry(i + 1, 100));
    const result = splitInlineAndOverflow(entries);
    expect(result.inline).toHaveLength(5);
    expect(result.overflow).toHaveLength(0);
  });

  it("entry count > cap → first 10 inline, rest overflow", () => {
    const entries = Array.from({ length: 13 }, (_, i) => entry(i + 1, 100));
    const result = splitInlineAndOverflow(entries);
    expect(result.inline).toHaveLength(RECALL_INLINE_CAP);
    expect(result.overflow).toHaveLength(3);
    // Order preserved
    expect(result.inline.map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.overflow.map((e) => e.id)).toEqual([11, 12, 13]);
  });

  it("chars cap forces earlier split", () => {
    // Entry sizes that fit 4 in 50_000 chars but not 5
    const big = Math.floor(RECALL_INLINE_CHARS_CAP / 4) - 100;
    const entries = Array.from({ length: 8 }, (_, i) => entry(i + 1, big));
    const result = splitInlineAndOverflow(entries);
    // First 4 should fit, 5th would push us over → it goes to overflow
    expect(result.inline.length).toBeLessThanOrEqual(4);
    expect(result.inline.length + result.overflow.length).toBe(8);
  });

  it("first entry always inline even if alone busts the chars cap", () => {
    // Single huge entry > cap
    const huge = entry(1, RECALL_INLINE_CHARS_CAP * 2);
    const small1 = entry(2, 100);
    const small2 = entry(3, 100);
    const result = splitInlineAndOverflow([huge, small1, small2]);
    expect(result.inline).toHaveLength(1);
    expect(result.inline[0]?.id).toBe(1);
    // Subsequent entries go to overflow because the cap is already locked
    expect(result.overflow).toHaveLength(2);
    expect(result.overflow.map((e) => e.id)).toEqual([2, 3]);
  });

  it("once chars cap reached, all subsequent → overflow even if individually fit", () => {
    // Build a sequence where the 3rd entry pushes total over cap.
    // After that, even tiny entries go to overflow (deterministic split).
    const chunk = Math.floor(RECALL_INLINE_CHARS_CAP / 2) + 100;
    const a = entry(1, chunk); // inline (first)
    const b = entry(2, chunk); // would push over: a (chunk) + b (chunk) > cap → b overflow
    const c = entry(3, 50); // tiny, but cap locked → overflow
    const result = splitInlineAndOverflow([a, b, c]);
    expect(result.inline.map((e) => e.id)).toEqual([1]);
    expect(result.overflow.map((e) => e.id)).toEqual([2, 3]);
  });

  it("k=10 with all small entries → all 10 inline, no overflow", () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(i + 1, 100));
    const result = splitInlineAndOverflow(entries);
    expect(result.inline).toHaveLength(10);
    expect(result.overflow).toHaveLength(0);
  });

  it("preserves entry order in both halves", () => {
    const entries = Array.from({ length: 12 }, (_, i) => entry(100 + i, 200));
    const result = splitInlineAndOverflow(entries);
    expect(result.inline.map((e) => e.id)).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
    ]);
    expect(result.overflow.map((e) => e.id)).toEqual([110, 111]);
  });

  it("is deterministic for identical input", () => {
    const entries = Array.from({ length: 12 }, (_, i) => entry(i + 1, 500));
    const a = splitInlineAndOverflow(entries);
    const b = splitInlineAndOverflow(entries);
    expect(a.inline.map((e) => e.id)).toEqual(b.inline.map((e) => e.id));
    expect(a.overflow.map((e) => e.id)).toEqual(b.overflow.map((e) => e.id));
  });
});
