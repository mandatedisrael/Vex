-- Echo Agent — initial schema
-- DB-first architecture, own database (ECHO_AGENT_DB_URL)
-- No legacy migration — clean start

-- ══════════════════════════════════════════════════════════════════
-- A. Identity & Content
-- ══════════════════════════════════════════════════════════════════

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- pgvector extension — required for knowledge_entries.embedding column
-- Image must be pgvector/pgvector:0.8.2-pg18-trixie (or compatible) which has the extension preinstalled.
CREATE EXTENSION IF NOT EXISTS vector;

-- Soul — singleton agent identity
CREATE TABLE soul (
  id INTEGER PRIMARY KEY DEFAULT 1,
  content_md TEXT NOT NULL DEFAULT '',
  pfp_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO soul (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Knowledge — canonical agent memory with embeddings + tiered TTL.
-- Replaces former memory_entries. Free-form `kind` (snake_case, agent-defined),
-- English-only title/summary/content_md, embedding-on-write via Docker Model Runner.
CREATE TABLE knowledge_entries (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL,            -- free-form, agent-defined snake_case (e.g. pumpfun_entry_pattern, risk_rule)
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,            -- 1-3 sentences, embedding input together with title
  content_md      TEXT NOT NULL DEFAULT '', -- full text, returned by recall (inline or via cache overflow)
  tags            TEXT[] DEFAULT '{}',
  source_refs     JSONB DEFAULT '{}',       -- { protocol_executions:[ids], proj_activity:[ids], proj_pnl_lots:[ids] }
  confidence      REAL,                     -- 0..1, optional
  status          TEXT NOT NULL DEFAULT 'active', -- active | superseded | invalidated | archived
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until     TIMESTAMPTZ,              -- NULL = pinned/evergreen, bypasses TTL filter
  embedding_model TEXT NOT NULL,            -- audit: which model produced the embedding
  embedding_dim   INTEGER NOT NULL,         -- audit: model dim (locked at 768 in MVP)
  embedding       vector(768) NOT NULL,     -- embedding-on-write — entry never created without sidecar
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ke_status_validity ON knowledge_entries(status, valid_until DESC);
CREATE INDEX idx_ke_kind ON knowledge_entries(kind);
CREATE INDEX idx_ke_pinned ON knowledge_entries(pinned) WHERE pinned = TRUE;
CREATE INDEX idx_ke_tags ON knowledge_entries USING GIN (tags);
CREATE INDEX idx_ke_source_refs ON knowledge_entries USING GIN (source_refs jsonb_path_ops);
-- No vector index in MVP. Exact cosine scan after status/kind/validity prefilter is OK to ~5k entries.

-- Folders — first-class directory tree
-- Default space 'notes' (canonical knowledge layer is now knowledge_entries, not documents).
-- 'cache' is a system-only space used by knowledge_recall overflow — not exposed via document_* tools.
CREATE TABLE folders (
  id SERIAL PRIMARY KEY,
  space TEXT NOT NULL DEFAULT 'notes',
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Split unique indexes: Postgres NULL ≠ NULL in unique constraints
CREATE UNIQUE INDEX idx_folders_slug_root ON folders(space, slug)
  WHERE parent_id IS NULL;
CREATE UNIQUE INDEX idx_folders_slug_nested ON folders(space, parent_id, slug)
  WHERE parent_id IS NOT NULL;
CREATE INDEX idx_folders_space ON folders(space);
CREATE INDEX idx_folders_parent ON folders(parent_id);

-- Documents — DB-first markdown content with folder FK
-- Default space 'notes' (freeform agent scratchpad). Canonical structured wisdom lives in knowledge_entries.
-- 'cache' is reserved for knowledge_recall overflow (system-only, not exposed via document_* tools).
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  space TEXT NOT NULL DEFAULT 'notes',
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
-- Split unique indexes for NULL folder_id (root documents)
CREATE UNIQUE INDEX idx_documents_slug_root ON documents(space, slug)
  WHERE folder_id IS NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX idx_documents_slug_folder ON documents(space, folder_id, slug)
  WHERE folder_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX idx_documents_space ON documents(space);
CREATE INDEX idx_documents_folder ON documents(folder_id);
CREATE INDEX idx_documents_updated ON documents(updated_at DESC);

-- ══════════════════════════════════════════════════════════════════
-- B. Runtime & Sessions
-- ══════════════════════════════════════════════════════════════════

-- Sessions (no parent_session_id — session_links is canonical)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  scope TEXT DEFAULT 'chat',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  summary TEXT,
  compacted BOOLEAN DEFAULT FALSE,
  message_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0
);
CREATE INDEX idx_sessions_scope ON sessions(scope, started_at DESC);

-- Messages
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_call_id TEXT,
  tool_calls JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);

-- Messages archive (compaction checkpoint)
CREATE TABLE messages_archive (LIKE messages INCLUDING INDEXES);

-- Approvals (with pending_context for round-trip toolCallId)
CREATE TABLE approval_queue (
  id TEXT PRIMARY KEY,
  tool_call JSONB NOT NULL,
  reasoning TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  session_id TEXT REFERENCES sessions(id),
  tool_call_id TEXT,
  chat_mode TEXT DEFAULT 'restricted',
  source TEXT DEFAULT 'chat',
  pending_context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_approvals_status ON approval_queue(status);
CREATE INDEX idx_approvals_session ON approval_queue(session_id) WHERE status = 'pending';

-- Runtime state (singleton for loop engine)
CREATE TABLE runtime_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  active BOOLEAN DEFAULT FALSE,
  mode TEXT DEFAULT 'restricted',
  interval_ms INTEGER DEFAULT 300000,
  current_phase TEXT DEFAULT 'idle',
  phase_started_at TIMESTAMPTZ,
  loop_session_id TEXT,
  started_at TIMESTAMPTZ,
  last_cycle_at TIMESTAMPTZ,
  cycle_count INTEGER DEFAULT 0
);
INSERT INTO runtime_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Runtime cycles (audit trail)
CREATE TABLE runtime_cycles (
  id SERIAL PRIMARY KEY,
  cycle_number INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  phases_completed TEXT[] DEFAULT '{}',
  outcome TEXT,
  decisions JSONB DEFAULT '{}',
  token_cost NUMERIC DEFAULT 0,
  error_message TEXT
);
CREATE INDEX idx_cycles_started ON runtime_cycles(started_at DESC);

-- ══════════════════════════════════════════════════════════════════
-- C. Automation
-- ══════════════════════════════════════════════════════════════════

-- Schedules (no cli_execute — tool_call, wake_agent, reminder, monitor, snapshot, backup)
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cron_expression TEXT NOT NULL,
  task_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN DEFAULT TRUE,
  loop_mode TEXT DEFAULT 'restricted',
  last_run_at TIMESTAMPTZ,
  run_count INTEGER DEFAULT 0,
  last_result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_schedules_enabled ON schedules(enabled);

-- Schedule runs (audit)
CREATE TABLE schedule_runs (
  id SERIAL PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  result JSONB,
  error TEXT
);
CREATE INDEX idx_schedule_runs_schedule ON schedule_runs(schedule_id, started_at DESC);

-- Subagents (no parent/session fields — session_links is canonical)
CREATE TABLE subagents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  allow_trades BOOLEAN DEFAULT FALSE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  result TEXT,
  error TEXT,
  token_cost NUMERIC DEFAULT 0,
  iterations INTEGER DEFAULT 0,
  max_iterations INTEGER DEFAULT 25
);
CREATE INDEX idx_subagents_status ON subagents(status);

-- Session links — canonical parent-child session relationships
-- Replaces parent_session_id on sessions/subagents.
-- Covers: subagent, scheduler, loop, handoff relationships.
CREATE TABLE session_links (
  id SERIAL PRIMARY KEY,
  parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  child_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  subagent_id TEXT REFERENCES subagents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_session_links_active
  ON session_links(parent_session_id, child_session_id, relation_type)
  WHERE ended_at IS NULL;
CREATE INDEX idx_session_links_parent ON session_links(parent_session_id);
CREATE INDEX idx_session_links_child ON session_links(child_session_id);
CREATE INDEX idx_session_links_subagent ON session_links(subagent_id) WHERE subagent_id IS NOT NULL;

-- Subagent messages — structured parent ↔ child channel
-- message_type: relay (plain text), request_parent, reply, report_complete
CREATE TABLE subagent_messages (
  id SERIAL PRIMARY KEY,
  subagent_id TEXT NOT NULL REFERENCES subagents(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'relay',
  payload_json JSONB,
  reply_to_message_id INTEGER REFERENCES subagent_messages(id),
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_subagent_msgs ON subagent_messages(subagent_id, created_at);
CREATE INDEX idx_subagent_msgs_unhandled ON subagent_messages(subagent_id, direction, message_type)
  WHERE handled_at IS NULL;

-- Inbox events (autonomy queue)
CREATE TABLE inbox_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  consumed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inbox_pending ON inbox_events(consumed, created_at) WHERE consumed = FALSE;

-- ══════════════════════════════════════════════════════════════════
-- D. Inference & Provider
-- ══════════════════════════════════════════════════════════════════

-- Usage log — extended for echo-agent inference layer
CREATE TABLE usage_log (
  id SERIAL PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  cached_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  cost NUMERIC NOT NULL,
  provider TEXT,
  model TEXT,
  currency TEXT DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_usage_created ON usage_log(created_at DESC);
CREATE INDEX idx_usage_session ON usage_log(session_id);
CREATE INDEX idx_usage_provider ON usage_log(provider, created_at DESC);

-- Billing snapshots (provider balance tracking)
CREATE TABLE billing_snapshots (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  currency TEXT DEFAULT 'USD',
  provider_balance NUMERIC NOT NULL,
  provider_available NUMERIC NOT NULL,
  provider_locked NUMERIC NOT NULL DEFAULT 0,
  session_cost NUMERIC NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_billing_time ON billing_snapshots(fetched_at DESC);
CREATE INDEX idx_billing_provider ON billing_snapshots(provider, fetched_at DESC);

-- ══════════════════════════════════════════════════════════════════
-- E. Protocol Executions, Sync & Projections
-- ══════════════════════════════════════════════════════════════════

-- Protocol executions — audit log of every mutating tool call
-- external_refs keys per namespace:
--   khalani: txHash, orderId
--   solana:  signature, positionPubkey, orderKey
--   kyberswap: txHash, orderId, positionId
--   polymarket: orderId, conditionId
CREATE TABLE protocol_executions (
  id SERIAL PRIMARY KEY,
  tool_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  session_id TEXT,
  params JSONB NOT NULL DEFAULT '{}',
  result JSONB NOT NULL DEFAULT '{}',
  success BOOLEAN NOT NULL,
  trade_capture JSONB,
  external_refs JSONB DEFAULT '{}',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_executions_namespace ON protocol_executions(namespace, created_at DESC);
CREATE INDEX idx_executions_tool ON protocol_executions(tool_id, created_at DESC);
CREATE INDEX idx_executions_session ON protocol_executions(session_id);
CREATE INDEX idx_executions_refs ON protocol_executions USING GIN (external_refs jsonb_path_ops);
CREATE INDEX idx_executions_tx_hash ON protocol_executions((external_refs->>'txHash'))
  WHERE external_refs->>'txHash' IS NOT NULL;
CREATE INDEX idx_executions_order_id ON protocol_executions((external_refs->>'orderId'))
  WHERE external_refs->>'orderId' IS NOT NULL;
CREATE INDEX idx_executions_position ON protocol_executions((external_refs->>'positionPubkey'))
  WHERE external_refs->>'positionPubkey' IS NOT NULL;

-- Protocol capture items — per-position/per-trade items within a single execution
-- Batch tool calls (e.g. predict.closeAll) produce 1 execution + N capture items.
-- Single tool calls synthesize 1 item from _tradeCapture for uniform downstream processing.
CREATE TABLE protocol_capture_items (
  id SERIAL PRIMARY KEY,
  execution_id INTEGER NOT NULL REFERENCES protocol_executions(id) ON DELETE CASCADE,
  item_index SMALLINT NOT NULL DEFAULT 0,
  trade_capture JSONB NOT NULL,
  external_refs JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_capture_items_execution ON protocol_capture_items(execution_id);

-- Protocol sync jobs — refresh strategies per namespace
CREATE TABLE protocol_sync_jobs (
  id SERIAL PRIMARY KEY,
  namespace TEXT NOT NULL,
  sync_type TEXT NOT NULL,
  read_tool_id TEXT,
  strategy TEXT NOT NULL DEFAULT 'post_mutation',
  interval_seconds INTEGER,
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_sync_jobs_unique ON protocol_sync_jobs(namespace, sync_type);

-- Protocol sync runs — audit of sync executions
CREATE TABLE protocol_sync_runs (
  id SERIAL PRIMARY KEY,
  sync_job_id INTEGER NOT NULL REFERENCES protocol_sync_jobs(id) ON DELETE CASCADE,
  execution_id INTEGER REFERENCES protocol_executions(id),
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  rows_affected INTEGER DEFAULT 0
);
CREATE INDEX idx_sync_runs_job ON protocol_sync_runs(sync_job_id, started_at DESC);
CREATE INDEX idx_sync_runs_status ON protocol_sync_runs(status) WHERE status IN ('pending', 'running');

-- ── Projection table skeletons ──────────────────────────────────

-- Multi-chain token balances (source: khalani.tokens.balances)
CREATE TABLE proj_balances (
  id SERIAL PRIMARY KEY,
  wallet_family TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  chain_id INTEGER,
  token_address TEXT NOT NULL,
  token_symbol TEXT,
  token_name TEXT,
  balance_raw TEXT NOT NULL DEFAULT '0',
  balance_usd NUMERIC,
  price_usd NUMERIC,
  decimals INTEGER,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_balances_token ON proj_balances(wallet_address, chain_id, token_address);
CREATE INDEX idx_balances_wallet ON proj_balances(wallet_address);

-- Portfolio snapshots (time-series from balance projections)
CREATE TABLE proj_portfolio_snapshots (
  id SERIAL PRIMARY KEY,
  total_usd NUMERIC NOT NULL,
  positions JSONB NOT NULL,
  active_chains TEXT[] DEFAULT '{}',
  pnl_vs_prev NUMERIC,
  pnl_pct_vs_prev NUMERIC,
  source TEXT DEFAULT 'sync',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_portfolio_time ON proj_portfolio_snapshots(created_at DESC);

-- Open positions — cross-protocol aggregation
-- Covers: perps, predictions, DCA/limit orders, LP positions
CREATE TABLE proj_open_positions (
  id SERIAL PRIMARY KEY,
  namespace TEXT NOT NULL,
  position_type TEXT NOT NULL,
  chain TEXT NOT NULL,
  external_id TEXT,
  wallet_address TEXT NOT NULL,
  instrument_key TEXT,
  position_key TEXT,
  entry_price_usd NUMERIC,
  current_value_usd NUMERIC,
  unrealized_pnl_usd NUMERIC,
  data JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  last_refresh_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_positions_external ON proj_open_positions(namespace, position_type, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX idx_positions_wallet ON proj_open_positions(wallet_address, status);
CREATE INDEX idx_positions_namespace ON proj_open_positions(namespace, status);
CREATE INDEX idx_positions_instrument ON proj_open_positions(instrument_key) WHERE instrument_key IS NOT NULL;
CREATE INDEX idx_positions_position_key ON proj_open_positions(position_key) WHERE position_key IS NOT NULL;

-- Activity feed — unified cross-protocol activity with semantic side
-- trade_side: ONLY for real trades (spot buy/sell, perps open/close, prediction buy/sell)
-- NULL for: bridge, lend, stake, lp, reward
-- product_type: spot, perps, prediction, order, lp, lend, stake, bridge, reward
-- instrument_key: canonical per product (solana:{mint}, polymarket:{conditionId}:{outcome}, etc.)
-- position_key: positionPubkey, orderKey, positionId — lifecycle correlation
-- execution_id is NOT unique — batch captures (predict.closeAll) produce N activity rows per execution
-- capture_item_id links to the specific protocol_capture_items row for per-position correlation
CREATE TABLE proj_activity (
  id SERIAL PRIMARY KEY,
  namespace TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  product_type TEXT NOT NULL,
  trade_side TEXT,
  chain TEXT NOT NULL,
  execution_id INTEGER REFERENCES protocol_executions(id),
  capture_item_id INTEGER REFERENCES protocol_capture_items(id),
  wallet_address TEXT,
  input_token TEXT,
  input_amount TEXT,
  output_token TEXT,
  output_amount TEXT,
  value_usd NUMERIC,
  capture_status TEXT,               -- from _tradeCapture.status: executed, open, closed, cancelled, claimed, pending
  position_key TEXT,
  instrument_key TEXT,
  external_refs JSONB DEFAULT '{}',
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_activity_namespace ON proj_activity(namespace, created_at DESC);
CREATE INDEX idx_activity_wallet ON proj_activity(wallet_address, created_at DESC);
CREATE INDEX idx_activity_type ON proj_activity(activity_type, created_at DESC);
CREATE INDEX idx_activity_product ON proj_activity(product_type, created_at DESC);
CREATE INDEX idx_activity_position ON proj_activity(position_key) WHERE position_key IS NOT NULL;
CREATE INDEX idx_activity_instrument ON proj_activity(instrument_key) WHERE instrument_key IS NOT NULL;
CREATE INDEX idx_activity_execution ON proj_activity(execution_id);
CREATE INDEX idx_activity_capture_item ON proj_activity(capture_item_id) WHERE capture_item_id IS NOT NULL;

-- PnL lots — spot DEX cost basis ledger (FIFO)
-- Each buy creates a lot. Sells reduce lots oldest-first.
-- MUST be after proj_activity (activity_id FK)
CREATE TABLE proj_pnl_lots (
  id SERIAL PRIMARY KEY,
  instrument_key TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity_raw TEXT NOT NULL,
  cost_basis_usd NUMERIC,
  price_usd NUMERIC,
  remaining_quantity_raw TEXT NOT NULL,
  execution_id INTEGER REFERENCES protocol_executions(id),
  activity_id INTEGER REFERENCES proj_activity(id),
  namespace TEXT NOT NULL,
  chain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX idx_lots_instrument ON proj_pnl_lots(instrument_key, wallet_address, status);
CREATE INDEX idx_lots_wallet ON proj_pnl_lots(wallet_address, status);
CREATE INDEX idx_lots_execution ON proj_pnl_lots(execution_id);

-- ══════════════════════════════════════════════════════════════════
-- F. Web Cache
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE search_cache (
  query_hash TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  results JSONB NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_search_cached ON search_cache(cached_at);

CREATE TABLE fetch_cache (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  markdown TEXT NOT NULL,
  title TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_fetch_cached ON fetch_cache(fetched_at);
