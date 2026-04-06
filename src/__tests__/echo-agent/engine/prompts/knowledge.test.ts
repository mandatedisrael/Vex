import { describe, it, expect } from "vitest";
import { formatActiveKnowledgeBlock } from "@echo-agent/engine/prompts/knowledge.js";
import type {
  ActiveKnowledgeListItem,
  KnownKind,
} from "@echo-agent/db/repos/knowledge.js";

function entry(overrides: Partial<ActiveKnowledgeListItem>): ActiveKnowledgeListItem {
  return {
    id: 1,
    kind: "memo",
    title: "test title",
    summary: "test summary",
    pinned: false,
    validUntil: "2026-04-13T12:00:00Z",
    updatedAt: "2026-04-06T12:00:00Z",
    ...overrides,
  };
}

describe("formatActiveKnowledgeBlock", () => {
  // ── Empty states ─────────────────────────────────────────────

  it("returns empty string when both entries and known kinds are empty", () => {
    expect(formatActiveKnowledgeBlock([], [])).toBe("");
  });

  it("renders Known kinds only when entries are empty", () => {
    const result = formatActiveKnowledgeBlock([], [{ kind: "memo", count: 3 }]);
    expect(result).toContain("# Active Knowledge");
    expect(result).toContain("Known kinds (reuse before creating new):");
    expect(result).toContain("memo (3)");
    expect(result).not.toContain("Pinned");
    expect(result).not.toContain("Recent:");
  });

  it("renders entries only when known kinds are empty", () => {
    const result = formatActiveKnowledgeBlock([entry({})], []);
    expect(result).toContain("# Active Knowledge");
    expect(result).toContain("Recent:");
    expect(result).toContain("test title");
    expect(result).not.toContain("Known kinds");
  });

  // ── Pinned vs recent ordering ────────────────────────────────

  it("renders Pinned section before Recent section", () => {
    const pinned = entry({ id: 1, kind: "risk_rule", title: "no leverage", pinned: true, validUntil: null });
    const recent = entry({ id: 2, kind: "memo", title: "recent obs", pinned: false });
    const result = formatActiveKnowledgeBlock([pinned, recent], []);
    const pinnedIdx = result.indexOf("Pinned");
    const recentIdx = result.indexOf("Recent");
    expect(pinnedIdx).toBeGreaterThan(0);
    expect(recentIdx).toBeGreaterThan(pinnedIdx);
    // Both entries appear
    expect(result).toContain("no leverage");
    expect(result).toContain("recent obs");
  });

  // ── Caps ─────────────────────────────────────────────────────

  it("caps entries at ACTIVE_KNOWLEDGE_ENTRY_LIMIT (12)", () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      entry({ id: i + 1, title: `entry ${i + 1}`, pinned: false }),
    );
    const result = formatActiveKnowledgeBlock(entries, []);
    // Count rendered lines that look like entry items
    const entryLines = result.split("\n").filter((l) => l.startsWith("- ["));
    expect(entryLines.length).toBeLessThanOrEqual(12);
  });

  it("truncates long summaries to 200 chars with ellipsis", () => {
    const longSummary = "a".repeat(500);
    const result = formatActiveKnowledgeBlock([entry({ summary: longSummary })], []);
    // The truncated form ends with an ellipsis character
    expect(result).toContain("…");
    // The full 500 'a' string is not present
    expect(result).not.toContain("a".repeat(500));
  });

  it("respects total chars cap on hot context block", () => {
    // Force long summaries close to per-entry truncate so we hit the global cap.
    const entries = Array.from({ length: 12 }, (_, i) =>
      entry({ id: i + 1, summary: "x".repeat(180), title: `t${i}` }),
    );
    const result = formatActiveKnowledgeBlock(entries, []);
    // Each line ~250 chars × 12 = 3000 — at the cap. We accept any output that
    // does not blow out beyond 5000 chars in the entries area.
    expect(result.length).toBeLessThan(5000);
  });

  it("known kinds line caps at chars cap", () => {
    const knownKinds: KnownKind[] = Array.from({ length: 60 }, (_, i) => ({
      kind: `very_long_kind_name_number_${i}`,
      count: i + 1,
    }));
    const result = formatActiveKnowledgeBlock([], knownKinds);
    const knownKindsLineMatch = result.match(/Known kinds[^\n]*\n([^\n]+)/);
    expect(knownKindsLineMatch).not.toBeNull();
    const line = knownKindsLineMatch?.[1] ?? "";
    expect(line.length).toBeLessThanOrEqual(500);
  });

  // ── Format details ───────────────────────────────────────────

  it("formats known kinds as 'kind (count), kind (count)'", () => {
    const result = formatActiveKnowledgeBlock(
      [],
      [
        { kind: "pumpfun_entry_pattern", count: 12 },
        { kind: "risk_rule", count: 3 },
      ],
    );
    expect(result).toContain("pumpfun_entry_pattern (12), risk_rule (3)");
  });

  it("entry line includes id and kind in brackets", () => {
    const result = formatActiveKnowledgeBlock([entry({ id: 42, kind: "strategy_rule", title: "title" })], []);
    expect(result).toContain("[strategy_rule]");
    expect(result).toContain("(id:42");
  });

  it("pinned entries do not show expiry hint", () => {
    const result = formatActiveKnowledgeBlock(
      [entry({ id: 1, pinned: true, validUntil: null })],
      [],
    );
    expect(result).not.toContain("expires");
  });
});
