-- Vex — initial schema
-- DB-first architecture, own database (VEX_DB_URL)
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
--
-- Portability contract: vector column has NO typmod (any dim accepted at the type
-- level). Per-row embedding_dim/embedding_model are authoritative — recall MUST
-- filter on them (mixed-dim recall would crash on `<=>`). content_hash UNIQUE
-- gives idempotent writes: same canonical text = same row, repeat write returns
-- existing id (immutable; metadata is NOT silently merged).
CREATE TABLE knowledge_entries (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL,            -- free-form, agent-defined snake_case (e.g. pumpfun_entry_pattern, risk_rule)
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,            -- 1-3 sentences, embedding input together with title
  content_md      TEXT NOT NULL DEFAULT '', -- full text, returned by recall (inline or via cache overflow)
  tags            TEXT[] DEFAULT '{}',
  source_refs     JSONB DEFAULT '{}',       -- durable evidence anchors: immutable protocol_executions.id / protocol_capture_items.id + semantic keys (instrument_key/position_key). NOT proj_* SERIALs — sync/replay.ts TRUNCATEs+regenerates those, so they are unstable across replay.
  confidence      REAL,                     -- 0..1, optional
  status          TEXT NOT NULL DEFAULT 'active', -- active | superseded | invalidated | archived
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until     TIMESTAMPTZ,              -- NULL = pinned/evergreen, bypasses TTL filter
  content_hash    CHAR(64) NOT NULL,        -- sha256 hex of length-prefixed (kind|title|summary|content_md); idempotency key
  embedding_model TEXT NOT NULL,            -- audit: which model produced the embedding (authoritative — recall filters on this)
  embedding_dim   INTEGER NOT NULL,         -- audit: actual provider response dim, NOT a schema lock
  embedding       vector NOT NULL,          -- embedding-on-write — entry never created without sidecar; no typmod (re-embed-friendly)
  source_surface  TEXT NOT NULL DEFAULT 'vex_agent', -- 'vex_agent' (mission loop / chat) or legacy/import provenance
  source_session  TEXT,                     -- session id of the writer (Vex session id or NULL for legacy / scripts)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- ── Memory v2 (influence + bi-temporal lifecycle) ─────────────────────────
  -- These columns are added INLINE on the fresh CREATE (EDIT-IN-PLACE, dev DB
  -- reset; no ALTER/backfill). Legacy-equivalent defaults keep pre-v2 writers
  -- byte-for-byte behavior-neutral.
  --   maturity_state      — lesson-confidence lifecycle, a SEPARATE axis from
  --                         `status` (active/superseded/...): status tracks
  --                         lineage, maturity tracks how trusted the lesson is.
  --                         FSM detail lands in S6; legacy rows = 'established'.
  --   activation_strength — 0..1 weight consumed by recall reranking (S3).
  --                         Decay LOWERS it without deleting the row. Legacy=1.0.
  --   influence_scope     — advisory | retrieval_boost ONLY. Memory is doctrine-
  --                         bound to never feed execution/sizing/approval (OD-1;
  --                         memory-poisoning guard). execution_constraint /
  --                         sizing_hint are intentionally absent and never added.
  --   decay_policy        — how activation_strength erodes (manager worker, S6).
  --   regime_tags         — market-regime labels for reactivation (S6); no NULL
  --                         elements (CHECK below).
  --   first_promoted_at / last_reinforced_at / next_review_at — promotion/review
  --                         timestamps (nullable; set by the manager, not on
  --                         legacy insert).
  --   outcome_version     — bumped by outcome reconciliation (S7) so a lesson is
  --                         re-derived idempotently per (entry_id, outcome_version).
  -- Indexes on maturity/activation are deferred to S3 (no reranking yet).
  maturity_state      TEXT NOT NULL DEFAULT 'established',
  activation_strength REAL NOT NULL DEFAULT 1.0,
  influence_scope     TEXT NOT NULL DEFAULT 'advisory',
  decay_policy        TEXT NOT NULL DEFAULT 'none',
  regime_tags         TEXT[] NOT NULL DEFAULT '{}',
  first_promoted_at   TIMESTAMPTZ,
  last_reinforced_at  TIMESTAMPTZ,
  -- last_decayed_at — when a decay step was last APPLIED (written) to this row.
  -- The INCREMENTAL decay anchor (S6b): each sweep erodes only the quantum since
  -- max(last_reinforced_at, last_decayed_at), so re-running a sweep is a true
  -- no-op and a stale entry decays once per elapsed interval — NEVER compounded
  -- per sweep run (a one-shot-from-reinforcement formula applied to the already-
  -- decayed value would halve a 30-day-stale lesson on EVERY 3h sweep).
  last_decayed_at     TIMESTAMPTZ,
  next_review_at      TIMESTAMPTZ,
  outcome_version     INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT ke_embedding_dim_range CHECK (embedding_dim > 0 AND embedding_dim <= 8192),
  CONSTRAINT ke_embedding_dim_matches_vector CHECK (vector_dims(embedding) = embedding_dim),
  -- S7 hardening: the status vocabulary above was documented but never
  -- CHECK-enforced (legacy gap — sibling tables CHECK their status columns).
  -- S7's reconcile writes 'invalidated' directly in a tx, so the vocabulary
  -- becomes load-bearing. Values = knowledge/policy.ts KnowledgeStatus.
  CONSTRAINT ke_status_valid CHECK (status IN ('active','superseded','invalidated','archived')),
  CONSTRAINT ke_maturity_state_valid CHECK (maturity_state IN ('probationary','established','reinforced','decayed')),
  CONSTRAINT ke_activation_strength_range CHECK (activation_strength >= 0 AND activation_strength <= 1),
  CONSTRAINT ke_influence_scope_valid CHECK (influence_scope IN ('advisory','retrieval_boost')),
  CONSTRAINT ke_decay_policy_valid CHECK (decay_policy IN ('none','time','regime_aware','outcome_aware')),
  CONSTRAINT ke_regime_tags_no_null CHECK (array_position(regime_tags, NULL) IS NULL),
  -- S6b (F2): regime_tags drawn ONLY from the CLOSED regime-tag vocabulary —
  -- array-containment (<@), not an IN-list, because the column is TEXT[].
  -- Lockstep with memory/schema/regime-enums.ts REGIME_TAGS (dedicated
  -- containment parser in the drift-guard test). Vol tags are axis-qualified
  -- ('high_vol', not 'high') because a bare 'high' is ambiguous across axes.
  CONSTRAINT ke_regime_tags_valid CHECK (regime_tags <@ ARRAY['bull','bear','range','high_vol','low_vol']::TEXT[]),
  CONSTRAINT ke_outcome_version_nonneg CHECK (outcome_version >= 0)
);
CREATE INDEX idx_ke_status_validity ON knowledge_entries(status, valid_until DESC);
CREATE INDEX idx_ke_kind ON knowledge_entries(kind);
CREATE INDEX idx_ke_pinned ON knowledge_entries(pinned) WHERE pinned = TRUE;
CREATE INDEX idx_ke_tags ON knowledge_entries USING GIN (tags);
CREATE INDEX idx_ke_source_refs ON knowledge_entries USING GIN (source_refs jsonb_path_ops);
CREATE UNIQUE INDEX idx_ke_content_hash ON knowledge_entries(content_hash);
CREATE INDEX idx_ke_source_surface ON knowledge_entries(source_surface);
-- No vector index in MVP. Exact cosine scan after status/kind/validity prefilter is OK to ~5k entries.
-- The vector column uses no typmod; adding ANN (ivfflat/hnsw) later requires re-typing the column.

