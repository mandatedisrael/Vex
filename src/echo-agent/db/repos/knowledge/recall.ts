/**
 * Knowledge repo — vector recall (top-K cosine over pgvector).
 *
 * The model+dim filter is mandatory because the column type has no typmod —
 * running `<=>` against rows produced by a different-dim model crashes pgvector.
 * The filter is also semantic: comparing similarities across different model
 * spaces is meaningless.
 */

import { query } from "../../client.js";
import type { RecallCandidate } from "@echo-agent/knowledge/ranking.js";
import {
  type KnowledgeRecallRow,
  type RecallFilters,
  mapRowToCandidate,
  vectorLiteral,
} from "./types.js";

/**
 * Top-K cosine recall over `knowledge_entries`, with MANDATORY filter by
 * `embedding_model` and `embedding_dim` plus optional kind/expiry filters.
 *
 * Fetches `k * 2` raw candidates from SQL, returns them as ranking inputs.
 * The caller (handler) reruns these through `rerank()` from knowledge/ranking.ts
 * before splitting into inline + overflow.
 */
export async function recallTopK(
  queryEmbedding: readonly number[],
  filters: RecallFilters,
  k: number,
): Promise<RecallCandidate[]> {
  if (k <= 0) return [];
  if (queryEmbedding.length !== filters.embeddingDim) {
    throw new Error(
      `recallTopK: query embedding length ${queryEmbedding.length} does not match filter dim ${filters.embeddingDim}`,
    );
  }

  // Always exclude invalidated/archived from recall.
  // include_expired controls whether expired-but-active entries are returned.
  const includeExpired = filters.includeExpired !== false;
  const params: unknown[] = [
    vectorLiteral(queryEmbedding),
    filters.embeddingModel,
    filters.embeddingDim,
  ];
  let whereExtra = "";

  if (filters.kind) {
    params.push(filters.kind);
    whereExtra += ` AND kind = $${params.length}`;
  }
  if (!includeExpired) {
    whereExtra += " AND (pinned = TRUE OR valid_until IS NULL OR valid_until > now())";
  }

  params.push(k * 2);
  const limitParam = `$${params.length}`;

  const rows = await query<KnowledgeRecallRow>(
    `SELECT
       id, kind, title, summary, content_md, tags, source_refs,
       confidence, status, pinned, valid_from, valid_until,
       content_hash, embedding_model, embedding_dim, created_at, updated_at,
       (embedding <=> $1::vector) AS cosine_distance
     FROM knowledge_entries
     WHERE status = 'active'
       AND embedding_model = $2
       AND embedding_dim = $3
       ${whereExtra}
     ORDER BY embedding <=> $1::vector
     LIMIT ${limitParam}`,
    params,
  );

  return rows.map(mapRowToCandidate);
}
