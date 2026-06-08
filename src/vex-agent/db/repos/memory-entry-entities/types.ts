/**
 * memory_entry_entities repo — types + row mapper + column list (S1d).
 *
 * Junction linking a long-term `knowledge_entries` row to the `memory_entities`
 * it mentions (composite PK `(entry_id, entity_id)` + a `mention_count`). The
 * denormalized `entities TEXT[]` on candidates stays as quick tags; this is the
 * normalized graph form S8 fills.
 *
 * `entry_id` is `knowledge_entries.id` (SERIAL → INTEGER); `entity_id` is
 * `memory_entities.id` (UUID). Both FKs cascade on parent delete.
 *
 * Pure-data module: interfaces + pg-row → domain conversion.
 */

// ── Pg row shape (snake_case) ───────────────────────────────────
export interface MemoryEntryEntityRow {
  entry_id: number;
  entity_id: string;
  mention_count: number;
  created_at: string;
}

export interface MemoryEntryEntityRowWithInsertFlag extends MemoryEntryEntityRow {
  inserted: boolean;
}

// ── Domain shape (camelCase) ────────────────────────────────────
export interface MemoryEntryEntity {
  /** knowledge_entries.id (SERIAL). */
  entryId: number;
  /** memory_entities.id (UUID). */
  entityId: string;
  mentionCount: number;
  createdAt: string;
}

export interface LinkEntryEntityResult {
  link: MemoryEntryEntity;
  /** True iff newly inserted; false iff the (entry, entity) link already existed. */
  inserted: boolean;
}

export function mapRow(r: MemoryEntryEntityRow): MemoryEntryEntity {
  return {
    entryId: r.entry_id,
    entityId: r.entity_id,
    mentionCount: r.mention_count,
    createdAt: r.created_at,
  };
}

// ── Column list (single source of truth for reads) ──────────────
export const ENTRY_ENTITY_COLUMNS = `
  entry_id, entity_id, mention_count, created_at
`;
