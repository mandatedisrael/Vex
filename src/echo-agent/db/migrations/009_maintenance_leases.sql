-- PR4 Fase II — maintenance lease (singleton row, row-lock semantics).
--
-- Replaces the soft `runtime_state.active` guard used by reembed with an
-- authoritative write-gate that both reembed and knowledge_entries writers
-- can reason about under row-level locks. Design:
--
--   - One-row table, `id = 1` enforced by CHECK. Any attempt to insert a
--     second row fails at the PK, so the "one lease per instance" invariant
--     is a DB guarantee, not application-side discipline.
--   - Reembed acquires the lease with `SELECT ... FOR UPDATE` on this row
--     inside a short tx, flips `active` to TRUE, commits the tx, then runs
--     the long-running reembed outside the tx. Release = `UPDATE active =
--     FALSE` in `finally`.
--   - Writers take `SELECT ... FOR SHARE` on the same row inside their own
--     tx and fail-fast with `MaintenanceActiveError` if `active = TRUE`.
--     The SHARE × UPDATE row-lock pair closes the TOCTOU gap without
--     needing an advisory lock.
--
-- No TTL / stale-owner recovery in v1. Desktop scenario: reembed is
-- operator-initiated, and a crashed reembed that leaves `active = TRUE`
-- is cleared by hand (`UPDATE maintenance_leases SET active = FALSE
-- WHERE id = 1;`). TTL + force-release-lease CLI are deferred to v2 per
-- plan v5 non-goals.

CREATE TABLE IF NOT EXISTS maintenance_leases (
  id           INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  owner_id     TEXT NOT NULL,
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active       BOOLEAN NOT NULL DEFAULT FALSE
);

-- Seed the singleton row. Idempotent for operators who re-run the migration
-- on a partially-provisioned DB (e.g. manual DROP of the row during dev).
INSERT INTO maintenance_leases (id, owner_id, active)
VALUES (1, '', FALSE)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE maintenance_leases IS
  'Singleton write-gate coordinating reembed (FOR UPDATE + active=TRUE) with knowledge_entries writers (FOR SHARE + fail on active). PR4 Fase II — replaces the soft runtime_state.active guard.';

COMMENT ON COLUMN maintenance_leases.owner_id IS
  'Opaque identifier of the process currently holding the lease (e.g. "reembed:pid-12345"). Empty string when unheld.';

COMMENT ON COLUMN maintenance_leases.active IS
  'TRUE when a maintenance operation (reembed) holds the lease. Writers must fail-fast while this is TRUE.';
