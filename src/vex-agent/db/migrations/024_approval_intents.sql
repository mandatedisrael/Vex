-- Puzzle 5 phase 2 — approval_intents companion table.
--
-- Companion-only (plan §05 approval-DB-model). The legacy `approval_queue`
-- stays untouched: it remains the source of truth for "is there a pending
-- approval", `status` (pending/approved/rejected), `tool_call` JSONB
-- (raw args), `reasoning`, and `permission_at_enqueue` snapshot.
--
-- `approval_intents` adds the puzzle-5 policy layer columns at the same
-- granularity (one row per approval, FK approval_id → approval_queue.id
-- with ON DELETE CASCADE). Phase 2 writes the snapshot columns at
-- enqueue time (action_kind, risk_level, preview_json, policy_json);
-- phase 3 wires the runtime to populate decision / decision_reason /
-- decided_at / execution_status / execution_result_hash + the
-- idempotency_key / expires_at gates.
--
-- Critically: decision (user choice: approved / rejected / rejected_stop)
-- and execution_status (tool dispatch outcome: not_started / dispatching
-- / succeeded / failed) are SEPARATE columns. The current pattern of
-- "flip approval row to 'approved', then dispatch" risks a state where
-- a row looks executed but the tool actually failed; phase 3 leverages
-- this split.
--
-- `rejected_stop` is included in the decision CHECK now even though
-- phase 2 cannot write it — phase 3 reject-and-stop UI gates against
-- the same CHECK constraint (cheaper than ADD CONSTRAINT migration).
--
-- Forward-only. All phase-3-populated columns NULL-able (decision,
-- decision_reason, decided_at, expires_at, idempotency_key,
-- execution_result_hash) so existing rows can stay valid while their
-- phase 3 fields settle.

CREATE TABLE IF NOT EXISTS approval_intents (
  approval_id           TEXT PRIMARY KEY REFERENCES approval_queue(id) ON DELETE CASCADE,
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mission_run_id        TEXT REFERENCES mission_runs(id) ON DELETE SET NULL,
  tool_call_id          TEXT,
  action_kind           TEXT NOT NULL CHECK (action_kind IN (
    'read',
    'local_write',
    'schedule',
    'approval_prepare',
    'user_wallet_broadcast',
    'provider_action_request',
    'external_post',
    'destructive'
  )),
  risk_level            TEXT NOT NULL CHECK (risk_level IN (
    'info', 'low', 'medium', 'high', 'critical'
  )),
  preview_json          JSONB NOT NULL CHECK (jsonb_typeof(preview_json) = 'object'),
  policy_json           JSONB NOT NULL CHECK (jsonb_typeof(policy_json) = 'object'),
  expires_at            TIMESTAMPTZ,
  idempotency_key       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at            TIMESTAMPTZ,
  decision              TEXT CHECK (
    decision IS NULL OR decision IN ('approved', 'rejected', 'rejected_stop')
  ),
  decision_reason       TEXT,
  execution_status      TEXT NOT NULL DEFAULT 'not_started' CHECK (
    execution_status IN ('not_started', 'dispatching', 'succeeded', 'failed')
  ),
  execution_result_hash TEXT
);

-- Hot path: per-session approval queue panels list pending intents.
CREATE INDEX IF NOT EXISTS idx_approval_intents_session
  ON approval_intents (session_id);

-- Per-mission-run audit lookup (phase 7 audit UI).
CREATE INDEX IF NOT EXISTS idx_approval_intents_mission_run
  ON approval_intents (mission_run_id)
  WHERE mission_run_id IS NOT NULL;

-- Idempotency gate for phase 3 approve dispatch. Phase 2 inserts NULL
-- here; the UNIQUE WHERE predicate makes the partial index a no-op
-- until phase 3 starts setting keys at approve time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_intents_idempotency
  ON approval_intents (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Phase 3 / phase 7 TTL sweep hot path.
CREATE INDEX IF NOT EXISTS idx_approval_intents_expires
  ON approval_intents (expires_at)
  WHERE expires_at IS NOT NULL;
