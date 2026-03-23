import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../agent/db/client.js", () => ({
  query: vi.fn(),
  execute: vi.fn(),
}));

import { query, execute } from "../../agent/db/client.js";
import {
  appendMemory,
  listEntriesWithIds,
  replaceEntry,
  deleteEntry,
} from "../../agent/db/repos/memory.js";

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockExecute = execute as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── listEntriesWithIds ──────────────────────────────────────────────

describe("listEntriesWithIds", () => {
  it("maps rows to MemoryEntry objects", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 1, content: "entry one", category: "TRADE", created_at: "2026-03-22T10:00:00Z" },
      { id: 2, content: "entry two", category: null, created_at: "2026-03-22T11:00:00Z" },
    ]);

    const entries = await listEntriesWithIds();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      id: 1,
      content: "entry one",
      category: "TRADE",
      createdAt: "2026-03-22T10:00:00Z",
    });
    expect(entries[1].category).toBeNull();
  });

  it("returns empty array when no entries", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const entries = await listEntriesWithIds();
    expect(entries).toHaveLength(0);
  });
});

// ── replaceEntry ────────────────────────────────────────────────────

describe("replaceEntry", () => {
  it("returns true when entry is found and replaced", async () => {
    mockExecute.mockResolvedValueOnce(1);
    const result = await replaceEntry(5, "updated content");
    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE"),
      ["updated content", 5],
    );
  });

  it("returns false when entry not found", async () => {
    mockExecute.mockResolvedValueOnce(0);
    const result = await replaceEntry(999, "content");
    expect(result).toBe(false);
  });

  it("returns false for invalid id (zero)", async () => {
    const result = await replaceEntry(0, "content");
    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns false for negative id", async () => {
    const result = await replaceEntry(-1, "content");
    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns false for empty content", async () => {
    const result = await replaceEntry(1, "");
    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns false for whitespace-only content", async () => {
    const result = await replaceEntry(1, "   ");
    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── deleteEntry ─────────────────────────────────────────────────────

describe("deleteEntry", () => {
  it("returns true when entry is deleted", async () => {
    mockExecute.mockResolvedValueOnce(1);
    const result = await deleteEntry(5);
    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE"),
      [5],
    );
  });

  it("returns false when entry not found", async () => {
    mockExecute.mockResolvedValueOnce(0);
    const result = await deleteEntry(999);
    expect(result).toBe(false);
  });

  it("returns false for invalid id (zero)", async () => {
    const result = await deleteEntry(0);
    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns false for negative id", async () => {
    const result = await deleteEntry(-1);
    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── appendMemory (existing, verify preserved) ───────────────────────

describe("appendMemory", () => {
  it("calls execute with INSERT", async () => {
    mockExecute.mockResolvedValueOnce(1);
    await appendMemory("test entry", "TRADE", "agent");
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO memory_entries"),
      ["test entry", "TRADE", "agent"],
    );
  });

  it("uses default source 'agent'", async () => {
    mockExecute.mockResolvedValueOnce(1);
    await appendMemory("test entry");
    expect(mockExecute).toHaveBeenCalledWith(
      expect.any(String),
      ["test entry", null, "agent"],
    );
  });
});
