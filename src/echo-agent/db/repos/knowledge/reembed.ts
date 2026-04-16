/**
 * Knowledge repo — reembed support (in-place vector update + batch streams).
 *
 * Used by `scripts/knowledge-reembed` when the embedding model changes but
 * the dim stays the same. Includes safety prechecks (mixed-dim detection +
 * runtime-active soft lock) so the script can refuse to run when it would
 * leave the DB in an inconsistent state.
 */

import { query, queryOne, execute } from "../../client.js";
import { type ReembedRow, vectorLiteral } from "./types.js";

/**
 * Replace a row's embedding (and audit columns) with a freshly-computed one.
 */
export async function updateEmbedding(
  id: number,
  model: string,
  dim: number,
  vector: readonly number[],
): Promise<boolean> {
  if (!Number.isFinite(id) || id <= 0) return false;
  if (vector.length !== dim) {
    throw new Error(
      `updateEmbedding: vector length ${vector.length} does not match dim ${dim} (id=${id}). ` +
        `The DB CHECK constraint would reject this.`,
    );
  }
  const rowCount = await execute(
    `UPDATE knowledge_entries
     SET embedding = $1::vector,
         embedding_model = $2,
         embedding_dim = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [vectorLiteral(vector), model, dim, id],
  );
  return rowCount === 1;
}

/**
 * Stream rows that need re-embedding.
 *
 * If `includeMatching` is false (default), only rows whose `embedding_model`
 * does NOT match `currentModel` are streamed — re-running the script after
 * a successful pass is a no-op. If `--force` is used at the script level,
 * pass `includeMatching: true` to re-embed everything.
 */
export async function* streamRowsForReembed(
  currentModel: string,
  options: { includeMatching?: boolean; batchSize?: number } = {},
): AsyncIterable<ReembedRow> {
  const includeMatching = options.includeMatching ?? false;
  const batchSize = options.batchSize ?? 50;
  const whereModel = includeMatching ? "" : "AND embedding_model <> $2";
  const limitParam = includeMatching ? "$2" : "$3";
  let cursor = 0;
  while (true) {
    const params: unknown[] = includeMatching
      ? [cursor, batchSize]
      : [cursor, currentModel, batchSize];
    const rows = await query<{
      id: number;
      kind: string;
      title: string;
      summary: string;
      content_md: string;
    }>(
      `SELECT id, kind, title, summary, content_md
       FROM knowledge_entries
       WHERE id > $1
         ${whereModel}
       ORDER BY id ASC
       LIMIT ${limitParam}`,
      params,
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      yield {
        id: r.id,
        kind: r.kind,
        title: r.title,
        summary: r.summary,
        contentMd: r.content_md,
      };
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < batchSize) break;
  }
}

/**
 * Count rows whose `embedding_dim` differs from `currentDim`. Used as a hard
 * pre-check by `knowledge-reembed`: any non-zero result means the operator
 * must use the export-wipe-import flow instead, because mixed-dim recall
 * would crash pgvector.
 */
export async function findRowsWithDimNotMatching(currentDim: number): Promise<number> {
  const row = await queryOne<{ n: string }>(
    "SELECT count(*) AS n FROM knowledge_entries WHERE embedding_dim <> $1",
    [currentDim],
  );
  return row ? parseInt(row.n, 10) : 0;
}

/**
 * Cheap check on the singleton `runtime_state` row. Used as a soft pre-check
 * by `knowledge-reembed` against the most obvious race with the loop engine.
 *
 * NOTE: This is NOT a full write lock. MCP / internal tools / subagents / CLI
 * can still write to knowledge_entries while `active = FALSE`. The script
 * help text and README must explicitly tell operators to stop the FULL stack
 * of writers before running reembed.
 */
export async function isRuntimeActive(): Promise<boolean> {
  const row = await queryOne<{ active: boolean }>(
    "SELECT active FROM runtime_state WHERE id = 1",
  );
  return row?.active ?? false;
}
