/**
 * knowledge_recall + knowledge_recall_overflow handlers — vector recall.
 *
 * knowledge_recall is NOT 100% read-only: it lazily cleans up expired cache
 * rows and writes any overflow (>10 results or >50k chars total) into the
 * dedicated recall_cache_entries table. This is documented in the tool
 * description and surfaced in tests.
 *
 * The recall filter uses the providerModel returned by THIS embedQuery call,
 * not config.model — the write path stamps the same providerModel, so write
 * and read are self-consistent for the lifetime of one provider deployment.
 */

import * as knowledgeRepo from "@echo-agent/db/repos/knowledge.js";
import * as recallCacheRepo from "@echo-agent/db/repos/recall-cache.js";
import { embedQuery } from "@echo-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import { clampRecallK } from "@echo-agent/knowledge/policy.js";
import { rerank, type RecallCandidate } from "@echo-agent/knowledge/ranking.js";
import { splitInlineAndOverflow } from "@echo-agent/knowledge/recall-payload.js";
import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { str, num, bool, ok, fail } from "../types.js";
import logger from "@utils/logger.js";

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

// ── helpers (recall-only) ───────────────────────────────────────

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
