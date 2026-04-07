/**
 * Knowledge internal tool handlers — canonical agent memory layer.
 *
 * Five tools, all visible regardless of EMBEDDING_BASE_URL:
 *   - knowledge_write           writes a new entry, embeds title+summary, fail-loud without sidecar
 *   - knowledge_recall          vector recall, returns inline content + overflow cache, fail-loud without sidecar
 *   - knowledge_recall_overflow reads previously cached overflow by cacheKey, no sidecar required
 *   - knowledge_get             direct fetch by id, loads content_md into context, no sidecar required
 *   - knowledge_update_status   marks an entry invalidated/archived, no sidecar required
 *
 * knowledge_recall is NOT 100% read-only: it lazily cleans up expired cache rows
 * and writes any overflow (>10 results or >50k chars total) into the dedicated
 * recall_cache_entries table. This is documented in the tool description and
 * surfaced in tests.
 *
 * All entries MUST be written in English regardless of conversation language —
 * see Knowledge Layer Rules in tool-usage.ts and registry tool descriptions.
 */

import * as knowledgeRepo from "@echo-agent/db/repos/knowledge.js";
import * as recallCacheRepo from "@echo-agent/db/repos/recall-cache.js";
import { embedDocument, embedQuery } from "@echo-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import { computeContentHash } from "@echo-agent/knowledge/content-hash.js";
import {
  computeValidUntil,
  isValidKind,
  isUpdatableKnowledgeStatus,
  clampRecallK,
} from "@echo-agent/knowledge/policy.js";
import { rerank, type RecallCandidate } from "@echo-agent/knowledge/ranking.js";
import { splitInlineAndOverflow } from "@echo-agent/knowledge/recall-payload.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, num, bool, ok, fail } from "./types.js";
import logger from "@utils/logger.js";

// ── knowledge_write ─────────────────────────────────────────────

