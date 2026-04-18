-- PR4 Fase IV — minimal episode → knowledge promotion.
--
-- Three new columns on `knowledge_entries` to track promotion provenance
-- plus two partial UNIQUE indexes that deliver three layers of idempotency
-- (together with the existing `content_hash` UNIQUE):
--
--   1. `source_episode_id` UNIQUE (partial): a given session_episodes row
--      can only be promoted once. FK with ON DELETE SET NULL so the
--      knowledge entry survives if the source session is cleaned up.
--   2. `source_episode_hash` UNIQUE (partial): survives CASCADE. If the
--      source session/episode is ever hard-deleted and a later checkpoint
--      re-extracts the SAME episode text (same kind + summary → same
--      hash), we still refuse to re-promote the identical content.
--   3. `content_hash` UNIQUE (existing in 001): two different source
--      episodes that produce identical promoted content still collapse to
--      one knowledge_entries row.
--
-- `promotion_version` lets a future rollout signal "this row was promoted
-- by promotion pipeline v2" without re-running v1's rows; v1 stamps `1`.
--
-- Trigger placement is OUT OF SCOPE for this migration — the pipeline
-- itself lives in `knowledge/promotion.ts` and is called from turn-loop
-- AFTER the checkpoint tx has committed. No DB triggers.

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS source_episode_id  INTEGER REFERENCES session_episodes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_episode_hash TEXT,
  ADD COLUMN IF NOT EXISTS promotion_version  INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_source_episode_id
  ON knowledge_entries (source_episode_id)
  WHERE source_episode_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_source_episode_hash
  ON knowledge_entries (source_episode_hash)
  WHERE source_episode_hash IS NOT NULL;

COMMENT ON COLUMN knowledge_entries.source_episode_id IS
  'FK to the session_episodes row this knowledge entry was promoted from (NULL for entries written via knowledge_write). ON DELETE SET NULL — the knowledge entry survives if the source session is deleted.';

COMMENT ON COLUMN knowledge_entries.source_episode_hash IS
  'Copy of session_episodes.episode_hash at promotion time. Immutable — survives CASCADE drop of the source episode. Used as the second idempotency layer so re-extracted identical content cannot be promoted twice.';

COMMENT ON COLUMN knowledge_entries.promotion_version IS
  'Promotion pipeline version stamp. v1 = minimal heuristic (PR4 Fase IV: decision/preference/lesson/fact + cosine >= 0.85 cluster).';