-- knowledge_maturity_events — append-only audit of every maturity/activation
-- transition on a knowledge_entries row (S6a — debug "why did this lesson decay /
-- mature / reactivate"). DURABLE append-only audit: `entry_id` is an IMMUTABLE
-- ANCHOR with NO foreign key (same doctrine as memory_decisions' anchor columns),
-- so the log survives a hypothetical knowledge_entries delete and never trips an
-- ON DELETE CASCADE. The maturity FSM NEVER deletes a knowledge row (decay erodes
-- activation to a floor > 0; genesis §956), so an anchor is correct here:
-- referential validity at write time is owned by the repo (recordMaturityEvent is
-- only called by the manager holding a live entry). `event`, `from_state`/
-- `to_state`, `reason_code`, and `decided_by` are CLOSED enums (named CHECKs →
-- lockstep-tested against knowledge/schema/knowledge-maturity-event.ts). The
-- maturity-state CHECKs REUSE the same closed vocabulary as
-- knowledge_entries.maturity_state. `trigger_refs` is a STRUCTURAL JSONB pointer
-- bag ({candidateId?, executionId?, regimeSnapshotId?}) — never raw content;
-- `rationale` is a short structural "why" with NO raw secrets / monetary values
-- (redaction discipline, like memLog). `activation_before/after` are [0,1].
CREATE TABLE knowledge_maturity_events (
  id                BIGSERIAL PRIMARY KEY,
  entry_id          INTEGER NOT NULL,   -- anchor (no FK); the knowledge_entries.id this event is about
  event             TEXT NOT NULL,      -- matured | reinforced | decayed | reactivated (closed enum + lockstep)
  from_state        TEXT NOT NULL,      -- maturity_state BEFORE (probationary|established|reinforced|decayed)
  to_state          TEXT NOT NULL,      -- maturity_state AFTER
  reason_code       TEXT NOT NULL,      -- recurrence_confirmation | time_decay | regime_decay | outcome_change (closed enum + lockstep)
  activation_before REAL NOT NULL,      -- [0,1] activation_strength BEFORE
  activation_after  REAL NOT NULL,      -- [0,1] activation_strength AFTER
  trigger_refs      JSONB NOT NULL DEFAULT '{}',  -- structural pointers ({candidateId?, executionId?, regimeSnapshotId?}); NEVER raw content
  decided_by        TEXT NOT NULL DEFAULT 'system',  -- system | manager (closed enum + lockstep)
  rationale         TEXT,               -- short structural "why"; NO raw secrets/monetary (redaction discipline)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT kme_activation_before_range CHECK (activation_before >= 0 AND activation_before <= 1),
  CONSTRAINT kme_activation_after_range  CHECK (activation_after  >= 0 AND activation_after  <= 1),
  CONSTRAINT kme_trigger_refs_is_object  CHECK (jsonb_typeof(trigger_refs) = 'object'),
  -- NAMED enum CHECKs → lockstep-testable (single source of truth:
  -- vex-agent/memory/schema/knowledge-maturity-event.ts). The from_state/to_state
  -- vocabulary REUSES knowledge_entries.maturity_state (ke_maturity_state_valid).
  CONSTRAINT kme_event_valid       CHECK (event IN ('matured','reinforced','decayed','reactivated')),
  CONSTRAINT kme_from_state_valid  CHECK (from_state IN ('probationary','established','reinforced','decayed')),
  CONSTRAINT kme_to_state_valid    CHECK (to_state IN ('probationary','established','reinforced','decayed')),
  CONSTRAINT kme_reason_code_valid CHECK (reason_code IN ('recurrence_confirmation','time_decay','regime_decay','outcome_change')),
  CONSTRAINT kme_decided_by_valid  CHECK (decided_by IN ('system','manager'))
);
-- Audit history for one entry, newest first (debug "why" timeline).
CREATE INDEX idx_kme_entry ON knowledge_maturity_events(entry_id, created_at DESC);
-- Sweep / metric queries by event type.
CREATE INDEX idx_kme_event ON knowledge_maturity_events(event);

-- regime_snapshots — daily market-regime classification (S6b). ONE row per day
-- (the regime worker's 20h cadence gate): two independent axes (trend × vol)
-- plus a BUCKETED confidence (F4 — never a raw float; LLMs overstate certainty)
-- and the evidence source. Consumed ONLY by regime-aware decay/reactivation —
-- advisory-only by doctrine (OD-1): a snapshot never feeds sizing / approval /
-- wallet-intent / execution. Fail-closed: a day whose sources or classifier
-- failed simply has NO row, and decay degrades to pure time-decay (hence no
-- 'heuristic' source — there is no fallback classifier). The snapshot is
-- deliberately NOT replay-stable (it depends on the live web at classification
-- time); what IS auditable is label + confidence + source + created_at.
-- `rationale` is a short structural "why", redact()-ed at the write boundary —
-- NEVER raw news/tweet content, amounts, or secrets. All four label columns are
-- CLOSED enums (named CHECKs → lockstep-tested against
-- memory/schema/regime-enums.ts).
CREATE TABLE regime_snapshots (
  id          SERIAL PRIMARY KEY,        -- DELIBERATELY SERIAL, not BIGSERIAL: trigger_refs.regimeSnapshotId
                                         -- is z.number().int().positive() and pg returns BIGINT as a string;
                                         -- at ~1 row/day a 32-bit serial is inexhaustible here.
  trend_label TEXT NOT NULL,             -- bull | bear | range | unknown ('unknown' = unclear/average → zero influence)
  vol_label   TEXT NOT NULL,             -- high | low | unknown
  confidence  TEXT NOT NULL,             -- low | medium | high (F4 buckets; low = recorded, ZERO influence)
  source      TEXT NOT NULL,             -- tavily | twitter | hybrid (single source caps confidence at medium)
  rationale   TEXT,                      -- short structural "why"; redact() at the boundary; no amounts/secrets
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rs_trend_valid      CHECK (trend_label IN ('bull','bear','range','unknown')),
  CONSTRAINT rs_vol_valid        CHECK (vol_label IN ('high','low','unknown')),
  CONSTRAINT rs_confidence_valid CHECK (confidence IN ('low','medium','high')),
  CONSTRAINT rs_source_valid     CHECK (source IN ('tavily','twitter','hybrid'))
);
-- Latest-first reads: the worker's cadence gate (latest) + the dwell pair (latest two).
CREATE INDEX idx_rs_time ON regime_snapshots(created_at DESC);

-- (Removed: the `folders` + `documents` freeform-scratchpad tables. The
--  scratchpad tool vertical (document_*) was retired in favour of the
--  canonical knowledge layer (knowledge_entries) + per-session narrative
--  memory. Pre-production edit — no production data existed. Fresh DBs never
--  create these tables; existing dev DBs keep orphan unused tables until a
--  recreate. See branch feat/agent-tool-resolution-safety.)

-- Recall overflow cache — dedicated system store for knowledge_recall overflow.
-- Replaces the former documents(space='cache') hack. Pure system surface — agents
-- never see these rows through any tool, only via knowledge_recall_overflow lookup
-- by cache_key. Lifetime is controlled by expires_at; lazy cleanup runs at the
-- start of every knowledge_recall call (no cron, no scheduler).
CREATE TABLE recall_cache_entries (
  cache_key   TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_recall_cache_expires ON recall_cache_entries(expires_at);

-- ══════════════════════════════════════════════════════════════════
-- B. Runtime & Sessions
-- ══════════════════════════════════════════════════════════════════

-- Sessions (no parent_session_id — session_links is canonical)
-- `checkpoint_generation` is a monotonic counter bumped inside the compact
-- transaction (see `engine/compact-jobs/service.ts:executeCompactNow` — the
-- UPDATE sits after a `SELECT checkpoint_generation ... FOR UPDATE` so two
-- concurrent compacts on the same session serialize). Stamped onto each batch
-- of `session_memories` so recall can surface recency (`gen:N`).
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  scope TEXT DEFAULT 'chat',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  summary TEXT,
  compacted BOOLEAN DEFAULT FALSE,
  message_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  checkpoint_generation INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'agent' CHECK (mode IN ('agent', 'mission')),
  permission TEXT NOT NULL DEFAULT 'restricted' CHECK (permission IN ('restricted', 'full')),
  initial_goal TEXT
);
CREATE INDEX idx_sessions_scope ON sessions(scope, started_at DESC);
CREATE INDEX idx_sessions_mode ON sessions(mode);

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
  permission_at_enqueue TEXT NOT NULL DEFAULT 'restricted'
    CHECK (permission_at_enqueue IN ('restricted', 'full')),
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
-- C. Subagents
-- ══════════════════════════════════════════════════════════════════

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
-- Covers: subagent, scheduler, loop, resume relationships.
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

-- Usage log — extended for vex-agent inference layer
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
  chain_id BIGINT,
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

-- ══════════════════════════════════════════════════════════════════
-- Memory v2 — candidate buffer (S1b). Long-memory write buffer.
-- ══════════════════════════════════════════════════════════════════
-- The agent PROPOSES candidates here (via long_memory_suggest, S2); the async
-- memory_manager (S4) DECIDES promote/supersede/merge/retain/reject/expire.
-- Advisory-only doctrine: NOTHING in this table ever feeds sizing / approval /
-- wallet-intent (memory-system-v2 §6). There is intentionally NO influence /
-- execution-coupling column here — that vocabulary lives only on
-- knowledge_entries (and is itself bounded to advisory | retrieval_boost).
--
-- Placed AFTER all FK targets: sessions (session_id ON DELETE CASCADE) and
-- knowledge_entries (promoted_knowledge_id ON DELETE SET NULL) are defined
-- earlier in this file. Evidence anchors reference protocol_executions.id /
-- protocol_capture_items.id by VALUE inside evidence_refs (JSONB), not by FK —
-- FIX-1: those SERIAL ids are immutable across sync/replay, the proj_* SERIALs
-- are NOT, so evidence is anchored on the audit-trail ids + semantic keys.
--
-- Embedding contract mirrors knowledge_entries / session_memories: vector has NO
-- typmod; per-row (embedding_model, embedding_dim) are authoritative and recall
-- MUST filter on them. The embedding is computed AFTER redaction at the S2
-- suggest boundary; S1b only stores it (FIX-4 — no raw-content processing here).
CREATE TABLE memory_candidates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- pg18 core; no extension
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  proposed_by           TEXT NOT NULL DEFAULT 'parent',
  kind                  TEXT NOT NULL,            -- open snake_case (isValidKind), NOT an enum (matches knowledge_entries.kind)
  title                 TEXT NOT NULL,
  summary               TEXT NOT NULL,
  content_md            TEXT NOT NULL DEFAULT '',
  entities              TEXT[] NOT NULL DEFAULT '{}',
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  source_refs           JSONB NOT NULL DEFAULT '{}',   -- strict pointer-only provenance (messageIds / toolCallIds), see memory-candidate.ts sourceRefsSchema
  -- FIX-1 immutable anchors: array of
  -- { executionId:int (REQUIRED), captureItemId?:int, instrumentKey?:text, positionKey?:text }
  evidence_refs         JSONB NOT NULL DEFAULT '[]',
  outcome               JSONB,                    -- system-derived (S5); NULL until resolved
  source                TEXT NOT NULL DEFAULT 'observed',   -- system-derived tier (REUSE KnowledgeSource vocab); manager does NOT trust an agent-supplied tier
  confidence            REAL,                     -- agent-supplied, clamped [0,1]
  importance            INTEGER NOT NULL DEFAULT 5,
  sensitivity           TEXT NOT NULL DEFAULT 'normal',
  evidence_strength     TEXT NOT NULL DEFAULT 'none',
  retrieval_visibility  TEXT NOT NULL DEFAULT 'not_consolidated',
  retrieval_until       TIMESTAMPTZ,              -- dual-trace TTL (memory-system-v2 §2 layer 5)
  status                TEXT NOT NULL DEFAULT 'pending',
  retain_until          TIMESTAMPTZ,              -- system TTL for the candidate row
  embedding             vector NOT NULL,          -- computed AFTER redaction (S2); no typmod (re-embed-friendly)
  embedding_model       TEXT NOT NULL,            -- authoritative — recall filters on this
  embedding_dim         INTEGER NOT NULL,         -- actual provider response dim, NOT a schema lock
  content_hash          CHAR(64) NOT NULL,        -- computeContentHash → dedupe (loop-prevention §6)
  event_time                  TIMESTAMPTZ,        -- point-in-time: when the fact occurred (S5 lookahead gating)
  observed_at                 TIMESTAMPTZ,        -- point-in-time: when the agent observed it
  recorded_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),     -- point-in-time: ingestion time (worker polling order)
  available_at_decision_time  TIMESTAMPTZ,        -- as-of boundary for no-lookahead evidence deref (S5)
  promoted_knowledge_id INTEGER REFERENCES knowledge_entries(id) ON DELETE SET NULL,  -- knowledge_entries.id is SERIAL → INTEGER
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- value-range guards (mirror ke_* style)
  CONSTRAINT mc_embedding_dim_range        CHECK (embedding_dim > 0 AND embedding_dim <= 8192),
  CONSTRAINT mc_embedding_dim_matches_vector CHECK (vector_dims(embedding) = embedding_dim),
  CONSTRAINT mc_confidence_range           CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT mc_importance_range           CHECK (importance BETWEEN 1 AND 10),
  CONSTRAINT mc_evidence_refs_is_array     CHECK (jsonb_typeof(evidence_refs) = 'array'),
  CONSTRAINT mc_source_refs_is_object      CHECK (jsonb_typeof(source_refs) = 'object'),
  -- bounded-vocab enums (NAMED → lockstep-testable, mirror ke_*_valid pattern).
  -- Single source of truth lives in TS: memory/schema/memory-candidate-enums.ts
  -- (and memory/long-memory-source-policy.ts for `source`). The drift guard in
  -- memory-candidate-enums.test.ts parses these IN(...) lists.
  CONSTRAINT mc_proposed_by_valid          CHECK (proposed_by IN ('parent','subagent')),
  CONSTRAINT mc_source_valid               CHECK (source IN ('observed','user_confirmed','inferred','hypothesis')),
  CONSTRAINT mc_sensitivity_valid          CHECK (sensitivity IN ('normal','sensitive')),
  CONSTRAINT mc_evidence_strength_valid    CHECK (evidence_strength IN ('none','weak','moderate','strong')),
  CONSTRAINT mc_retrieval_visibility_valid CHECK (retrieval_visibility IN ('not_consolidated','suppressed')),
  CONSTRAINT mc_status_valid               CHECK (status IN ('pending','promoted','superseded','merged','rejected','expired','retained'))
);
CREATE INDEX idx_mc_embedding_match ON memory_candidates(embedding_model, embedding_dim);
CREATE INDEX idx_mc_status_recorded ON memory_candidates(status, recorded_at);  -- worker polling (S4)
-- loop-prevention: at most one live (pending) candidate per content_hash. The
-- partial predicate is the ON CONFLICT arbiter for insertCandidate's xmax upsert.
CREATE UNIQUE INDEX uniq_mc_pending_hash ON memory_candidates(content_hash) WHERE status = 'pending';
-- D-MAP (S7): ledger→memory wake mapping. A capture/settlement wake carries the
-- FIX-1 anchor keys ({executionId, instrumentKey?, positionKey?}); the wake query
-- matches PROMOTED candidates by JSONB containment (`evidence_refs @> '[{…}]'`),
-- OR-ed per key — the planner combines the @> probes on this ONE GIN via BitmapOr.
-- jsonb_path_ops: smaller + faster than the default opclass and supports exactly
-- the @> operator the wake query uses.
CREATE INDEX idx_mc_evidence_refs ON memory_candidates USING GIN (evidence_refs jsonb_path_ops);

-- ══════════════════════════════════════════════════════════════════
-- Memory v2 — manager work substrate (S1c). Batch consolidation queue.
-- ══════════════════════════════════════════════════════════════════
-- The async memory_manager (S4) claims a memory_job, RESERVES up to N pending
-- memory_candidates via memory_job_items, decides per candidate, and appends one
-- immutable memory_decisions row per decision. Pattern: compact_jobs (DEDICATED
-- table, not shared). Advisory-only: never feeds sizing/approval/wallet-intent.
--
-- Table order: memory_jobs → memory_decisions → memory_job_items
-- (job_items FKs BOTH jobs and decisions, so decisions must exist first — MF4).

-- memory_jobs — durable batch/sweep queue.
CREATE TABLE memory_jobs (
  id                        SERIAL PRIMARY KEY,
  job_kind                  TEXT NOT NULL DEFAULT 'consolidate',
  status                    TEXT NOT NULL DEFAULT 'pending',
  -- R4-MF2: per-batch progress counts (candidates reserved / done / failed) are NOT stored — they are
  -- DERIVED from memory_job_items (GROUP BY item_status) via getJobProgress(), so retry/revive can never
  -- drift them (rules/10 §4: no stored derived state without a perf reason; counts are a cheap indexed
  -- GROUP BY). Only true accumulators (llm_call_count, cost_usd) live on the row.
  reconcile_entry_id        INTEGER REFERENCES knowledge_entries(id) ON DELETE CASCADE,  -- job_kind='reconcile' (S7)
  reconcile_outcome_version INTEGER,
  -- wake_pending (S7 D-REARM) — closes the LOST-WAKE WINDOW: a ledger wake that
  -- lands WHILE this reconcile job is `running` cannot be folded into the
  -- in-flight pass (that pass read the ledger BEFORE the wake's write), and after
  -- `completed` nobody would know it arrived. enqueueReconcileJob's conflict path
  -- sets the flag on a running row; markCompleted CONSUMES it (completed →
  -- pending, attempt_count=0, flag false) so the job runs ONE more pass against
  -- the post-wake ledger. recoverStaleRunning leaves it untouched (the signal
  -- survives a worker crash). Only ever set on reconcile rows.
  wake_pending              BOOLEAN NOT NULL DEFAULT FALSE,
  attempt_count             INTEGER NOT NULL DEFAULT 0,
  max_attempts              INTEGER NOT NULL DEFAULT 3,
  next_attempt_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at                 TIMESTAMPTZ,
  locked_by                 TEXT,
  heartbeat_at              TIMESTAMPTZ,
  last_error                TEXT,
  inference_provider        TEXT,                 -- names only, no secrets
  inference_model           TEXT,
  inference_completed_at    TIMESTAMPTZ,
  cost_usd                  NUMERIC(10,4),
  llm_call_count            INTEGER NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at                TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  CONSTRAINT mj_llm_call_count_nonneg CHECK (llm_call_count >= 0),
  CONSTRAINT mj_reconcile_outcome_version_nonneg CHECK (reconcile_outcome_version IS NULL OR reconcile_outcome_version >= 0),  -- MF7
  CONSTRAINT mj_reconcile_fields CHECK (   -- R6-MF1: EXACT — consolidate jobs carry NO reconcile fields
    (job_kind = 'reconcile'   AND reconcile_entry_id IS NOT NULL AND reconcile_outcome_version IS NOT NULL)
    OR
    (job_kind = 'consolidate' AND reconcile_entry_id IS NULL     AND reconcile_outcome_version IS NULL)
  ),
  CONSTRAINT mj_job_kind_valid CHECK (job_kind IN ('consolidate','reconcile')),
  CONSTRAINT mj_status_valid   CHECK (status IN ('pending','running','completed','failed','permanently_failed'))
);
CREATE INDEX idx_mj_status_due ON memory_jobs(status, next_attempt_at) WHERE status IN ('pending','failed');
CREATE INDEX idx_mj_running_heartbeat ON memory_jobs(heartbeat_at) WHERE status = 'running';
-- reconcile idempotency (MF6): EXACTLY ONE reconcile job per (entry, outcome_version) FOREVER —
-- across ALL statuses (not just live). Retry = reset the terminal row (resetReconcileJob), never
-- a second row. Prevents re-reconciling the same outcome_version after completion.
CREATE UNIQUE INDEX uniq_mj_reconcile ON memory_jobs(reconcile_entry_id, reconcile_outcome_version)
  WHERE job_kind = 'reconcile';

-- memory_decisions — append-only audit of every manager decision event.
-- DURABLE append-only audit (R2-MF1): the three IDENTITY references — candidate_id, reconcile_entry_id,
-- job_id — are IMMUTABLE ANCHOR columns with NO foreign key, so a `sessions → memory_candidates
-- ON DELETE CASCADE` (above) never nulls them and never trips `md_anchor_xor`. The row is
-- self-contained and survives deletion of its subject. Write-time validity (the anchor ids exist) is
-- enforced by the repo (recordDecision is only called by the S4 manager holding live rows). Only the
-- OUTCOME pointers (promoted/supersedes/merge_target_knowledge_id) keep a live FK (SET NULL) — they
-- point to durable knowledge_entries and are convenient join targets.
CREATE TABLE memory_decisions (
  id                        BIGSERIAL PRIMARY KEY,
  candidate_id              UUID,                 -- anchor (no FK); NULL for reconcile decisions
  reconcile_entry_id        INTEGER,              -- anchor (no FK); set for reconcile decisions (S7)
  job_id                    INTEGER NOT NULL,     -- anchor (no FK); every decision traces to a job
  decision_version          INTEGER NOT NULL DEFAULT 0,
  decision_type             TEXT NOT NULL,
  decision_hash             CHAR(64) NOT NULL,    -- MF5: sha256 of semantic payload; guards mismatched retries
  reject_reason             TEXT,                 -- bounded enum; required iff reject/expire
  promoted_knowledge_id     INTEGER REFERENCES knowledge_entries(id) ON DELETE SET NULL,  -- live outcome link
  supersedes_knowledge_id   INTEGER REFERENCES knowledge_entries(id) ON DELETE SET NULL,
  merge_target_knowledge_id INTEGER REFERENCES knowledge_entries(id) ON DELETE SET NULL,
  outcome_version           INTEGER,              -- S7 reconcile linkage (knowledge_entries.outcome_version)
  evidence_refs             JSONB NOT NULL DEFAULT '[]',  -- FIX-1 snapshot: protocol_* ids + semantic keys, NEVER proj_*
  inference_provider        TEXT,
  inference_model           TEXT,
  cost_usd                  NUMERIC(10,4),
  decided_by                TEXT NOT NULL DEFAULT 'manager',
  decided_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT md_decision_version_nonneg CHECK (decision_version >= 0),
  CONSTRAINT md_outcome_version_nonneg  CHECK (outcome_version IS NULL OR outcome_version >= 0),  -- MF7
  CONSTRAINT md_decision_hash_hex CHECK (decision_hash ~ '^[0-9a-f]{64}$'),                       -- MF5
  CONSTRAINT md_anchor_xor CHECK (   -- R3-MF3: EXACTLY ONE of candidate / reconcile anchor (a row must never hit both unique indexes)
    (candidate_id IS NOT NULL)::int + (reconcile_entry_id IS NOT NULL)::int = 1),
  CONSTRAINT md_reconcile_type CHECK ((decision_type = 'reconcile') = (reconcile_entry_id IS NOT NULL)),  -- R3-MF3: reconcile type ⇔ reconcile anchor
  CONSTRAINT md_reconcile_fields CHECK ((reconcile_entry_id IS NOT NULL) = (outcome_version IS NOT NULL)), -- R2-MF4/R6-MF2: outcome_version present IFF reconcile (closes the NULL-key dedup hole AND forbids it on candidate decisions)
  CONSTRAINT md_reject_reason_scope CHECK ((decision_type IN ('reject','expire')) = (reject_reason IS NOT NULL)),  -- MF7 biconditional
  CONSTRAINT md_evidence_refs_is_array CHECK (jsonb_typeof(evidence_refs) = 'array'),
  -- NAMED enum CHECKs → lockstep-testable (single source of truth: memory/schema/memory-decision-enums.ts).
  -- reject_reason is nullable: `reject_reason IN (...)` evaluates to NULL (→ CHECK passes) when NULL, so the
  -- plain form already permits NULL while staying parseable by the shared lockstep parser; md_reject_reason_scope
  -- enforces present-iff-reject/expire.
  CONSTRAINT md_decision_type_valid CHECK (decision_type IN ('promote','supersede','merge','retain','reject','expire','reconcile')),
  CONSTRAINT md_reject_reason_valid CHECK (reject_reason IN
    ('secret_or_live_state','low_confidence','duplicate','insufficient_evidence','superseded_by_existing','expired_ttl','policy')),
  CONSTRAINT md_decided_by_valid CHECK (decided_by IN ('manager','system'))
);
-- candidate-driven idempotency: one decision per (candidate, version) (partial — reconcile has no candidate)
CREATE UNIQUE INDEX uniq_md_candidate_version ON memory_decisions(candidate_id, decision_version)
  WHERE candidate_id IS NOT NULL;
-- reconcile-driven idempotency (MF6): one decision per (entry, outcome_version)
CREATE UNIQUE INDEX uniq_md_reconcile ON memory_decisions(reconcile_entry_id, outcome_version)
  WHERE reconcile_entry_id IS NOT NULL;
CREATE INDEX idx_md_candidate ON memory_decisions(candidate_id, decision_version DESC) WHERE candidate_id IS NOT NULL;
CREATE INDEX idx_md_type      ON memory_decisions(decision_type);   -- §4 "decisions by type"

-- memory_job_items — per-candidate reservation + working state for a batch job.
CREATE TABLE memory_job_items (
  id            SERIAL PRIMARY KEY,
  job_id        INTEGER NOT NULL REFERENCES memory_jobs(id) ON DELETE CASCADE,
  candidate_id  UUID    NOT NULL REFERENCES memory_candidates(id) ON DELETE CASCADE,
  item_status   TEXT NOT NULL DEFAULT 'reserved',
  decision_id   BIGINT REFERENCES memory_decisions(id) ON DELETE RESTRICT,  -- MF4: durable link when item is done
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mji_item_status_valid CHECK (item_status IN ('reserved','processing','done','failed','released')),
  CONSTRAINT mji_done_has_decision CHECK (item_status <> 'done' OR decision_id IS NOT NULL),  -- MF4: no "done" without a decision row
  CONSTRAINT mji_job_candidate_unique UNIQUE (job_id, candidate_id)
);
-- RESERVATION GUARD: a candidate is actively held by AT MOST ONE job at a time.
CREATE UNIQUE INDEX uniq_mji_active_candidate ON memory_job_items(candidate_id)
  WHERE item_status IN ('reserved','processing');
-- one item per decision (MF4)
CREATE UNIQUE INDEX uniq_mji_decision ON memory_job_items(decision_id) WHERE decision_id IS NOT NULL;
CREATE INDEX idx_mji_job_status ON memory_job_items(job_id, item_status);

-- ══════════════════════════════════════════════════════════════════
-- Memory v2 — knowledge graph (S1d). Entity nodes + entry↔entity links + edges.
-- ══════════════════════════════════════════════════════════════════
-- The async memory_manager (S8) extracts/normalizes entities from promoted
-- knowledge_entries, links them, and asserts edges between entities. Supersession
-- is by INVALIDATION (set timestamps), NEVER DELETE — Zep/Graphiti bi-temporal.
-- Advisory-only: the graph only enriches retrieval (S3); never feeds
-- sizing/approval/wallet-intent. Entities are GLOBAL (cross-session, like the
-- long-term store) — no session_id. Embeddings are stored here (Q2) but produced
-- by S8; the substrate only requires/validates them.

-- memory_entities — normalized entity nodes (canonical things memories are about).
CREATE TABLE memory_entities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type       TEXT NOT NULL,                        -- closed enum (me_entity_type_valid)
  name              TEXT NOT NULL,                        -- display surface as first seen
  normalized_name   TEXT NOT NULL,                        -- lower()+collapsed-whitespace canonical dedup key
  aliases           TEXT[] NOT NULL DEFAULT '{}',         -- observed surface variants (no NULL elements)
  summary           TEXT NOT NULL DEFAULT '',             -- regional summary; S8 fills (redacted upstream)
  attributes        JSONB NOT NULL DEFAULT '{}',          -- type-dependent attributes
  embedding         vector NOT NULL,                      -- NAME embedding (entity resolution); no typmod
  embedding_model   TEXT NOT NULL,                        -- authoritative — resolution filters on this
  embedding_dim     INTEGER NOT NULL,
  valid_from        TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- world: when the entity became known
  valid_until       TIMESTAMPTZ,                          -- world: entity ceased (NULL = active)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),   -- ingestion
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT me_embedding_dim_range          CHECK (embedding_dim > 0 AND embedding_dim <= 8192),
  CONSTRAINT me_embedding_dim_matches_vector CHECK (vector_dims(embedding) = embedding_dim),
  CONSTRAINT me_aliases_no_null              CHECK (array_position(aliases, NULL) IS NULL),
  CONSTRAINT me_attributes_is_object         CHECK (jsonb_typeof(attributes) = 'object'),
  CONSTRAINT me_normalized_name_nonempty     CHECK (length(normalized_name) > 0),
  CONSTRAINT me_valid_window                 CHECK (valid_until IS NULL OR valid_until >= valid_from),
  -- closed vocabulary (NAMED → lockstep-testable; source of truth: memory/schema/memory-entity-enums.ts)
  CONSTRAINT me_entity_type_valid CHECK (entity_type IN
    ('token','protocol','wallet','strategy','market_regime','concept','person','event'))
);
-- entity resolution dedup: AT MOST ONE active entity per (type, normalized_name).
-- Partial predicate is the ON CONFLICT arbiter for upsertEntity's xmax upsert.
CREATE UNIQUE INDEX uniq_me_active_identity ON memory_entities(entity_type, normalized_name) WHERE valid_until IS NULL;
CREATE INDEX idx_me_embedding_match ON memory_entities(embedding_model, embedding_dim);
CREATE INDEX idx_me_normalized     ON memory_entities(normalized_name);
CREATE INDEX idx_me_type           ON memory_entities(entity_type);

