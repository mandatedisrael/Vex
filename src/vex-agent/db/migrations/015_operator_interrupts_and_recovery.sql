-- Operator interrupts, full-autonomous run state, and mission run recovery.

ALTER TABLE mission_runs
  ADD COLUMN contract_snapshot_json JSONB,
  ADD COLUMN recovered_from_run_id TEXT NULL REFERENCES mission_runs(id);

CREATE INDEX idx_mission_runs_recovered_from
  ON mission_runs(recovered_from_run_id)
  WHERE recovered_from_run_id IS NOT NULL;

CREATE TABLE full_autonomous_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'paused_wake', 'paused_error', 'stopped', 'failed')),
  loop_mode TEXT NOT NULL DEFAULT 'full',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_checkpoint_at TIMESTAMPTZ,
  stop_reason TEXT,
  stop_summary TEXT,
  stop_evidence_json JSONB,
  iteration_count INTEGER DEFAULT 0
);

CREATE INDEX idx_full_autonomous_runs_session
  ON full_autonomous_runs(session_id);

CREATE INDEX idx_full_autonomous_runs_status
  ON full_autonomous_runs(status);

CREATE INDEX idx_full_autonomous_runs_active_session
  ON full_autonomous_runs(session_id, started_at DESC)
  WHERE status IN ('running', 'paused_wake', 'paused_error');
