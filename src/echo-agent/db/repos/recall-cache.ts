/**
 * Recall overflow cache — DB-backed via documents(space='cache').
 *
 * Reuses the existing `documents` table instead of introducing a dedicated table.
 * The 'cache' space is system-only — NOT exposed via document_* tools enum,
 * so the agent never sees these rows through the document surface. The only
 * legitimate readers are knowledge_recall_overflow (read by cacheKey) and
 * the lazy cleanup inside knowledge_recall (write path).
 *
 * Lifetime: RECALL_CACHE_TTL_MIN minutes from updated_at. Lazy cleanup runs at
 * the start of every knowledge_recall call before any potential write — no cron,
 * no scheduler.
 */

import { createHash } from "node:crypto";
import { queryOne, execute } from "../client.js";
import {
  RECALL_CACHE_FOLDER,
  RECALL_CACHE_SPACE,
  RECALL_CACHE_TTL_MIN,
} from "@echo-agent/knowledge/policy.js";
import type { RankedRecallResult } from "@echo-agent/knowledge/ranking.js";

/** Shape stored as JSON in documents.content_md for cache rows. */
export interface CachedRecallEntry {
  id: number;
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
  similarity: number;
  confidence: number | null;
  status: string;
  pinned: boolean;
  validUntil: string | null;
  sourceRefs: Record<string, unknown>;
  tags: string[];
}

export interface CacheReadResult {
  results: CachedRecallEntry[];
  expiresAt: string;
}

// ── Folder bootstrap ─────────────────────────────────────────────

/**
 * Resolve (or create) the folder_id for `tmp/retrieval` under space='cache'.
 *
 * The folder slug is "tmp/retrieval" but folders only know single-segment slugs,
 * so we treat it as a single slug literal "tmp_retrieval" stored at root level.
 * The constant in policy.ts is the user-facing label; the DB representation is
 * a single-segment slug for simplicity.
 */
const CACHE_FOLDER_SLUG = "tmp_retrieval";

async function ensureCacheFolderId(): Promise<number> {
  // Try to find existing root folder for the cache space
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM folders
     WHERE space = $1 AND parent_id IS NULL AND slug = $2`,
    [RECALL_CACHE_SPACE, CACHE_FOLDER_SLUG],
  );
  if (existing) return existing.id;

  // Create it
  const created = await queryOne<{ id: number }>(
    `INSERT INTO folders (space, parent_id, name, slug)
     VALUES ($1, NULL, $2, $3)
     ON CONFLICT (space, slug) WHERE parent_id IS NULL DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [RECALL_CACHE_SPACE, RECALL_CACHE_FOLDER, CACHE_FOLDER_SLUG],
  );
  if (!created) throw new Error("recall-cache: failed to ensure cache folder");
  return created.id;
}

// ── Write ────────────────────────────────────────────────────────

/**
 * Persist overflow entries under a deterministic cacheKey.
 *
 * Uses upsert semantics: if the same cacheKey was somehow generated twice in
 * the same minute (extremely unlikely), the latest write wins.
 */
export async function writeCache(
  cacheKey: string,
  entries: readonly RankedRecallResult[],
): Promise<{ cacheKey: string; expiresAt: string }> {
  const folderId = await ensureCacheFolderId();
  const payload: CachedRecallEntry[] = entries.map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    summary: e.summary,
    contentMd: e.contentMd,
    similarity: e.similarity,
    confidence: e.confidence,
    status: e.status,
    pinned: e.pinned,
    validUntil: e.validUntil ? e.validUntil.toISOString() : null,
    sourceRefs: e.sourceRefs,
    tags: e.tags,
  }));
  const contentMd = JSON.stringify(payload);
  const sizeBytes = Buffer.byteLength(contentMd, "utf-8");

  await execute(
    `INSERT INTO documents (space, folder_id, title, slug, content_md, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (space, folder_id, slug) WHERE folder_id IS NOT NULL AND archived_at IS NULL
     DO UPDATE SET content_md = $5, size_bytes = $6, updated_at = NOW()`,
    [RECALL_CACHE_SPACE, folderId, cacheKey, cacheKey, contentMd, sizeBytes],
  );

  const expiresAtMs = Date.now() + RECALL_CACHE_TTL_MIN * 60 * 1000;
  return { cacheKey, expiresAt: new Date(expiresAtMs).toISOString() };
}

// ── Read ─────────────────────────────────────────────────────────

export async function readCache(cacheKey: string): Promise<CacheReadResult | null> {
  const row = await queryOne<{ content_md: string; updated_at: string }>(
    `SELECT content_md, updated_at FROM documents
     WHERE space = $1
       AND slug = $2
       AND archived_at IS NULL
       AND updated_at > now() - INTERVAL '${RECALL_CACHE_TTL_MIN} minutes'
     LIMIT 1`,
    [RECALL_CACHE_SPACE, cacheKey],
  );
  if (!row) return null;
  let parsed: CachedRecallEntry[];
  try {
    parsed = JSON.parse(row.content_md) as CachedRecallEntry[];
  } catch {
    return null;
  }
  const updatedMs = new Date(row.updated_at).getTime();
  const expiresAt = new Date(updatedMs + RECALL_CACHE_TTL_MIN * 60 * 1000).toISOString();
  return { results: parsed, expiresAt };
}

// ── Cleanup ──────────────────────────────────────────────────────

/**
 * Delete cache rows older than TTL. Called from inside knowledge_recall before
 * any potential writeCache, so the cache never grows unbounded.
 *
 * Returns the number of rows deleted (for tests/observability).
 */
export async function cleanupExpired(): Promise<number> {
  return execute(
    `DELETE FROM documents
     WHERE space = $1
       AND updated_at < now() - INTERVAL '${RECALL_CACHE_TTL_MIN} minutes'`,
    [RECALL_CACHE_SPACE],
  );
}

export interface RecallCacheKeyFilters {
  k: number;
  kind?: string;
  includeExpired: boolean;
}

/**
 * Generate a deterministic cacheKey for a recall query.
 *
 * Format: `rcl-<yyyymmdd>-<16hex>` where the hash covers the **full filter set**
 * (query + k + kind + includeExpired) plus `now.getTime()` (millisecond precision).
 *
 * Why the full filter set: two recalls in the same minute with the same `query`
 * but different `k`, `kind`, or `includeExpired` produce different result sets.
 * The previous version hashed only `query + isoMinute` which made those collide
 * in upsert and silently corrupted overflow contents. With the full set hashed
 * + ms precision, two real-world recalls cannot collide unless they were issued
 * in the same millisecond with identical filters — in which case the result set
 * is by definition identical and reusing the same cacheKey is correct.
 *
 * The 16-char hash slice (was 8) gives 64 bits of entropy on top of the date
 * prefix, making accidental collisions vanishingly unlikely.
 */
export function generateCacheKey(
  query: string,
  filters: RecallCacheKeyFilters,
  now: Date,
): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const payload = [
    query,
    String(filters.k),
    filters.kind ?? "",
    String(filters.includeExpired),
    String(now.getTime()),
  ].join("|");
  const hash = createHash("md5").update(payload).digest("hex").slice(0, 16);
  return `rcl-${ymd}-${hash}`;
}
