-- Wake-driven autonomy (PR-9 of the wake roadmap) — per-session handoffs
-- prepared before a checkpoint so recall after compaction can target the
-- right memories instead of blindly using the last user input.
--
-- Population path:
--   1. `checkpoint_handoff_prepare` tool (visibility band='warning') is
--      offered to the model every turn while `contextUsageBand` ≥ warning.
--      The handler writes ONE active row per `(session_id, target_gen)`.
--   2. Phase 0 of `executeCheckpoint` runs a forced pre-compact pass when
--      the band is already `critical` and no active handoff exists — same
--      tool surface, a deterministic DB-based fallback lands a non-empty
--      payload if the model refuses to call the tool.
--
-- Consumption path:
--   - Phase II of the checkpoint (inside the existing write tx, under the
--     per-session mutex from PR-8) calls `consume()` for the
--     `target_checkpoint_generation = bumped_gen` row. A freshly-committed
--     handoff fed by PR-10 recall seeds the next turn post-compact.
--
-- Invariants:
--   - `uniq_handoff_active`: at most one `active` row per
--     (session_id, target_checkpoint_generation). Concurrent writers race
--     via `latest-wins supersede` — the later `writeHandoff` flips the
--     previous active row to `superseded` in the same tx.
--   - status CHECK — only the three known values persist.
--   - `payload` is a JSON envelope (`preserve_md`, `preferred_recall_query`,
--     `important_entities`, `open_loops`); bounds are enforced in Zod at
--     the tool boundary so the DB stays open-schema.

CREATE TABLE checkpoint_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  target_checkpoint_generation INTEGER NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX uniq_handoff_active
  ON checkpoint_handoffs (session_id, target_checkpoint_generation)
  WHERE status = 'active';

CREATE INDEX idx_handoff_session_active
  ON checkpoint_handoffs (session_id, target_checkpoint_generation)
  WHERE status = 'active';

COMMENT ON TABLE checkpoint_handoffs IS
  'Pre-checkpoint handoffs — active row feeds post-compact recall seed (PR-10). Phase II of executeCheckpoint consumes the row for the freshly-bumped generation inside the same tx.';
