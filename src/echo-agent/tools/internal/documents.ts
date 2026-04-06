/**
 * Document internal tool handlers — DB-first content with first-class folders.
 *
 * Replaces legacy file_* handlers. No pseudo-file paths.
 * Documents live in `documents` table with `folder_id` FK to `folders`.
 */

import * as documentsRepo from "@echo-agent/db/repos/documents.js";
import * as foldersRepo from "@echo-agent/db/repos/folders.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, bool, ok, fail } from "./types.js";

const PREVIEW_CHAR_LIMIT = 1000;
const SIZE_WARNING_CHARS = 3000;
const MAX_DOCS_WARNING = 50;

/** Generate a URL-safe slug from title. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

/** Resolve folder path (e.g. "research/2024") to folder_id by walking the tree. */
async function resolveFolderPath(space: string, folderPath: string | undefined): Promise<number | null> {
  if (!folderPath) return null;
  const parts = folderPath.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  let parentId: number | null = null;
  for (const slug of parts) {
    const folder = await foldersRepo.getFolderBySlug(space, parentId, slug);
    if (!folder) return null;
    parentId = folder.id;
  }
  return parentId;
}

/** Resolve or auto-create folder path. Returns leaf folder_id. */
async function resolveOrCreateFolderPath(space: string, folderPath: string): Promise<number> {
  const parts = folderPath.split("/").filter(Boolean);
  let parentId: number | null = null;
  for (const slug of parts) {
    const existing = await foldersRepo.getFolderBySlug(space, parentId, slug);
    if (existing) {
      parentId = existing.id;
    } else {
      const created = await foldersRepo.createFolder(space, parentId, slug, slug);
      parentId = created.id;
    }
  }
  return parentId!;
}

// ── document_read ───────────────────────────────────────────────

export async function handleDocumentRead(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const slug = str(params, "slug");
  if (!slug) return fail("Missing required parameter: slug");

  const space = str(params, "space") || "notes";
  const folderSlug = str(params, "folder") || undefined;
  const isPreview = bool(params, "preview");
  const folderId = await resolveFolderPath(space, folderSlug);

  const doc = await documentsRepo.getDocument(space, folderId, slug);
  if (!doc) return fail(`Not found: ${slug} in ${space}${folderSlug ? `/${folderSlug}` : ""}`);

  if (isPreview) {
    const previewText = doc.contentMd.length > PREVIEW_CHAR_LIMIT
      ? doc.contentMd.slice(0, PREVIEW_CHAR_LIMIT) + "\n\n... (preview — use document_read without preview to load full document)"
      : doc.contentMd;
    return ok({
      title: doc.title,
      slug: doc.slug,
      space: doc.space,
      sizeBytes: doc.sizeBytes,
      preview: previewText,
    });
  }

  // Full load — add to context
  context.loadedDocuments.set(doc.slug, doc.contentMd);
  return ok({
    title: doc.title,
    slug: doc.slug,
    space: doc.space,
    chars: doc.contentMd.length,
    loaded: true,
  });
}

// ── document_write ──────────────────────────────────────────────

export async function handleDocumentWrite(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const title = str(params, "title");
  const content = str(params, "content");
  if (!title || !content) return fail("Missing required: title, content");

  const space = str(params, "space") || "notes";
  const slug = str(params, "slug") || slugify(title);
  const folderSlug = str(params, "folder") || undefined;

  // Resolve or create folder path (supports nested: "research/2024")
  const folderId = folderSlug ? await resolveOrCreateFolderPath(space, folderSlug) : null;

  const doc = await documentsRepo.upsertDocument(space, folderId, title, slug, content);

  const hints: string[] = [];
  if (content.length > SIZE_WARNING_CHARS) {
    hints.push(`Document is ${content.length} chars. Consider keeping documents concise.`);
  }
  const totalDocs = await documentsRepo.countDocuments(space);
  if (totalDocs > MAX_DOCS_WARNING) {
    hints.push(`${totalDocs} documents in ${space}. Consider consolidating.`);
  }

  return ok({
    title: doc.title,
    slug: doc.slug,
    space: doc.space,
    sizeBytes: doc.sizeBytes,
    created: doc.createdAt === doc.updatedAt,
    ...(hints.length > 0 ? { hints } : {}),
  });
}

// ── document_list ───────────────────────────────────────────────

export async function handleDocumentList(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const space = str(params, "space") || "notes";
  const folderSlug = str(params, "folder") || undefined;
  const folderId = await resolveFolderPath(space, folderSlug);

  const docs = await documentsRepo.listDocuments(space, folderId);
  const folders = await foldersRepo.listFolders(space, folderId);

  return ok({
    space,
    folder: folderSlug ?? null,
    folders: folders.map(f => ({ name: f.name, slug: f.slug })),
    documents: docs.map(d => ({ title: d.title, slug: d.slug, sizeBytes: d.sizeBytes, updatedAt: d.updatedAt })),
    totalDocuments: docs.length,
    totalFolders: folders.length,
  });
}

// ── document_delete ─────────────────────────────────────────────

export async function handleDocumentDelete(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const slug = str(params, "slug");
  if (!slug) return fail("Missing required parameter: slug");

  const space = str(params, "space") || "notes";
  const folderSlug = str(params, "folder") || undefined;
  const folderId = await resolveFolderPath(space, folderSlug);

  const doc = await documentsRepo.getDocument(space, folderId, slug);
  if (!doc) return fail(`Not found: ${slug}`);

  const deleted = await documentsRepo.softDeleteDocument(doc.id);
  if (!deleted) return fail(`Failed to archive: ${slug}`);

  context.loadedDocuments.delete(slug);
  return ok({ slug, space, archived: true });
}