export async function handleKnowledgeWrite(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const kind = str(params, "kind");
  const title = str(params, "title");
  const summary = str(params, "summary");
  if (!kind || !title || !summary) {
    return fail("Missing required fields: kind, title, summary");
  }
  if (!isValidKind(kind)) {
    return fail(
      `Invalid kind "${kind}". Must be snake_case ASCII (a-z, 0-9, _), start with a letter, max 64 chars. Example: pumpfun_entry_pattern.`,
    );
  }

  const contentMd = str(params, "content_md") || summary;
  const tags = readStringArray(params, "tags");
  const sourceRefs = readObject(params, "source_refs");
  const confidence = readClampedNumber(params, "confidence", 0, 1);
  const pinned = bool(params, "pinned");
  const ttlHours = num(params, "ttl_hours");

  const validUntil = computeValidUntil(ttlHours, pinned, new Date());

  // Short-circuit on content_hash BEFORE loading the embedding config or
  // calling the provider. Repeat writes of the same fact are common (the
  // agent re-derives the same observation across sessions) — paying for an
  // embed round-trip just to discover a duplicate is wasted budget. The CTE
  // upsert in insertEntry is still a safety net for race conditions, but
  // 99% of duplicates land here.
  const contentHash = computeContentHash({ kind, title, summary, contentMd });
  try {
    const existing = await knowledgeRepo.findByContentHash(contentHash);
    if (existing) {
      logger.info("knowledge.write.duplicate_short_circuit", {
        id: existing.id,
        kind: existing.kind,
        contentHash,
      });
      return ok({
        id: existing.id,
        kind: existing.kind,
        validUntil: existing.validUntil,
        pinned: existing.pinned,
        embedded: true,
        duplicate: true,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("knowledge.write.lookup_failed", { error: msg });
    return fail(`knowledge_write failed: ${msg}`);
  }

  // Load config once per call. We use it for the embedDocument call AND to
  // stamp embeddingModel/embeddingDim authoritatively (no `?? "unknown"`,
  // no compile-time constant).
  let config;
  try {
    config = loadEmbeddingConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("knowledge.write.config_failed", { error: msg });
    return fail(`embedding config invalid: ${msg}`);
  }

  let embedding: number[];
  let providerModel: string;
  try {
    const result = await embedDocument(title, summary, config);
    embedding = result.embedding;
    providerModel = result.providerModel;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("knowledge.write.embedding_failed", { error: msg });
    return fail(`embedding service unavailable: ${msg}`);
  }

  try {
    const { entry, inserted } = await knowledgeRepo.insertEntry({
      kind,
      title,
      summary,
      contentMd,
      tags,
      sourceRefs,
      confidence,
      pinned,
      validUntil,
      contentHash,
      // Honest provenance: stamp the model the provider actually reported,
      // NOT the requested config.model. The audit column and the recall
      // filter both consume this — they must agree on the same source.
      embeddingModel: providerModel,
      embeddingDim: embedding.length,
      embedding,
    });
    if (!inserted) {
      logger.info("knowledge.write.duplicate", {
        id: entry.id,
        kind: entry.kind,
        contentHash,
      });
    }
    return ok({
      id: entry.id,
      kind: entry.kind,
      validUntil: entry.validUntil,
      pinned: entry.pinned,
      embedded: true,
      duplicate: !inserted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("knowledge.write.insert_failed", { error: msg });
    return fail(`knowledge_write failed: ${msg}`);
  }
}

// ── knowledge_recall ────────────────────────────────────────────

export async function handleKnowledgeRecall(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const query = str(params, "query");
  if (!query) return fail("Missing required parameter: query");

  const k = clampRecallK(num(params, "k"));
  const kind = str(params, "kind") || undefined;
  // include_expired defaults true (TTL ≠ existence). Read with explicit default.
  const includeExpired = params.include_expired === undefined ? true : bool(params, "include_expired");

  // Lazy cleanup BEFORE any potential write — keeps cache space bounded.
  try {
    await recallCacheRepo.cleanupExpired();
  } catch (err) {
    // Cleanup failure is non-fatal — log and continue.
    logger.warn("knowledge.recall.cleanup_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let config;
  try {
    config = loadEmbeddingConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("knowledge.recall.config_failed", { error: msg });
    return fail(`embedding config invalid: ${msg}`);
  }

  let queryEmbedding: number[];
  let providerModel: string;
  try {
    const result = await embedQuery(query, config);
    queryEmbedding = result.embedding;
    providerModel = result.providerModel;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("knowledge.recall.embedding_failed", { error: msg });
    return fail(`embedding service unavailable: ${msg}`);
  }

  let candidates: RecallCandidate[];
  try {
    candidates = await knowledgeRepo.recallTopK(
      queryEmbedding,
      {
        // Filter by what the provider actually reported on THIS call. Write
        // path stamps the same providerModel, so write/read are self-consistent
        // for the lifetime of one provider deployment. If the provider changes
        // its name, the operator runs `make knowledge-reembed --force`.
        embeddingModel: providerModel,
        embeddingDim: config.dim,
        kind,
        includeExpired,
      },
      k,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("knowledge.recall.query_failed", { error: msg });
    return fail(`knowledge_recall failed: ${msg}`);
  }

  const reranked = rerank(candidates, { k });
  const { inline, overflow } = splitInlineAndOverflow(reranked);

  let overflowMeta: { cacheKey: string; remainingCount: number; expiresAt: string } | undefined;
  if (overflow.length > 0) {
    // Pass the FULL filter set into the cacheKey hash (fix 2). Two recalls with
    // the same `query` but different `k` / `kind` / `include_expired` produce
    // different result sets — they MUST get different keys, otherwise upsert
    // by slug silently corrupts overflow contents from a previous recall.
    const cacheKey = recallCacheRepo.generateCacheKey(
      query,
      { k, kind, includeExpired },
      new Date(),
    );
    try {
      const written = await recallCacheRepo.writeCache(cacheKey, overflow);
      overflowMeta = {
        cacheKey: written.cacheKey,
        remainingCount: overflow.length,
        expiresAt: written.expiresAt,
      };
    } catch (err) {
      // Fail loud (fix 3): silently dropping overflow gives a response where
      // count > inline.length and the agent has no way to fetch the missing
      // results. Better to fail the whole recall with a helpful retry hint.
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("knowledge.recall.cache_write_failed", {
        error: msg,
        overflowCount: overflow.length,
      });
      const retryK = Math.min(10, k);
      return fail(
        `knowledge_recall succeeded but overflow cache write failed: ${msg}. ` +
          `Retry with k=${retryK} (or smaller) to fit results inline without cache.`,
      );
    }
  }

  return ok({
    count: reranked.length,
    inline: inline.map(toInlineDto),
    ...(overflowMeta ? { overflow: overflowMeta } : {}),
  });
}

// ── knowledge_recall_overflow ───────────────────────────────────

export async function handleKnowledgeRecallOverflow(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const cacheKey = str(params, "cacheKey") || str(params, "cache_key");
  if (!cacheKey) return fail("Missing required parameter: cacheKey");

  let cached;
  try {
    cached = await recallCacheRepo.readCache(cacheKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`knowledge_recall_overflow failed: ${msg}`);
  }
  if (!cached) {
    return fail(`cache not found or expired: ${cacheKey}`);
  }
  return ok({ results: cached.results, expiresAt: cached.expiresAt });
}

// ── knowledge_get ───────────────────────────────────────────────

export async function handleKnowledgeGet(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const id = num(params, "id");
  if (id === undefined) return fail("Missing required parameter: id");

  const entry = await knowledgeRepo.getById(id);
  if (!entry) return fail(`knowledge entry not found: ${id}`);

  // Inject content_md into the engine's loadedDocuments map (mirrors document_read).
  // Key uses the "knowledge:{id}" prefix so it never collides with document slugs.
  context.loadedDocuments.set(`knowledge:${entry.id}`, entry.contentMd);

  return ok({
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    summary: entry.summary,
    contentMd: entry.contentMd,
    tags: entry.tags,
    sourceRefs: entry.sourceRefs,
    confidence: entry.confidence,
    status: entry.status,
    pinned: entry.pinned,
    validUntil: entry.validUntil,
  });
}

// ── knowledge_update_status ─────────────────────────────────────

export async function handleKnowledgeUpdateStatus(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const id = num(params, "id");
  const statusParam = str(params, "status");
  if (id === undefined || !statusParam) {
    return fail("Missing required parameters: id, status");
  }
  if (!isUpdatableKnowledgeStatus(statusParam)) {
    return fail(
      `Invalid status "${statusParam}". Must be one of: invalidated, archived. ` +
        `(Cannot transition back to active — write a new entry instead.)`,
    );
  }

  const updated = await knowledgeRepo.updateStatus(id, statusParam);
  if (!updated) return fail(`knowledge entry not found: ${id}`);

  return ok({ id, status: statusParam, updated: true });
}

// ── helpers ─────────────────────────────────────────────────────

interface InlineDto {
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

function toInlineDto(entry: import("@echo-agent/knowledge/ranking.js").RankedRecallResult): InlineDto {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    summary: entry.summary,
    contentMd: entry.contentMd,
    similarity: entry.similarity,
    confidence: entry.confidence,
    status: entry.status,
    pinned: entry.pinned,
    validUntil: entry.validUntil ? entry.validUntil.toISOString() : null,
    sourceRefs: entry.sourceRefs,
    tags: entry.tags,
  };
}

function readStringArray(params: Record<string, unknown>, key: string): string[] {
  const v = params[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function readObject(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = params[key];
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

function readClampedNumber(
  params: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | null {
  const v = params[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
