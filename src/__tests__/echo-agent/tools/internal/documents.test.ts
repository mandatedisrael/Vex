import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock repos
const mockGetDocument = vi.fn();
const mockUpsertDocument = vi.fn();
const mockListDocuments = vi.fn().mockResolvedValue([]);
const mockSoftDelete = vi.fn().mockResolvedValue(true);
const mockCountDocuments = vi.fn().mockResolvedValue(3);
const mockGetFolderBySlug = vi.fn().mockResolvedValue(null);
const mockCreateFolder = vi.fn();
const mockListFolders = vi.fn().mockResolvedValue([]);

vi.mock("@echo-agent/db/repos/documents.js", () => ({
  getDocument: (...args: unknown[]) => mockGetDocument(...args),
  upsertDocument: (...args: unknown[]) => mockUpsertDocument(...args),
  listDocuments: (...args: unknown[]) => mockListDocuments(...args),
  softDeleteDocument: (...args: unknown[]) => mockSoftDelete(...args),
  countDocuments: (...args: unknown[]) => mockCountDocuments(...args),
}));

vi.mock("@echo-agent/db/repos/folders.js", () => ({
  getFolderBySlug: (...args: unknown[]) => mockGetFolderBySlug(...args),
  createFolder: (...args: unknown[]) => mockCreateFolder(...args),
  listFolders: (...args: unknown[]) => mockListFolders(...args),
}));

const {
  handleDocumentRead,
  handleDocumentWrite,
  handleDocumentList,
  handleDocumentDelete,
} = await import("../../../../echo-agent/tools/internal/documents.js");

import { makeTestContext } from "../_test-context.js";

function makeContext() {
  return makeTestContext();
}

