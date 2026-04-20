-- Wake-driven autonomy (PR-4 of the wake roadmap) — per-session wake requests.
--
-- This table is the durable substrate for `loop_defer` (PR-5). The tool writes
-- one row per deferred turn; the wake executor (PR-7) polls due rows, claims
-- them exactly-once via FOR UPDATE SKIP LOCKED, and resumes the mission run or
-- full-autonomous session. Rows move pending → consumed (executor claim) or
-- pending → cancelled (user preemption via ingress router).
--
-- Contracts load-bearing for the rest of the roadmap:
--
--   1. `uniq_loop_wake_pending_per_session` (partial unique on session_id
--      WHERE status='pending'). Guarantees at most one pending wake per
--      session — loop_defer `ON CONFLICT DO NOTHING` uses this to reject
--      double-enqueue idempotently. User preemption cancels that single row
--      atomically before routing the user message.
--
--   2. `idx_loop_wake_due` (partial on (status, due_at) WHERE status='pending').
--      The executor's `claimDue()` reads under this index; skipping consumed /
--      cancelled rows keeps the scan cheap even as the table grows.
--
--   3. `kind` discriminator — executor dispatches to `resumeMissionRun` for
--      `mission_run` and `resumeFullAutonomousSession` (PR-10) for
--      `full_autonomous`. `mission_run_id` is NULL for full_autonomous wakes.
--
-- UUID default: `gen_random_uuid()` is core Postgres 13+ (no pgcrypto needed).
-- Integration tests run on pgvector/pgvector:0.8.2-pg18-trixie.

CREATE TABLE loop_wake_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  mission_run_id TEXT NULL REFERENCES mission_runs(id),
  kind TEXT NOT NULL CHECK (kind IN ('mission_run', 'full_autonomous')),
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'cancelled')),
  reason TEXT NULL,
  payload JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_reason TEXT NULL
);

-- Executor hot path — partial index so consumed / cancelled rows don't bloat it.
CREATE INDEX idx_loop_wake_due
  ON loop_wake_requests (status, due_at)
  WHERE status = 'pending';

-- One-pending-per-session invariant. `loop_defer` handler relies on
-- `ON CONFLICT DO NOTHING` against this index.
CREATE UNIQUE INDEX uniq_loop_wake_pending_per_session
  ON loop_wake_requests (session_id)
  WHERE status = 'pending';

COMMENT ON TABLE loop_wake_requests IS
  'Per-session wake requests written by loop_defer (PR-5), claimed by the wake executor (PR-7). One pending row per session enforced by partial unique index. Status transitions: pending → consumed (executor) or pending → cancelled (user preemption). Irreversible — no "re-pending" transition.';