-- memory_entry_entities — junction: which entities a long-term knowledge_entry mentions.
CREATE TABLE memory_entry_entities (
  entry_id      INTEGER NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  entity_id     UUID    NOT NULL REFERENCES memory_entities(id)   ON DELETE CASCADE,
  mention_count INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entry_id, entity_id),
  CONSTRAINT mee_mention_count_pos CHECK (mention_count >= 1)
);
CREATE INDEX idx_mee_entity ON memory_entry_entities(entity_id);   -- reverse lookup (entity → entries)

-- memory_edges — directed entity→entity relations, FULL bi-temporal (invalidate, never delete).
CREATE TABLE memory_edges (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id      UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  target_entity_id      UUID NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  relation              TEXT NOT NULL,                       -- closed enum (med_relation_valid)
  fact                  TEXT NOT NULL DEFAULT '',            -- NL fact text (S8), redacted upstream
  fact_embedding        vector,                              -- FACT embedding (recall); NULLABLE
  embedding_model       TEXT,
  embedding_dim         INTEGER,
  origin_entry_id       INTEGER REFERENCES knowledge_entries(id) ON DELETE SET NULL,  -- primary provenance (FK-safe; full episode list deferred — D8)
  -- FULL bi-temporal (Q1). NULL = open interval on every temporal bound.
  valid_from            TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- world: relation became true
  valid_until           TIMESTAMPTZ,                         -- world: relation stopped being true
  invalidated_at        TIMESTAMPTZ,                         -- system: when WE retracted/superseded it (Graphiti expired_at)
  superseded_by_edge_id UUID REFERENCES memory_edges(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- ingestion
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT med_no_self_loop      CHECK (source_entity_id <> target_entity_id),
  CONSTRAINT med_no_self_supersede CHECK (superseded_by_edge_id IS NULL OR superseded_by_edge_id <> id),
  CONSTRAINT med_superseded_implies_invalidated CHECK (superseded_by_edge_id IS NULL OR invalidated_at IS NOT NULL),
  CONSTRAINT med_valid_window      CHECK (valid_until IS NULL OR valid_until >= valid_from),
  -- fact embedding is an all-or-nothing triplet (mirror ke_/mc_ embedding guards, but nullable as a set)
  CONSTRAINT med_embedding_triplet CHECK (
    (fact_embedding IS NULL AND embedding_model IS NULL AND embedding_dim IS NULL)
    OR (fact_embedding IS NOT NULL AND embedding_model IS NOT NULL AND embedding_dim IS NOT NULL
        AND embedding_dim > 0 AND embedding_dim <= 8192 AND vector_dims(fact_embedding) = embedding_dim)
  ),
  CONSTRAINT med_relation_valid CHECK (relation IN
    ('traded_on','uses','holds','competes_with','correlates_with','part_of','supersedes','related_to'))
);
-- AT MOST ONE active (currently-believed) edge per (source, target, relation). Invalidated
-- temporal versions coexist (they fall out of the partial predicate). ON CONFLICT arbiter for upsertEdge.
CREATE UNIQUE INDEX uniq_med_active_relation ON memory_edges(source_entity_id, target_entity_id, relation) WHERE invalidated_at IS NULL;
CREATE INDEX idx_med_source          ON memory_edges(source_entity_id) WHERE invalidated_at IS NULL;
CREATE INDEX idx_med_target          ON memory_edges(target_entity_id) WHERE invalidated_at IS NULL;
CREATE INDEX idx_med_relation        ON memory_edges(relation);
CREATE INDEX idx_med_embedding_match ON memory_edges(embedding_model, embedding_dim) WHERE fact_embedding IS NOT NULL;
