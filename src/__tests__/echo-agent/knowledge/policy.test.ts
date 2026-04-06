import { describe, it, expect } from "vitest";
import {
  DEFAULT_TTL_HOURS,
  MIN_TTL_HOURS,
  MAX_TTL_HOURS,
  computeValidUntil,
  clampTtlHours,
  isKnowledgeStatus,
  isUpdatableKnowledgeStatus,
  isValidKind,
  MAX_KIND_LENGTH,
  RECALL_DEFAULT_K,
  RECALL_MAX_K,
  RECALL_INLINE_CAP,
  RECALL_INLINE_CHARS_CAP,
  RECALL_CACHE_TTL_MIN,
  RECALL_CACHE_FOLDER,
  RECALL_CACHE_SPACE,
  KNOWN_KINDS_LIMIT,
  clampRecallK,
} from "@echo-agent/knowledge/policy.js";

describe("policy", () => {
  // ── TTL constants ────────────────────────────────────────────

  describe("TTL constants", () => {
    it("default TTL is 7 days in hours", () => {
      expect(DEFAULT_TTL_HOURS).toBe(7 * 24);
    });

    it("bounds are sane", () => {
      expect(MIN_TTL_HOURS).toBe(1);
      expect(MAX_TTL_HOURS).toBe(365 * 24);
    });
  });

  // ── computeValidUntil ────────────────────────────────────────

  describe("computeValidUntil", () => {
    const now = new Date("2026-04-06T12:00:00Z");

    it("returns null for pinned regardless of override", () => {
      expect(computeValidUntil(undefined, true, now)).toBeNull();
      expect(computeValidUntil(48, true, now)).toBeNull();
      expect(computeValidUntil(0, true, now)).toBeNull();
    });

    it("uses default TTL when override missing and not pinned", () => {
      const result = computeValidUntil(undefined, false, now);
      expect(result).toEqual(new Date("2026-04-13T12:00:00Z"));
    });

    it("uses override hours when provided", () => {
      const result = computeValidUntil(24, false, now);
      expect(result).toEqual(new Date("2026-04-07T12:00:00Z"));
    });

    it("clamps override below minimum", () => {
      const result = computeValidUntil(0, false, now);
      expect(result).toEqual(new Date("2026-04-06T13:00:00Z")); // 1 hour
    });

    it("clamps override above maximum", () => {
      const result = computeValidUntil(99999, false, now);
      const oneYearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      expect(result).toEqual(oneYearLater);
    });
  });

  // ── clampTtlHours ────────────────────────────────────────────

  describe("clampTtlHours", () => {
    it("returns input when within bounds", () => {
      expect(clampTtlHours(24)).toBe(24);
      expect(clampTtlHours(168)).toBe(168);
    });

    it("clamps below minimum", () => {
      expect(clampTtlHours(0)).toBe(MIN_TTL_HOURS);
      expect(clampTtlHours(-50)).toBe(MIN_TTL_HOURS);
    });

    it("clamps above maximum", () => {
      expect(clampTtlHours(MAX_TTL_HOURS + 1)).toBe(MAX_TTL_HOURS);
      expect(clampTtlHours(99999999)).toBe(MAX_TTL_HOURS);
    });

    it("returns default for non-finite", () => {
      expect(clampTtlHours(NaN)).toBe(DEFAULT_TTL_HOURS);
      expect(clampTtlHours(Infinity)).toBe(DEFAULT_TTL_HOURS);
    });

    it("floors fractional hours", () => {
      expect(clampTtlHours(2.7)).toBe(2);
    });
  });

  // ── isKnowledgeStatus ────────────────────────────────────────

  describe("isKnowledgeStatus", () => {
    it("accepts valid statuses", () => {
      expect(isKnowledgeStatus("active")).toBe(true);
      expect(isKnowledgeStatus("superseded")).toBe(true);
      expect(isKnowledgeStatus("invalidated")).toBe(true);
      expect(isKnowledgeStatus("archived")).toBe(true);
    });

    it("rejects invalid", () => {
      expect(isKnowledgeStatus("draft")).toBe(false);
      expect(isKnowledgeStatus("")).toBe(false);
      expect(isKnowledgeStatus(null)).toBe(false);
      expect(isKnowledgeStatus(42)).toBe(false);
    });
  });

  // ── isUpdatableKnowledgeStatus ───────────────────────────────

  describe("isUpdatableKnowledgeStatus", () => {
    it("accepts only invalidated/archived (post fix 4)", () => {
      expect(isUpdatableKnowledgeStatus("invalidated")).toBe(true);
      expect(isUpdatableKnowledgeStatus("archived")).toBe(true);
    });

    it("rejects active (cannot transition back to active)", () => {
      expect(isUpdatableKnowledgeStatus("active")).toBe(false);
    });

    it("rejects superseded (collapsed in MVP — schema enum keeps it for future steward, tool surface does not expose it)", () => {
      expect(isUpdatableKnowledgeStatus("superseded")).toBe(false);
    });

    it("rejects garbage", () => {
      expect(isUpdatableKnowledgeStatus("draft")).toBe(false);
      expect(isUpdatableKnowledgeStatus(undefined)).toBe(false);
    });
  });

  // ── isValidKind ──────────────────────────────────────────────

  describe("isValidKind", () => {
    it("accepts valid snake_case English kinds", () => {
      expect(isValidKind("memo")).toBe(true);
      expect(isValidKind("strategy_rule")).toBe(true);
      expect(isValidKind("pumpfun_entry_pattern")).toBe(true);
      expect(isValidKind("a")).toBe(true);
      expect(isValidKind("kind_with_3_numbers_42")).toBe(true);
    });

    it("rejects camelCase", () => {
      expect(isValidKind("pumpFun")).toBe(false);
      expect(isValidKind("strategyRule")).toBe(false);
    });

    it("rejects kebab-case", () => {
      expect(isValidKind("pump-fun")).toBe(false);
      expect(isValidKind("strategy-rule")).toBe(false);
    });

    it("rejects PascalCase", () => {
      expect(isValidKind("Pump_Fun")).toBe(false);
      expect(isValidKind("StrategyRule")).toBe(false);
    });

    it("rejects leading digit or underscore", () => {
      expect(isValidKind("1pump")).toBe(false);
      expect(isValidKind("_memo")).toBe(false);
    });

    it("rejects non-ASCII", () => {
      expect(isValidKind("pumpfün")).toBe(false);
      expect(isValidKind("禁忌")).toBe(false);
    });

    it("rejects empty and oversize", () => {
      expect(isValidKind("")).toBe(false);
      expect(isValidKind("a".repeat(MAX_KIND_LENGTH + 1))).toBe(false);
    });

    it("accepts exactly max length", () => {
      expect(isValidKind("a".repeat(MAX_KIND_LENGTH))).toBe(true);
    });

    it("rejects whitespace", () => {
      expect(isValidKind("memo entry")).toBe(false);
      expect(isValidKind(" memo")).toBe(false);
    });
  });

  // ── recall constants ─────────────────────────────────────────

  describe("recall constants", () => {
    it("default and max k", () => {
      expect(RECALL_DEFAULT_K).toBe(8);
      expect(RECALL_MAX_K).toBe(15);
    });

    it("inline cap is 10 entries", () => {
      expect(RECALL_INLINE_CAP).toBe(10);
    });

    it("inline chars cap is 50_000", () => {
      expect(RECALL_INLINE_CHARS_CAP).toBe(50_000);
    });

    it("cache TTL is 15 minutes", () => {
      expect(RECALL_CACHE_TTL_MIN).toBe(15);
    });

    it("cache folder and space", () => {
      expect(RECALL_CACHE_FOLDER).toBe("tmp/retrieval");
      expect(RECALL_CACHE_SPACE).toBe("cache");
    });

    it("known kinds limit is 30", () => {
      expect(KNOWN_KINDS_LIMIT).toBe(30);
    });
  });

  // ── clampRecallK ─────────────────────────────────────────────

  describe("clampRecallK", () => {
    it("returns default when undefined", () => {
      expect(clampRecallK(undefined)).toBe(RECALL_DEFAULT_K);
    });

    it("returns input when within bounds", () => {
      expect(clampRecallK(5)).toBe(5);
      expect(clampRecallK(10)).toBe(10);
      expect(clampRecallK(15)).toBe(15);
    });

    it("clamps above max", () => {
      expect(clampRecallK(99)).toBe(RECALL_MAX_K);
    });

    it("returns default for invalid", () => {
      expect(clampRecallK(0)).toBe(RECALL_DEFAULT_K);
      expect(clampRecallK(-1)).toBe(RECALL_DEFAULT_K);
      expect(clampRecallK(NaN)).toBe(RECALL_DEFAULT_K);
    });

    it("floors fractional", () => {
      expect(clampRecallK(7.9)).toBe(7);
    });
  });
});
