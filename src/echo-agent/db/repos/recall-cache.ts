/**
 * Recall overflow cache — DB-backed via dedicated `recall_cache_entries` table.
 *
 * Schema lives in 001_initial.sql (recall_cache_entries: cache_key PK, payload JSONB,
 * expires_at, created_at). Pure system surface — agents never see these rows
 * through any tool, only via knowledge_recall_overflow lookup by cache_key.
 *
 * Lifetime: RECALL_CACHE_TTL_MIN minutes computed at write time. Lazy cleanup
 * runs at the start of every knowledge_recall call before any potential write.
 *
 * Public interface (writeCache, readCache, cleanupExpired, generateCacheKey)
 * is unchanged from the previous documents(space='cache') backend — callers
 * in tools/internal/knowledge-recall.ts do not require any changes.
 */

import { createHash } from "node:crypto";
import { queryOne, execute } from "../client.js";
import { RECALL_CACHE_TTL_MIN } from "@echo-agent/knowledge/policy.js";
import type { RankedRecallResult } from "@echo-agent/knowledge/ranking.js";

/** Shape stored as JSON in recall_cache_entries.payload for cache rows. */
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

// ── Write ────────────────────────────────────────────────────────

/**
 * Persist overflow entries under a deterministic cacheKey.
 *
 * Uses upsert semantics: if the same cacheKey was somehow generated twice,
 * the latest write wins (payload + expires_at refresh).
 */
export async function writeCache(
  cacheKey: string,
  entries: readonly RankedRecallResult[],
): Promise<{ cacheKey: string; expiresAt: string }> {
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

  // Compute expires_at in TS so the returned ISO matches what we wrote, exactly.
  const expiresAtMs = Date.now() + RECALL_CACHE_TTL_MIN * 60 * 1000;
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  await execute(
    `INSERT INTO recall_cache_entries (cache_key, payload, expires_at)
     VALUES ($1, $2::jsonb, $3::timestamptz)
     ON CONFLICT (cache_key) DO UPDATE
       SET payload = EXCLUDED.payload,
           expires_at = EXCLUDED.expires_at`,
    [cacheKey, JSON.stringify(payload), expiresAtIso],
  );

  return { cacheKey, expiresAt: expiresAtIso };
}

// ── Read ─────────────────────────────────────────────────────────

export async function readCache(cacheKey: string): Promise<CacheReadResult | null> {
  const row = await queryOne<{ payload: CachedRecallEntry[]; expires_at: string }>(
    `SELECT payload, expires_at
     FROM recall_cache_entries
     WHERE cache_key = $1
       AND expires_at > NOW()
     LIMIT 1`,
    [cacheKey],
  );
  if (!row) return null;
  // payload is JSONB → node-postgres returns it as a parsed object already.
  const results = Array.isArray(row.payload) ? row.payload : [];
  return { results, expiresAt: new Date(row.expires_at).toISOString() };
}

// ── Cleanup ──────────────────────────────────────────────────────

/**
 * Delete cache rows whose `expires_at` is in the past. Called from inside
 * knowledge_recall before any potential writeCache, so the cache never grows
 * unbounded.
 *
 * Returns the number of rows deleted (for tests/observability).
 */
export async function cleanupExpired(): Promise<number> {
  return execute(
    `DELETE FROM recall_cache_entries WHERE expires_at < NOW()`,
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
 * The 16-char hash slice gives 64 bits of entropy on top of the date prefix,
 * making accidental collisions vanishingly unlikely.
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
