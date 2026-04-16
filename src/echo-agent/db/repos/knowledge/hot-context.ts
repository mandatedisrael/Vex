/**
 * Knowledge repo — hot-context listings for prompt composition.
 *
 * Small, non-vector SELECTs used by the engine to hydrate the system prompt
 * with a tail of currently-active entries (by recency / pinned-first) and the
 * set of `kind` values that actually exist in the DB. Neither touches
 * embeddings or ranking — those live in recall.ts.
 */

import { query } from "../../client.js";
import type {
  ActiveKnowledgeListItem,
  KnownKind,
  ListActiveOptions,
  ListKnownKindsOptions,
} from "./types.js";

export async function listActiveForHotContext(
  opts: ListActiveOptions,
): Promise<ActiveKnowledgeListItem[]> {
  const rows = await query<{
    id: number;
    kind: string;
    title: string;
    summary: string;
    pinned: boolean;
    valid_until: string | null;
    updated_at: string;
  }>(
    `SELECT id, kind, title, summary, pinned, valid_until, updated_at
     FROM knowledge_entries
     WHERE status = 'active'
       AND (pinned = TRUE OR valid_until > now())
     ORDER BY pinned DESC, updated_at DESC
     LIMIT $1`,
    [opts.limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    pinned: r.pinned,
    validUntil: r.valid_until,
    updatedAt: r.updated_at,
  }));
}

export async function listKnownKinds(opts: ListKnownKindsOptions): Promise<KnownKind[]> {
  const rows = await query<{ kind: string; n: string }>(
    `SELECT kind, count(*) AS n
     FROM knowledge_entries
     WHERE status = 'active'
     GROUP BY kind
     ORDER BY n DESC
     LIMIT $1`,
    [opts.limit],
  );
  return rows.map((r) => ({ kind: r.kind, count: parseInt(r.n, 10) }));
}