describe("document handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDocument.mockResolvedValue(null);
    mockUpsertDocument.mockResolvedValue({
      id: 1, space: "notes", folderId: null, title: "Test", slug: "test",
      contentMd: "content", sizeBytes: 7, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
    });
  });

  // ── document_read ─────────────────────────────────────────────────

  describe("handleDocumentRead", () => {
    it("fails on missing slug", async () => {
      const result = await handleDocumentRead({}, makeContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("slug");
    });

    it("returns not found for missing document", async () => {
      const result = await handleDocumentRead({ slug: "nonexistent" }, makeContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("Not found");
    });

    it("returns preview without loading into context", async () => {
      mockGetDocument.mockResolvedValueOnce({
        id: 1, space: "notes", folderId: null, title: "Test", slug: "test",
        contentMd: "A".repeat(2000), sizeBytes: 2000, createdAt: "2024-01-01", updatedAt: "2024-01-01",
      });

      const ctx = makeContext();
      const result = await handleDocumentRead({ slug: "test", preview: true }, ctx);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.preview.length).toBeLessThan(2000);
      expect(parsed.preview).toContain("preview");
      expect(ctx.loadedDocuments.size).toBe(0);
    });

    it("loads full document into context", async () => {
      mockGetDocument.mockResolvedValueOnce({
        id: 1, space: "notes", folderId: null, title: "Test", slug: "test",
        contentMd: "full content", sizeBytes: 12, createdAt: "2024-01-01", updatedAt: "2024-01-01",
      });

      const ctx = makeContext();
      const result = await handleDocumentRead({ slug: "test" }, ctx);
      expect(result.success).toBe(true);
      expect(ctx.loadedDocuments.get("test")).toBe("full content");
      const parsed = JSON.parse(result.output);
      expect(parsed.loaded).toBe(true);
    });

    it("defaults to knowledge space", async () => {
      await handleDocumentRead({ slug: "test" }, makeContext());
      expect(mockGetDocument).toHaveBeenCalledWith("notes", null, "test");
    });

    it("respects notes space", async () => {
      await handleDocumentRead({ slug: "test", space: "notes" }, makeContext());
      expect(mockGetDocument).toHaveBeenCalledWith("notes", null, "test");
    });
  });

  // ── document_write ────────────────────────────────────────────────

  describe("handleDocumentWrite", () => {
    it("fails without title", async () => {
      const result = await handleDocumentWrite({ content: "some content" }, makeContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("title");
    });

    it("fails without content", async () => {
      const result = await handleDocumentWrite({ title: "My Doc" }, makeContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("title");
    });

    it("creates document with auto-generated slug", async () => {
      const result = await handleDocumentWrite(
        { title: "My Test Document", content: "hello world" },
        makeContext(),
      );
      expect(result.success).toBe(true);
      expect(mockUpsertDocument).toHaveBeenCalledWith(
        "notes", null, "My Test Document", "my-test-document", "hello world",
      );
    });

    it("uses explicit slug when provided", async () => {
      await handleDocumentWrite(
        { title: "My Doc", slug: "custom-slug", content: "content" },
        makeContext(),
      );
      expect(mockUpsertDocument).toHaveBeenCalledWith(
        "notes", null, "My Doc", "custom-slug", "content",
      );
    });

    it("auto-creates folder when folder slug provided and not found", async () => {
      mockCreateFolder.mockResolvedValueOnce({
        id: 42, space: "notes", parentId: null, name: "research", slug: "research", createdAt: "2024-01-01",
      });

      await handleDocumentWrite(
        { title: "Report", content: "data", folder: "research" },
        makeContext(),
      );

      expect(mockCreateFolder).toHaveBeenCalledWith("notes", null, "research", "research");
      expect(mockUpsertDocument).toHaveBeenCalledWith("notes", 42, "Report", "report", "data");
    });

    it("reuses existing folder", async () => {
      mockGetFolderBySlug.mockResolvedValueOnce({
        id: 10, space: "notes", parentId: null, name: "existing", slug: "existing", createdAt: "2024-01-01",
      });

      await handleDocumentWrite(
        { title: "Note", content: "text", folder: "existing" },
        makeContext(),
      );

      expect(mockCreateFolder).not.toHaveBeenCalled();
      expect(mockUpsertDocument).toHaveBeenCalledWith("notes", 10, "Note", "note", "text");
    });

    it("includes size warning for large documents", async () => {
      mockUpsertDocument.mockResolvedValueOnce({
        id: 1, space: "notes", folderId: null, title: "Big", slug: "big",
        contentMd: "x", sizeBytes: 5000, createdAt: "2024-01-01", updatedAt: "2024-01-01",
      });

      const result = await handleDocumentWrite(
        { title: "Big", content: "x".repeat(4000) },
        makeContext(),
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.hints).toBeDefined();
      expect(parsed.hints[0]).toContain("chars");
    });
  });

  // ── document_list ─────────────────────────────────────────────────

  describe("handleDocumentList", () => {
    it("returns documents and folders", async () => {
      mockListDocuments.mockResolvedValueOnce([
        { id: 1, space: "notes", folderId: null, title: "Doc1", slug: "doc1", sizeBytes: 100, updatedAt: "2024-01-01" },
      ]);
      mockListFolders.mockResolvedValueOnce([
        { id: 1, space: "notes", parentId: null, name: "research", slug: "research", createdAt: "2024-01-01" },
      ]);

      const result = await handleDocumentList({}, makeContext());
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.documents).toHaveLength(1);
      expect(parsed.folders).toHaveLength(1);
      expect(parsed.space).toBe("notes");
    });

    it("defaults to knowledge space", async () => {
      await handleDocumentList({}, makeContext());
      expect(mockListDocuments).toHaveBeenCalledWith("notes", null);
    });
  });

  // ── document_delete ───────────────────────────────────────────────

  describe("handleDocumentDelete", () => {
    it("fails on missing slug", async () => {
      const result = await handleDocumentDelete({}, makeContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("slug");
    });

    it("fails when document not found", async () => {
      const result = await handleDocumentDelete({ slug: "missing" }, makeContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("Not found");
    });

    it("soft deletes document and removes from context", async () => {
      mockGetDocument.mockResolvedValueOnce({
        id: 5, space: "notes", folderId: null, title: "To Delete", slug: "to-delete",
        contentMd: "content", sizeBytes: 7, createdAt: "2024-01-01", updatedAt: "2024-01-01",
      });

      const ctx = makeContext();
      ctx.loadedDocuments.set("to-delete", "content");
      const result = await handleDocumentDelete({ slug: "to-delete" }, ctx);

      expect(result.success).toBe(true);
      expect(mockSoftDelete).toHaveBeenCalledWith(5);
      expect(ctx.loadedDocuments.has("to-delete")).toBe(false);
    });
  });

  // ── Nested folders ────────────────────────────────────────────────

  describe("nested folder paths", () => {
    it("resolves nested folder path for read", async () => {
      // "research/2024" → first call returns research (id=10), second call returns 2024 (id=20)
      mockGetFolderBySlug
        .mockResolvedValueOnce({ id: 10, space: "notes", parentId: null, name: "research", slug: "research", createdAt: "2024-01-01" })
        .mockResolvedValueOnce({ id: 20, space: "notes", parentId: 10, name: "2024", slug: "2024", createdAt: "2024-01-01" });

      await handleDocumentRead({ slug: "report", folder: "research/2024" }, makeContext());

      // Should resolve folder path by walking: research (null) → 2024 (10)
      expect(mockGetFolderBySlug).toHaveBeenCalledTimes(2);
      expect(mockGetFolderBySlug).toHaveBeenCalledWith("notes", null, "research");
      expect(mockGetFolderBySlug).toHaveBeenCalledWith("notes", 10, "2024");
      expect(mockGetDocument).toHaveBeenCalledWith("notes", 20, "report");
    });

    it("auto-creates nested folder chain on write", async () => {
      // Neither "research" nor "2024" exist → both created
      mockGetFolderBySlug.mockResolvedValue(null);
      mockCreateFolder
        .mockResolvedValueOnce({ id: 10, space: "notes", parentId: null, name: "research", slug: "research", createdAt: "2024-01-01" })
        .mockResolvedValueOnce({ id: 20, space: "notes", parentId: 10, name: "2024", slug: "2024", createdAt: "2024-01-01" });

      await handleDocumentWrite(
        { title: "Deep Report", content: "data", folder: "research/2024" },
        makeContext(),
      );

      expect(mockCreateFolder).toHaveBeenCalledTimes(2);
      expect(mockCreateFolder).toHaveBeenCalledWith("notes", null, "research", "research");
      expect(mockCreateFolder).toHaveBeenCalledWith("notes", 10, "2024", "2024");
      expect(mockUpsertDocument).toHaveBeenCalledWith("notes", 20, "Deep Report", "deep-report", "data");
    });

    it("single-level folder still works (backward compat)", async () => {
      mockGetFolderBySlug.mockResolvedValueOnce({
        id: 5, space: "notes", parentId: null, name: "notes", slug: "notes", createdAt: "2024-01-01",
      });

      await handleDocumentRead({ slug: "todo", folder: "notes" }, makeContext());

      expect(mockGetFolderBySlug).toHaveBeenCalledTimes(1);
      expect(mockGetFolderBySlug).toHaveBeenCalledWith("notes", null, "notes");
      expect(mockGetDocument).toHaveBeenCalledWith("notes", 5, "todo");
    });
  });
});
