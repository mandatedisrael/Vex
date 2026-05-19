-- Local bug reports — canonical sink for user-initiated reports and (Phase 2)
-- programmatic agent runtime emissions. NOT a normalization of
-- compact_jobs.last_error / subagents.error / runtime_cycles.error_message —
-- those remain in-domain state machines + retry evidence. This table holds
-- support records with bounded, redacted context that may (Phase 3) be uploaded
-- to an external backend via a separate consent.
--
-- Source of truth = this file. Mirrored into vex-app/resources/migrations/ by
-- vex-app/scripts/copy-migrations.mjs (filter: /^\d{3}_/.test(name)).
--
-- Soft references to agent state (session_id, mission_run_id, compact_job_id,
-- etc.) are intentionally NOT foreign keys: vex-app records reports even when
-- the referenced row was reaped or has not been materialized in the app pool
-- perspective. Filtering integrity is enforced at insert time by the service
-- layer, not the database.
--
-- Redaction is applied by the service layer BEFORE insert (see
-- vex-app/src/main/support/bug-report-service.ts). The redaction_*_count
-- columns are proof of redaction at insert time, never input by the renderer.

CREATE TABLE IF NOT EXISTS bug_reports (
  id                          TEXT PRIMARY KEY,                       -- uuid v4 stamped in main
  report_kind                 TEXT NOT NULL
                                CHECK (report_kind IN ('manual', 'automatic')),
  source                      TEXT NOT NULL
                                CHECK (source IN ('user', 'renderer', 'main', 'agent', 'worker')),
  category                    TEXT NOT NULL
                                CHECK (category ~ '^[a-z][a-z0-9_]{2,80}$'),
  severity                    TEXT NOT NULL DEFAULT 'error'
                                CHECK (severity IN ('info', 'warning', 'error', 'critical')),

  title                       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description                 TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 8000),

  status                      TEXT NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open', 'triaged', 'dismissed')),

  -- Upload state machine (Phase 3 prep — no worker, no transport in Phase 1).
  upload_state                TEXT NOT NULL DEFAULT 'not_configured'
                                CHECK (upload_state IN ('not_configured', 'queued', 'uploading', 'uploaded', 'failed')),
  upload_attempt_count        INTEGER NOT NULL DEFAULT 0
                                CHECK (upload_attempt_count >= 0),
  next_upload_at              TIMESTAMPTZ,
  last_upload_error           TEXT,
  remote_report_id            TEXT,
  uploaded_at                 TIMESTAMPTZ,

  -- Environment stamp (no secrets — process.platform + app version + install_id).
  app_version                 TEXT,
  os_platform                 TEXT,
  install_id                  TEXT,

  -- Soft references to agent state. NOT foreign keys (see header comment).
  correlation_id              TEXT,
  session_id                  TEXT,
  mission_id                  TEXT,
  mission_run_id              TEXT,
  subagent_id                 TEXT,
  tool_name                   TEXT,
  tool_call_id                TEXT,
  protocol_namespace          TEXT,
  compact_job_id              INTEGER,

  -- Agent-domain context (filled by Phase 2 programmatic emitters; Phase 1 keeps these nullable).
  stop_reason                 TEXT,
  runtime_status              TEXT,
  context_pressure_band       TEXT
                                CHECK (context_pressure_band IS NULL
                                       OR context_pressure_band IN ('normal', 'warning', 'barrier', 'critical')),
  context_pressure_fraction   NUMERIC(5,4)
                                CHECK (context_pressure_fraction IS NULL
                                       OR (context_pressure_fraction >= 0
                                           AND context_pressure_fraction <= 1)),
  checkpoint_generation       INTEGER,
  post_compact_bridge_active  BOOLEAN,

  -- Redaction telemetry (proof of redaction at insert time).
  redaction_hard_count        INTEGER NOT NULL DEFAULT 0
                                CHECK (redaction_hard_count >= 0),
  redaction_mask_count        INTEGER NOT NULL DEFAULT 0
                                CHECK (redaction_mask_count >= 0),

  -- Bounded JSON payloads — service layer enforces size/key allowlist before insert.
  sanitized_context           JSONB NOT NULL DEFAULT '{}'::jsonb
                                CHECK (jsonb_typeof(sanitized_context) = 'object'),
  attachments                 JSONB NOT NULL DEFAULT '[]'::jsonb
                                CHECK (jsonb_typeof(attachments) = 'array'),

  -- Retention: manual reports keep retention_until NULL (user-driven delete);
  -- automatic reports default to created_at + 90 days (set by service layer).
  retention_until             TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_created
  ON bug_reports(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bug_reports_category_created
  ON bug_reports(category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bug_reports_correlation
  ON bug_reports(correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bug_reports_session
  ON bug_reports(session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

-- Phase 3 prep: upload worker polls due rows.
CREATE INDEX IF NOT EXISTS idx_bug_reports_upload_due
  ON bug_reports(upload_state, next_upload_at)
  WHERE upload_state IN ('queued', 'failed');

-- Retention sweep partial index.
CREATE INDEX IF NOT EXISTS idx_bug_reports_retention
  ON bug_reports(retention_until)
  WHERE retention_until IS NOT NULL;

COMMENT ON TABLE bug_reports IS
  'Local-first sink for user-initiated and (Phase 2) programmatic agent bug reports. References to agent tables (session_id, mission_run_id, compact_job_id, ...) are soft (no FK) so vex-app can persist reports even when the target row was reaped or never materialized in the vex-app pool perspective. Two-tier redaction applied BEFORE insert in vex-app/src/main/support/bug-report-service.ts. Upload state machine prepared for Phase 3 backend transport (currently NoopBugReportTransport).';

COMMENT ON COLUMN bug_reports.redaction_hard_count IS
  'Count of Tier 1 hard-redactions (mnemonics, private keys, API keys, JWTs, key-named fields) applied at insert time. > 0 means at least one secret-shaped value was scrubbed before persistence.';

COMMENT ON COLUMN bug_reports.redaction_mask_count IS
  'Count of Tier 2 masks (EVM addresses, Solana addresses, tx hashes) applied at insert time. Masking preserves semantic shape (e.g. 0xabcd…1234) for diagnostic value while preventing full-value retention.';
