/**
 * Knowledge repo — streaming bulk export for backup / roundtrip.
 *
 * Paginated by id so memory stays bounded regardless of corpus size. The
 * embedding column is NOT fetched — exports never carry vectors (re-embed
 * happens on import). LEFT JOIN resolves `supersedes_id -> predecessor.
 * content_hash` so the export is cross-DB restorable.
 */

import { query } from "../../client.js";
import {
  type KnowledgeEntryForExport,
  type KnowledgeRow,
  mapRow,
} from "./types.js";

/**
 * Stream every row in `knowledge_entries` for export.
 *
 * Order by id ASC guarantees every predecessor lands in the JSONL before its
 * successor, so the import lookup always resolves via `findByContentHash`.
 */
export async function* streamAllForExport(
  batchSize = 100,
): AsyncIterable<KnowledgeEntryForExport> {
  let cursor = 0;
  // ESLint: intentional infinite loop; the page-size guard breaks it.
  while (true) {
    const rows = await query<KnowledgeRow & { supersedes_content_hash: string | null }>(
      `SELECT
         k.id, k.kind, k.title, k.summary, k.content_md, k.tags, k.source_refs,
         k.confidence, k.status, k.pinned, k.valid_from, k.valid_until,
         k.content_hash, k.embedding_model, k.embedding_dim,
         k.source_surface, k.source_session,
         k.supersedes_id, k.status_reason, k.change_summary, k.what_failed,
         k.created_at, k.updated_at,
         pred.content_hash AS supersedes_content_hash
       FROM knowledge_entries k
       LEFT JOIN knowledge_entries pred ON pred.id = k.supersedes_id
       WHERE k.id > $1
       ORDER BY k.id ASC
       LIMIT $2`,
      [cursor, batchSize],
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      const { supersedes_content_hash, ...baseRow } = row;
      yield {
        ...mapRow(baseRow as KnowledgeRow),
        supersedesContentHash: supersedes_content_hash,
      };
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < batchSize) break;
  }
}
