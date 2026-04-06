import { describe, it, expect } from "vitest";
import { rerank, type RecallCandidate } from "@echo-agent/knowledge/ranking.js";

const NOW = new Date("2026-04-06T12:00:00Z");

function candidate(overrides: Partial<RecallCandidate>): RecallCandidate {
  return {
    id: 1,
    kind: "memo",
    title: "test",
    summary: "test summary",
    contentMd: "test content",
    similarity: 0.5,
    confidence: null,
    status: "active",
    pinned: false,
    validUntil: null,
    validFrom: NOW,
    updatedAt: NOW,
    sourceRefs: {},
    tags: [],
    ...overrides,
  };
}

describe("rerank", () => {
  // ── Determinism + ordering ───────────────────────────────────

  it("returns empty for empty input", () => {
    expect(rerank([], { now: NOW })).toEqual([]);
  });

  it("orders by combined score DESC", () => {
    const a = candidate({ id: 1, similarity: 0.9 });
    const b = candidate({ id: 2, similarity: 0.5 });
    const c = candidate({ id: 3, similarity: 0.7 });
    const result = rerank([a, b, c], { now: NOW });
    expect(result.map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it("is stable on equal scores (input order preserved)", () => {
    const a = candidate({ id: 1, similarity: 0.5 });
    const b = candidate({ id: 2, similarity: 0.5 });
    const c = candidate({ id: 3, similarity: 0.5 });
    const result = rerank([a, b, c], { now: NOW });
    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  // ── Status filter ────────────────────────────────────────────

  it("activeOnly=true (default) drops invalidated/archived/superseded", () => {
    const a = candidate({ id: 1, status: "active" });
    const b = candidate({ id: 2, status: "invalidated" });
    const c = candidate({ id: 3, status: "archived" });
    const d = candidate({ id: 4, status: "superseded" });
    const result = rerank([a, b, c, d], { now: NOW });
    expect(result.map((r) => r.id)).toEqual([1]);
  });

  it("activeOnly=false keeps all valid statuses", () => {
    const a = candidate({ id: 1, status: "active" });
    const b = candidate({ id: 2, status: "superseded" });
    const result = rerank([a, b], { now: NOW, activeOnly: false });
    expect(result).toHaveLength(2);
  });

  // ── k cap ────────────────────────────────────────────────────

  it("hard caps at RECALL_MAX_K (15)", () => {
    const candidates = Array.from({ length: 30 }, (_, i) =>
      candidate({ id: i + 1, similarity: 0.5 + (i / 100) }),
    );
    const result = rerank(candidates, { now: NOW, k: 100 });
    expect(result).toHaveLength(15);
  });

  it("uses default k (8) when not specified", () => {
    const candidates = Array.from({ length: 12 }, (_, i) => candidate({ id: i + 1 }));
    const result = rerank(candidates, { now: NOW });
    expect(result).toHaveLength(8);
  });

  it("respects explicit k <= max", () => {
    const candidates = Array.from({ length: 12 }, (_, i) => candidate({ id: i + 1 }));
    const result = rerank(candidates, { now: NOW, k: 5 });
    expect(result).toHaveLength(5);
  });

  // ── Boost contributions ──────────────────────────────────────

  it("pinned beats higher-similarity unpinned", () => {
    // pinned boost is 0.20; unpinned similarity diff of 0.1 should not overcome it
    const pinned = candidate({ id: 1, similarity: 0.6, pinned: true });
    const unpinned = candidate({ id: 2, similarity: 0.7, pinned: false });
    const result = rerank([unpinned, pinned], { now: NOW });
    expect(result[0]?.id).toBe(1);
  });

  it("recency boost prefers newer for equal similarity", () => {
    const old = candidate({
      id: 1,
      similarity: 0.5,
      updatedAt: new Date("2026-03-01T00:00:00Z"), // ~36 days old
    });
    const fresh = candidate({
      id: 2,
      similarity: 0.5,
      updatedAt: NOW,
    });
    const result = rerank([old, fresh], { now: NOW });
    expect(result[0]?.id).toBe(2);
  });

  it("confidence boost prefers higher confidence for equal similarity", () => {
    const lowConf = candidate({ id: 1, similarity: 0.5, confidence: 0.1 });
    const highConf = candidate({ id: 2, similarity: 0.5, confidence: 0.9 });
    const result = rerank([lowConf, highConf], { now: NOW });
    expect(result[0]?.id).toBe(2);
  });

  it("null confidence does not crash", () => {
    const a = candidate({ id: 1, confidence: null });
    const b = candidate({ id: 2, confidence: 0.5 });
    const result = rerank([a, b], { now: NOW });
    expect(result.every((r) => Number.isFinite(r.score))).toBe(true);
  });

  // ── No kind weight (regression guard) ────────────────────────

  it("does not boost or penalize based on kind value", () => {
    // Two candidates: identical except kind. Score must be identical.
    const a = candidate({ id: 1, kind: "risk_rule" });
    const b = candidate({ id: 2, kind: "memo" });
    const result = rerank([a, b], { now: NOW });
    expect(result[0]?.score).toBe(result[1]?.score);
  });

  // ── Score sanity ─────────────────────────────────────────────

  it("similarity is clamped to [0,1]", () => {
    const negative = candidate({ id: 1, similarity: -0.5 });
    const over = candidate({ id: 2, similarity: 1.5 });
    const result = rerank([negative, over], { now: NOW });
    expect(result.every((r) => r.score >= 0)).toBe(true);
  });

  it("score includes raw similarity component", () => {
    // No boosts beyond similarity itself
    const c = candidate({
      id: 1,
      similarity: 0.7,
      pinned: false,
      confidence: null,
      updatedAt: new Date("2020-01-01T00:00:00Z"), // very old, decay ≈ 0
    });
    const result = rerank([c], { now: NOW });
    // similarity 0.7 + tiny recency decay (negligible) + 0 confidence + 0 pinned
    expect(result[0]?.score).toBeGreaterThanOrEqual(0.7);
    expect(result[0]?.score).toBeLessThan(0.71); // recency decay near 0 after 6 years
  });
});
