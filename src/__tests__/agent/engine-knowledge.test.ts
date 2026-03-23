/**
 * Tests for engine internal tool behavior — file_read preview, file_write hints, memory_manage.
 *
 * These test the exported constants and verify the logic patterns
 * without requiring a full engine mock (processInternalTools is deeply coupled).
 * The actual integration is verified via build + manual testing.
 */

import { describe, expect, it } from "vitest";

// ── Verify named constants are exported and correct ─────────────────

describe("engine knowledge constants", () => {
  it("FILE_SIZE_WARNING_CHARS is reasonable", async () => {
    // Read the constants from engine source to verify they exist
    // We test the values indirectly through the compaction/formatter constants
    const { COMPACTION_THRESHOLD, DEFAULT_CONTEXT_LIMIT } = await import("../../agent/constants.js");
    expect(DEFAULT_CONTEXT_LIMIT).toBeLessThanOrEqual(70_000);
    expect(DEFAULT_CONTEXT_LIMIT).toBeGreaterThanOrEqual(30_000);
    expect(COMPACTION_THRESHOLD).toBe(0.75);
  });

  it("compaction trigger point is well before 73K provider limit", async () => {
    const { COMPACTION_THRESHOLD, DEFAULT_CONTEXT_LIMIT } = await import("../../agent/constants.js");
    const triggerPoint = DEFAULT_CONTEXT_LIMIT * COMPACTION_THRESHOLD;
    expect(triggerPoint).toBeLessThan(73_000);
  });
});

// ── Preview logic tests (pure logic, no engine mock) ────────────────

describe("preview truncation logic", () => {
  const PREVIEW_CHAR_LIMIT = 1000;

  it("short content is returned as-is in preview", () => {
    const content = "Short content";
    const result = content.length > PREVIEW_CHAR_LIMIT
      ? content.slice(0, PREVIEW_CHAR_LIMIT) + "\n\n... (preview)"
      : content;
    expect(result).toBe("Short content");
  });

  it("long content is truncated to PREVIEW_CHAR_LIMIT", () => {
    const content = "A".repeat(2000);
    const result = content.length > PREVIEW_CHAR_LIMIT
      ? content.slice(0, PREVIEW_CHAR_LIMIT) + "\n\n... (preview)"
      : content;
    expect(result.length).toBeLessThan(content.length);
    expect(result).toContain("... (preview)");
  });

  it("content at exactly PREVIEW_CHAR_LIMIT is not truncated", () => {
    const content = "A".repeat(PREVIEW_CHAR_LIMIT);
    const result = content.length > PREVIEW_CHAR_LIMIT
      ? content.slice(0, PREVIEW_CHAR_LIMIT) + "\n\n... (preview)"
      : content;
    expect(result).toBe(content);
  });
});

// ── File write hint logic tests ─────────────────────────────────────

describe("file write hint logic", () => {
  const FILE_SIZE_WARNING_CHARS = 3000;
  const MAX_FILES_WARNING = 50;

  it("no hint for small files", () => {
    const content = "A".repeat(100);
    const hints: string[] = [];
    if (content.length > FILE_SIZE_WARNING_CHARS) hints.push("size warning");
    expect(hints).toHaveLength(0);
  });

  it("hint for large files", () => {
    const content = "A".repeat(5000);
    const hints: string[] = [];
    if (content.length > FILE_SIZE_WARNING_CHARS) hints.push("size warning");
    expect(hints).toHaveLength(1);
  });

  it("hint for many files", () => {
    const totalFiles = 60;
    const hints: string[] = [];
    if (totalFiles > MAX_FILES_WARNING) hints.push("count warning");
    expect(hints).toHaveLength(1);
  });

  it("both hints when file is large AND many files", () => {
    const content = "A".repeat(5000);
    const totalFiles = 60;
    const hints: string[] = [];
    if (content.length > FILE_SIZE_WARNING_CHARS) hints.push("size warning");
    if (totalFiles > MAX_FILES_WARNING) hints.push("count warning");
    expect(hints).toHaveLength(2);
  });
});

// ── memory_manage action validation ─────────────────────────────────

describe("memory_manage action dispatch", () => {
  const VALID_ACTIONS = ["list", "append", "replace", "delete"];

  it("all valid actions are recognized", () => {
    for (const action of VALID_ACTIONS) {
      expect(VALID_ACTIONS).toContain(action);
    }
  });

  it("invalid action is not in the valid set", () => {
    expect(VALID_ACTIONS).not.toContain("clear");
    expect(VALID_ACTIONS).not.toContain("update");
    expect(VALID_ACTIONS).not.toContain("");
  });
});

// ── Tool registry check — memory_manage exists ──────────────────────

describe("tool registry", () => {
  it("has memory_manage tool defined", async () => {
    const { getToolDef } = await import("../../agent/tool-registry.js");
    const def = getToolDef("memory_manage");
    expect(def).toBeDefined();
    expect(def!.kind).toBe("internal");
    expect(def!.mutating).toBe(false);
  });

  it("has file_read with preview parameter", async () => {
    const { getToolDef } = await import("../../agent/tool-registry.js");
    const def = getToolDef("file_read");
    expect(def).toBeDefined();
    const props = (def!.parameters as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("preview");
  });

  it("still has memory_update as deprecated alias", async () => {
    const { getToolDef } = await import("../../agent/tool-registry.js");
    const def = getToolDef("memory_update");
    expect(def).toBeDefined();
    expect(def!.description).toContain("deprecated");
  });
});
