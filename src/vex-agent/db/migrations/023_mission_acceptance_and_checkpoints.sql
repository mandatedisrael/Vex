-- Puzzle 04 — mission contract host-only acceptance + rewind checkpoints
-- for the /restore command. Single migration covering three concerns
-- because they share the same PR boundary and atomic schema change.
--
--   1. Mission acceptance metadata (host-only) — four explicit columns
--      on `missions` replacing the model-writable
--      `constraints_json.stopConditionsAccepted` boolean. The CHECK
--      constraint enforces all-four-or-none atomicity, so partial
--      acceptance is unrepresentable.
--
--   2. Mission-level lineage for `/mission-renew` — separate from the
--      run-level `mission_runs.recovered_from_run_id` (mig 015), which
--      tracks recovery of a failed run, not contract renewal.
--
--   3. Rewind checkpoints for `/restore` — stamps each
--      `messages_archive` row with the checkpoint id that produced it,
--      so restore can precisely unarchive only the rewind-archived rows
--      (NOT compaction or giant-tool-overflow rows, which also live in
--      `messages_archive` with `rewind_checkpoint_id IS NULL`).
--
-- Ordering matters: `rewind_checkpoints` must exist BEFORE the FK on
-- `messages_archive.rewind_checkpoint_id` can be added.
--
-- Forward-only. All new columns NULL-able so existing rows keep
-- satisfying the schema without backfill.

-- ══════════════════════════════════════════════════════════════════
-- 1) rewind_checkpoints (FK target — created first)
-- ══════════════════════════════════════════════════════════════════
-- Range info (cutoff_message_id + cutoff_created_at + archived_count)
-- is kept for audit/debug. Restore semantics use the
-- `messages_archive.rewind_checkpoint_id` stamp instead of a range
-- query — see migration step (2) for the rationale.

CREATE TABLE IF NOT EXISTS rewind_checkpoints (
  id                      TEXT PRIMARY KEY,
  session_id              TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mission_run_id          TEXT REFERENCES mission_runs(id) ON DELETE SET NULL,
  cutoff_message_id       INTEGER NOT NULL,
  cutoff_created_at       TIMESTAMPTZ NOT NULL,
  archived_count          INTEGER NOT NULL DEFAULT 0,
  created_by              TEXT NOT NULL DEFAULT 'user'
                            CHECK (created_by IN ('user', 'system')),
  reason                  TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_at             TIMESTAMPTZ,
  restore_idempotency_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_rewind_checkpoints_session
  ON rewind_checkpoints (session_id);

-- Hot path: `/restore` = LIFO — "latest unrestored checkpoint for this
-- session". Partial index excludes terminal (restored) rows.
CREATE INDEX IF NOT EXISTS idx_rewind_checkpoints_unrestored
  ON rewind_checkpoints (session_id, created_at DESC)
  WHERE restored_at IS NULL;

-- DB-level safety net for restore idempotency: a second restore call
-- using the same key cannot land twice even if app logic has a bug.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rewind_checkpoints_idempotency
  ON rewind_checkpoints (restore_idempotency_key)
  WHERE restore_idempotency_key IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════
-- 2) messages_archive stamp — must reference rewind_checkpoints
-- ══════════════════════════════════════════════════════════════════
-- Three writers archive into `messages_archive`:
--   - `archiveSuffix` (rewind path) — stamps `rewind_checkpoint_id`.
--   - `archivePrefix` (compaction) — stamps NULL.
--   - `forkToolMessageToArchive` (giant-tool overflow) — stamps NULL.
-- `/restore` unarchives by `rewind_checkpoint_id = <id>`, never by a
-- range query, so compaction/overflow rows are never resurrected.
-- ON DELETE SET NULL: deleting a checkpoint never deletes archive
-- history; it just severs the restore lookup pointer.

ALTER TABLE messages_archive
  ADD COLUMN IF NOT EXISTS rewind_checkpoint_id TEXT
    REFERENCES rewind_checkpoints(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_archive_rewind_checkpoint
  ON messages_archive (rewind_checkpoint_id)
  WHERE rewind_checkpoint_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════
-- 3) Mission acceptance + lineage columns
-- ══════════════════════════════════════════════════════════════════
-- All four acceptance columns are atomic: either all set (accepted) or
-- all NULL (unaccepted). `updateDraft` / `clearAcceptance` writes the
-- four-tuple as NULL inside a row-locked tx; `acceptContract` writes
-- them all together. The CHECK constraint makes partial state
-- unrepresentable.
--
-- `renewed_from_mission_id` is mission-level lineage for /mission-renew,
-- distinct from `mission_runs.recovered_from_run_id` (mig 015) which is
-- run-level recovery lineage.

ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS accepted_contract_hash  TEXT,
  ADD COLUMN IF NOT EXISTS accepted_contract_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_contract_by    TEXT,
  ADD COLUMN IF NOT EXISTS contract_hash_version   INTEGER,
  ADD COLUMN IF NOT EXISTS renewed_from_mission_id TEXT REFERENCES missions(id);

-- `ADD CONSTRAINT IF NOT EXISTS` for CHECK constraints arrived in PG 13,
-- but the repo's pgvector base image (`pgvector/pgvector:0.8.2-pg18-trixie`,
-- 001_initial.sql:17) is PG 18 so it's safe to use the modern form
-- directly. Use the DO block guard for portability with older local
-- dev environments that might still run PG 12.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_missions_acceptance_atomicity'
  ) THEN
    ALTER TABLE missions
      ADD CONSTRAINT chk_missions_acceptance_atomicity CHECK (
        (
          accepted_contract_hash IS NULL
          AND accepted_contract_at IS NULL
          AND accepted_contract_by IS NULL
          AND contract_hash_version IS NULL
        )
        OR (
          accepted_contract_hash IS NOT NULL
          AND accepted_contract_at IS NOT NULL
          AND accepted_contract_by IS NOT NULL
          AND contract_hash_version IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_missions_accepted_hash
  ON missions (accepted_contract_hash)
  WHERE accepted_contract_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_missions_renewed_from
  ON missions (renewed_from_mission_id)
  WHERE renewed_from_mission_id IS NOT NULL;
