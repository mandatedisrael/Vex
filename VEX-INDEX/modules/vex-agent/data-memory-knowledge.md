---
id: module.vex-agent.data-memory-knowledge
kind: module
paths:
  - "src/vex-agent/db/**"
  - "src/vex-agent/memory/**"
  - "src/vex-agent/knowledge/**"
  - "src/vex-agent/sync/**"
  - "src/vex-agent/embeddings/**"
  - "src/vex-agent/scripts/**"
  - "src/vex-agent/public/**"
source_commit: c138af8
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/vex-agent/db/migrations/**"
  - "src/vex-agent/db/repos/**"
  - "src/vex-agent/db/client.ts"
  - "src/vex-agent/memory/**"
  - "src/vex-agent/knowledge/**"
  - "src/vex-agent/sync/**"
  - "src/vex-agent/embeddings/**"
related:
  - module.vex-agent.engine-core
  - module.vex-agent.engine-runtime-events
  - module.vex-agent.engine-mission
  - module.vex-agent.engine-compact
  - module.vex-agent.inference
  - module.vex-agent.tools-internal
  - module.vex-agent.tools-protocols
  - ADR-0001-global-model-session-wallet
---

# module.vex-agent.data-memory-knowledge

Z4 — The persistence, memory policy, knowledge management, portfolio sync, and
embedding infrastructure used by the vex-agent engine. Owns the Postgres schema
(version 027 across 24 SQL migration files; gaps 007/008/012 are intentional), all typed repos,
session/knowledge memory pipelines, on-chain projection sync, and the local
embedding client.

## Purpose

Z4 is the data foundation for the entire vex-agent runtime. It provides:

- A **single shared Postgres pool** (`VEX_DB_URL`, max 10 connections, 30 s idle timeout)
  used by all engine zones (Z1–Z3). vex-app main (Z6) runs a separate `pg.Client` pool
  against the same Postgres — the two pools do NOT share connections and SQL is the only
  contract between them (see Boundary Crossings).
- **Migration execution** via `src/lib/db/migrate-runner.ts` (advisory-locked, idempotent,
  per-statement timeouts). Migrations live in `src/vex-agent/db/migrations/` and are
  copy-synced to `vex-app/resources/migrations/` at build time.
- **Typed repos** for every table — thin TS wrappers over parameterized SQL, tx-aware via
  the `Executor` abstraction (`Pool | PoolClient`).
- **Session memory pipeline** (Track 2 compact chunker): LLM → narrative chunks →
  `session_memories` with pgvector embeddings; agent retrieves via `memory_recall` tool.
- **Knowledge layer**: `knowledge_entries` with versioned lineage (`supersedes_id`),
  source provenance gating (`observed | user_confirmed | inferred | hypothesis`), FIFO
  TTL + pinned-evergreen entries, and inline/overflow recall splitting.
- **Sync pipeline** (`proj_*` tables): balance projection, FIFO PnL lot matching, LP
  lifecycle, Polymarket MTM and prediction settlement reconciliation.
- **Embeddings client**: POST to the configured OpenAI-compatible embedding base URL.
  The bundled desktop compose default is `http://127.0.0.1:55134/v1` backed by
  `llama.cpp:server` + `ai/embeddinggemma:300M-Q8_0`; older `:12434` Docker Model
  Runner references are legacy/status drift unless a code path proves otherwise.

## Retrieval keywords

- postgres, db, pool, migrations, schema, repos
- sessions table, messages table, knowledge_entries, session_memories
- compact jobs, compact outbox, Track 2
- memory recall, knowledge recall, knowledge supersede, knowledge lifecycle
- pgvector, embeddings, cosine similarity, recall, rerank
- sync, balance sync, pnl lots, pnl matches, lp events, proj_balances, proj_activity
- wallet intents, approval queue, approval intents, loop wake
- runner leases, runtime control requests, rewind checkpoints
- tool output blobs, tool embeddings, recall cache
- exclusion rules, live state, redaction, theme validation
- content hash, knowledge source, knowledge status, hot context

## State owned

### DB tables (schema version 027; 24 SQL files applied in order; gaps 007/008/012 are intentional)

| Table | Migration | Key columns / purpose |
|---|---|---|
| `schema_version` | 001 | Migration tracking |
| `soul` | 001 | Singleton agent identity (id=1), content_md, pfp_url |
| `knowledge_entries` | 001 + 006 + 018 | id, kind (free-form snake_case), title, summary, content_md, tags, confidence, status (`active|superseded|invalidated|archived`), pinned, valid_from, valid_until, content_hash UNIQUE (sha256 length-prefixed), embedding_model, embedding_dim, embedding `vector` (NO typmod), source_surface, source_session; mig 006 adds supersedes_id FK, status_reason, change_summary, what_failed; mig 018 adds source (`observed|user_confirmed|inferred|hypothesis`) — only `observed`+`user_confirmed` surface in hot context |
| `folders` | 001 | First-class directory tree (space, parent_id, slug) |
| `documents` | 001 | DB-first markdown content; NOT canonical memory — knowledge_entries is |
| `recall_cache_entries` | 001 | Overflow cache for knowledge_recall; lazy cleanup on read |
| `sessions` | 001 + 020 + 021 + 026 | id TEXT PK, scope, mode CHECK(`agent|mission`) NOT NULL IMMUTABLE, permission CHECK(`restricted|full`) NOT NULL IMMUTABLE, initial_goal, checkpoint_generation (monotonic, bumped per compact), message_count, token_count, summary; mig 020: title (≤120 DB, ≤80 UI), pinned_at; mig 021: deleted_at (soft-delete); mig 026: selected_evm_wallet_id/address + selected_solana_wallet_id/address — per-family atomicity enforced by CHECK constraints, IMMUTABLE post-creation. **NO model_id column — model is GLOBAL (ADR-0001).** |
| `messages` | 001 + 002 | id SERIAL, session_id, role, content, tool_call_id, tool_calls JSONB, created_at; mig 002 adds source, message_type, visibility, origin_session_id, subagent_id, metadata JSONB (free-form payload) |
| `messages_archive` | 001 + 002 + 023 | Mirrors messages columns; mig 023 adds rewind_checkpoint_id FK → rewind_checkpoints |
| `approval_queue` | 001 | id TEXT PK, tool_call JSONB, reasoning, status (`pending|approved|rejected`), session_id, tool_call_id, permission_at_enqueue, pending_context JSONB |
| `approval_intents` | 024 | Puzzle-5 policy companion to approval_queue. action_kind (7 variants), risk_level (5 variants), preview_json, policy_json, decision (`approved|rejected|rejected_stop`), execution_status (`not_started|dispatching|succeeded|failed`), idempotency_key, expires_at |
| `runtime_state` | 001 | Singleton (id=1): legacy loop engine state; current_phase, loop_session_id |
| `runtime_cycles` | 001 | Audit trail for legacy loop cycles |
| `subagents` | 001 | id TEXT PK, status, allow_trades, result/error, token_cost, max_iterations=25 |
| `session_links` | 001 | Canonical parent→child session graph (relation_type, subagent_id) |
| `subagent_messages` | 001 | Parent↔child message channel (relay, request_parent, reply, report_complete) |
| `inbox_events` | 001 | Autonomy queue: event_type, payload, consumed |
| `usage_log` | 001 | prompt_tokens, completion_tokens, cost, provider, **model (per-row)**, cached_tokens, reasoning_tokens |
| `billing_snapshots` | 001 | Provider balance tracking (provider_balance, provider_available) |
| `protocol_executions` | 001 | Audit log of every mutating tool call (tool_id, namespace, session_id, params JSONB, result JSONB, success, trade_capture JSONB, external_refs JSONB) |
| `protocol_capture_items` | 001 | Per-position/per-trade items within one execution; batch tools produce N items per execution |
| `protocol_sync_jobs` | 001 | Refresh strategies per namespace (strategy, interval_seconds) |
| `protocol_sync_runs` | 001 | Audit of sync executions |
| `proj_balances` | 001 + 014 | Multi-chain token balances; chain_id BIGINT (mig 014 — Solana IDs > INT) |
| `proj_portfolio_snapshots` | 001 + 027 | Per-wallet portfolio snapshots; mig 027 adds wallet_family, wallet_address NOT NULL, snapshot_group_id UUID (multi-wallet grouping) |
| `proj_open_positions` | 001 + 027 | Open positions (perps, predictions, LP, orders); mig 027 fixes uniqueness key to include chain + wallet_address |
| `proj_activity` | 001 + 003 + 004 | Unified cross-protocol activity feed; mig 003 adds valuation columns; mig 004 adds benchmark/settlement/native columns |
| `proj_pnl_lots` | 001 + 003 + 004 | FIFO spot DEX cost basis ledger; mig 003 adds FIFO match ledger; mig 004 adds cost_basis_native, benchmark_asset_key |
| `proj_pnl_matches` | 003 + 004 | Realized PnL ledger (FIFO lot match per sell); mig 004 adds native columns |
| `proj_lp_events` | 005 | LP cashflow legs (deposit/withdraw/fee/refund); no FK to proj_activity (replay stability) |
| `proj_lp_event_legs` | 005 | Per-token amounts within one LP event |
| `search_cache` | 001 | Web search results cache (query_hash PK) |
| `fetch_cache` | 001 | Web fetch cache (url_hash PK, markdown) |
| `missions` | 002 + 015 + 023 | Mission contract; mig 015 adds contract_snapshot_json, recovered_from_run_id; mig 023 adds accepted_contract_hash/at/by/version (4-column atomic CHECK) + renewed_from_mission_id |
| `mission_runs` | 002 + 015 | Per-run state: status (9 values from engine/types.ts), iteration_count; mig 015 adds contract_snapshot_json, recovered_from_run_id |
| `maintenance_leases` | 009 | Singleton (id=1, CHECK id=1) write-gate for reembed: FOR UPDATE (reembed) × FOR SHARE (writers) TOCTOU guard |
| `tool_embeddings` | 010 | Dense embeddings for tool discovery; content_hash includes FORMATTER_VERSION so model swap auto-invalidates all rows |
| `loop_wake_requests` | 011 | id UUID, session_id, mission_run_id (required — only mission wakes), due_at, status CHECK(`pending|consumed|cancelled`); partial unique `uniq_loop_wake_pending_per_session` on (session_id) WHERE status='pending' |
| `tool_output_blobs` | 013 | Ephemeral off-prompt storage (blob_key PK, session_id, payload JSONB, expires_at); TTL ~15 min; resume paths refresh TTL |
| `session_memories` | 016 | Per-session narrative chunks from Track 2. theme (free-form slug, validated), 4 narrative columns (happened_md, did_md, tried_md) + materialized body_md (body_md_hash CHAR(64) for stale-embedding protection), outstanding_items JSONB array, embedding vector (NO typmod), embedding_model/dim authoritative; content_hash = sha256(theme+happened_md+did_md+tried_md) — outstanding_items EXCLUDED (mutable via markOutstandingResolved) |
| `compact_jobs` | 017 | Track 2 outbox: session_id, checkpoint_generation (UNIQUE per (session,gen)), status (`pending|running|completed|failed|permanently_failed`), agent_summary, thread_themes_hints, heartbeat_at, locked_at/by, attempt_count, max_attempts=3 |
| `bug_reports` | 019 | Local bug reports; soft references (no FK) to agent tables; two-tier redaction applied before insert; upload_state machine (not_configured|queued|uploading|uploaded|failed) |
| `runtime_control_requests` | 022 | kind (`pause_after_step|stop_terminal|resume|cancel_wake`), status (`pending|observed|cleared|expired|failed`), requested_by, expires_at; partial index on (session_id, created_at) WHERE status IN ('pending','observed') |
| `runner_leases` | 022 | session_id PK (per-session, not per-run), owner_id, process_kind, expires_at, heartbeat_at |
| `rewind_checkpoints` | 023 | id TEXT, session_id, mission_run_id, cutoff_message_id/created_at, archived_count; partial index for LIFO unrestored lookup; restore_idempotency_key UNIQUE |
| `wallet_intents` | 025 | intent_id PK, session_id (every CAS includes this — cross-session miss invariant), status 7-value CHECK (`pending|consuming|executed|failed|audit_failed|cancelled|expired`), failure_reason structural-only (ErrorKind:hash, no raw errors), expires_at |

### ENV vars consumed

| Var | Purpose |
|---|---|
| `VEX_DB_URL` | Engine pool connection string (falls back to `postgresql://vex:vex@localhost:5777/vex_test` with loud warning) |
| `EMBEDDING_BASE_URL` | OpenAI-compatible embedding base URL (required; throws at loadEmbeddingConfig if absent). Bundled desktop default is `http://127.0.0.1:55134/v1`. |
| `EMBEDDING_MODEL` | Model identifier sent per request (e.g. `ai/embeddinggemma:300M-Q8_0`) |
| `EMBEDDING_DIM` | Expected vector dimension (required; validated [1,8192]) |
| `EMBEDDING_PROVIDER` | Free-form provider tag for logging |

## Boundary crossings

### CRITICAL: Dual DB-access model (Z4 engine pool vs Z6 vex-app raw pg.Client)

Both the engine (Z4) and vex-app main (Z6) access the **same local Postgres**
but through **separate, non-shared pools**:

- **Engine pool** (`src/vex-agent/db/client.ts`): `pg.Pool`, max 10, idle 30 s.
  Used by all Z1–Z4 code. Initialized lazily on `getPool()`.
- **vex-app main pool** (`vex-app/src/main/database/*`): raw `pg.Client`-based layer.
  Z6 uses its OWN queries against the same tables (sessions, messages, usage, etc.).
  **Z6 does NOT import engine repos**, except for a handful of dynamic imports:
  - `compact-jobs` (compact-worker.ts + compaction.ts IPC): imports `CompactJobsExecutorHandle` type
  - `wallet-intents`: type-only import in wallets-session.ts (`WalletIntent`)
  - `runtime-control-requests`: dynamic `import(...)` in runtime-resume-dispatch.ts
  - `loop-wake`: referenced by cancel-wake.ts (comment; actual import may be dynamic)

  **SQL is the contract boundary between Z6 and Z4.** Schema drift (column added to
  sessions in Z4 migration) may silently break Z6 raw queries that do `SELECT *` or
  name columns explicitly.

- **Migrations**: single canonical source at `src/vex-agent/db/migrations/`; copy-synced
  to `vex-app/resources/migrations/` by `vex-app/scripts/copy-migrations.mjs` at build.
  Both engine (`runMigrations()`) and vex-app bootstrap use `src/lib/db/migrate-runner.ts`
  (advisory-locked, so concurrent runs are safe).

### Network

- **Embedding service** at `${EMBEDDING_BASE_URL}/embeddings` (desktop default `127.0.0.1:55134/v1`):
  POST with `{ input, model }`, response OpenAI-shaped. Retried 2×, 30 s timeout per attempt.

### Filesystem

- None directly. Config dir (`VEX_DB_URL`) resolved externally.

### Wallet / signing

- None. This zone is data-only. Wallet selection is recorded on `sessions` rows
  (mig 026) but no signing happens here.

## File map

### db/

- `src/vex-agent/db/client.ts:27 getPool` — lazy singleton pool; `Executor = Pool | PoolClient`; `withTransaction<T>(fn)` for multi-statement atomicity; `closePool()` for graceful shutdown
- `src/vex-agent/db/migrate.ts:20 runMigrations` — delegates to `runMigrationsWithProgress` in shared runner; discovers migrations via `getVexAgentMigrationsDir()`
- `src/vex-agent/db/params.ts:14 jsonb` — strict JSONB serialization (no circular refs, no bigint, no undefined); `nullableJsonb`, `jsonbPlaceholder`, `sanitizeJsonbValue` (lenient variant for capture/audit code)

### db/repos/ — alphabetical

- `activity.ts` — CRUD for `proj_activity`; `insertActivity`, `getById`
- `approval-intents.ts:50 ApprovalIntent` — `createWith(client)` (tx), `markDecisionWith(client)` (CAS, decision IS NULL guard), `markExecutionStatusWith`, `getExpired(now, limit)` for TTL sweep
- `approvals.ts:70 enqueue` / `enqueueWith(client)` — `approve`/`approveWith(client)` / `reject`/`rejectWith(client)` CAS (`RETURNING` discriminates); `getPendingCount`
- `balances.ts` — upsert `proj_balances`, latest snapshot queries
- `billing.ts` — insert/query `billing_snapshots`
- `capture-items.ts` — insert/query `protocol_capture_items`
- `compact-jobs/crud.ts` — `enqueueJob` (ON CONFLICT per (session,gen) → idempotent), `claimNextDueJob` (SKIP LOCKED), `heartbeat`, `markCompleted` (with audit audit columns), `markFailed`, `recoverStaleRunning` (reset running→pending for heartbeat-stale jobs on startup)
- `compact-jobs/types.ts:CompactJob` — full type including inference audit columns
- `documents.ts` — CRUD for `documents` and `folders`
- `executions.ts` — insert/query `protocol_executions` and `protocol_sync_runs`
- `folders.ts` — CRUD for `folders`
- `inbox.ts` — `enqueue`/`consumeNext` for `inbox_events`
- `knowledge/crud.ts` — `insertEntry` (ON CONFLICT content_hash DO NOTHING → idempotent, returns `inserted:bool`), `getById`, `getByContentHash`, `listActive`, `listActiveForHotContext`, `listKnownKinds`, `updateStatus`
- `knowledge/export.ts` — `exportAll` for knowledge-export script
- `knowledge/hot-context.ts` — `listActiveForHotContext` filters `status='active' AND source IN ('observed','user_confirmed')` and respects TTL + pinned
- `knowledge/lineage.ts` — `getLineageChain(id)` (recursive CTE root→head), `listHistory`
- `knowledge/recall.ts:recallTopK` — cosine search `embedding <=> $query` WHERE status=active AND model+dim match; returns `RecallCandidate[]` for reranker
- `knowledge/reembed.ts` — batch re-embed all active entries (acquire maintenance_lease FOR UPDATE)
- `knowledge/types.ts:KnowledgeEntry` — full type; `vectorLiteral(v)` for pgvector literal; `mapRowToCandidate` (cosine_distance → similarity = 1 - distance)
- `knowledge-lifecycle/supersede.ts` — `supersedeEntry(predecessorId, newEntry, client)`: atomic tx INSERT new + UPDATE predecessor status='superseded' + set supersedes_id lineage
- `knowledge-lifecycle/errors.ts` — `MaintenanceActiveError` for write-gate check
- `knowledge-lifecycle/types.ts` — `SupersedeInput`, `SupersedeResult`
- `knowledge-lifecycle.ts` — re-export barrel; `updateStatus` (only `invalidated|archived` allowed — `superseded` is tool-gated)
- `knowledge.ts` — re-export barrel for knowledge/ subdir
- `loop-wake.ts:104 enqueue` — `ON CONFLICT (session_id) WHERE status='pending' DO NOTHING` → null on duplicate; `cancelForSession`; `claimDue(now, limit)` (dedicated PoolClient, BEGIN/COMMIT FOR UPDATE SKIP LOCKED)
- `lp-events.ts` — insert `proj_lp_events` + `proj_lp_event_legs`
- `maintenance-lease.ts` — `acquireLease(ownerId)` (FOR UPDATE), `releaseLease`, `checkLease` (FOR SHARE — writers call this to fail-fast)
- `messages.ts:37 MESSAGE_DB_COLUMNS` — canonical column list (single source of truth for archive writers); `addMessageReturningId` (INSERT + UPDATE message_count, tx-aware); `getLiveMessagesWithId` (tx-aware, required for compact cutoff); `getOperatorInstructionsAfter` (role=user AND message_type=operator_interrupt); `getAllMessages` (UNION archive + live, archive wins on id collision); `selectArchivePrefix` (pure fn, pair-integrity walk)
- `missions.ts` — `createDraft`, `updateDraft` (clears acceptance 4-tuple), `getMission`, `acceptContract` (writes 4-tuple atomically)
- `mission-runs.ts:84 createRun` / `updateStatus` / `casFlipToRunning` (BEGIN→SELECT FOR UPDATE→UPDATE→COMMIT) / `getActiveRunBySession` / `getLatestFailedRunBySession`
- `open-positions.ts` — `upsertPosition`, `closePosition`, `getByPositionKey`
- `pnl-lots.ts` — `openLot`, `reduceLotsForSell` (FOR UPDATE, FIFO)
- `pnl-matches.ts` — `insertMatch` (realized PnL record per FIFO match)
- `recall-cache.ts` — `set`, `get` (lazy cleanup of expired entries on read), `deleteExpired`
- `rewind-checkpoints.ts` — `create`, `getLatestUnrestored(sessionId)` (LIFO partial index), `markRestored(id, idempotencyKey)` (UNIQUE partial index guards duplicate restore)
- `runner-leases.ts` — `claim` (INSERT ... ON CONFLICT DO UPDATE WHERE expires_at < NOW() + CAS for race safety), `heartbeat`, `release`, `getActive`
- `runtime-control-requests.ts:102 enqueueRequest` / `observePending(client)` (FOR UPDATE SKIP LOCKED, caller owns tx) / `markCleared` / `markFailed` / `expireDue`
- `runtime.ts` — legacy singleton runtime_state read/write (still used by legacy loop)
- `search.ts` — `cacheSearch`, `getCachedSearch`, `cacheFetch`, `getCachedFetch`
- `session-memories/crud.ts` — `insertPreparedMemory` (content_hash dedup ON CONFLICT DO NOTHING), `prepareMemoryRender` (renders body_md + computes body_md_hash), `markOutstandingResolved` (atomic: UPDATE body_md + body_md_hash + outstanding_items; body_md_hash WHERE guard prevents stale-embed overwrite), `updateEmbedding` (WHERE body_md_hash=$current — stale-embedding protection)
- `session-memories/recall.ts:recallTopK` — cosine search, embedding_model+dim filter mandatory (mixed-dim crash protection)
- `session-memories/types.ts:SessionMemory` — full type; `BODY_MD_SCHEMA_VERSION`, `renderBodyMd`, `computeContentHash` (sha256(theme+happened+did+tried) excluding outstanding_items)
- `sessions-archive.ts` — `archivePrefix(messages, cutoffId, checkpointGen, client)` (DELETE + INSERT archive + UPDATE sessions); `archiveSuffix(messages, rewindCheckpointId, client)` (rewind path, stamps rewind_checkpoint_id); `forkToolMessageToArchive` (giant-tool fallback, COPIES then truncates)
- `sessions.ts:182 createSession` — INSERT with mode/permission/initial_goal/selected wallets; `setRollingSummary(client?)` tx-aware; `selectArchivePrefix` (pure fn)
- `session-links.ts` — create/close session_links edges
- `soul.ts` — `getSoul`, `updateSoul` (singleton id=1)
- `subagents.ts` — CRUD for `subagents` table
- `subagent-messages.ts` — relay/request/reply/complete message channel
- `sync.ts` — `enqueueRun`, `claimPendingRun`, `claimAllPending`, `completeRun`, `failRun`, `getJob`, `getAllJobs`, `seedJob`, `getLastCompletedRun`
- `tool-embeddings.ts` — `upsertToolEmbedding`, `getByToolId`, `listAll`
- `tool-output-blobs.ts` — `set(blob_key, session_id, payload, expiresAt)`, `get(blob_key, session_id)` (session-scoped; enforces cross-session miss), `refreshTtl` (resume paths batch-bump TTLs), `deleteExpired`
- `usage.ts:40 getStats(sessionId?, currency?)` — session + lifetime totals from usage_log; **NO getLastTurn** — that lives in vex-app `usage-db.ts`
- `wallet-intents.ts:159 consumeIfPending` — CAS (status='pending' AND expires_at>NOW()); `markExecuted`, `markFailed` (reason = structural label only), `markAuditFailed` (tx_hash real on-chain, audit row broken — distinct status for phase-7 reconcile), `cancelIfPending`; EVERY query includes `session_id` predicate

### memory/

- `src/vex-agent/memory/policy.ts` — Pure constants + helpers. Key: `classifyPressure(fraction) → PressureBand` (normal/warning/barrier/critical at 0.85/0.88/0.92); `clampMemoryRecallK`; worker timing constants (heartbeat 20 s, stale 2 min, Track-2 timeout 30 s, retry backoff 30 s base, max 3 attempts); theme stoplist; `KnowledgeSource` type + `HOT_CONTEXT_SOURCES = ['observed','user_confirmed']`
- `src/vex-agent/memory/exclusion-rules.ts:97 scanLiveState` — regex scan for live-state (balances, prices, gas, chain heights, pending txs, now-timestamps); `liveFraction >= 0.30` → chunk rejected; `shouldRejectChunk(text)` convenience
- `src/vex-agent/memory/redaction.ts` — thin re-export of `src/lib/diagnostics/text-redaction.ts`; Tier 1 (mnemonics, private keys, API keys, JWTs), Tier 2 (EVM/Solana addresses, tx hashes)
- `src/vex-agent/memory/theme-validation.ts:36 validateTheme` — regex + stoplist + all-non-trivial-tokens-stop check; `buildFallbackTheme` (fallback slug from structured fields when LLM emits degenerate slug)

### knowledge/

- `src/vex-agent/knowledge/policy.ts` — TTL (default 7 days, clamp [1 h, 1 year]), `KnowledgeStatus`, `UpdatableKnowledgeStatus` (NOT includes `superseded`), `isValidKind` (snake_case regex, max 64 chars), recall caps (default k=8, max k=15, inline cap=10, chars cap=50 000), recall cache TTL=15 min, tool output overflow threshold=16 KiB, hot-context caps (12 entries, 3000 chars, 200 chars/summary)
- `src/vex-agent/knowledge/ranking.ts:76 rerank` — combined score = similarity + recencyBoost (RECENCY_BOOST_MAX=0.15, half-life=7 d) + confidence (max +0.10) + pinned (flat +0.20); stable sort
- `src/vex-agent/knowledge/recall-payload.ts:33 splitInlineAndOverflow` — first entry always inline even if over chars cap; subsequent respect RECALL_INLINE_CAP + RECALL_INLINE_CHARS_CAP
- `src/vex-agent/knowledge/content-hash.ts:29 computeContentHash` — sha256 of length-prefixed `kind|title|summary|content_md`; field set is intentionally text-only (metadata excluded)

### sync/

- `src/vex-agent/sync/index.ts:22 initSync` — boot sequence: seed jobs → drain backlog → full balance sync + snapshot; `syncTick` (periodic: drain pending + check periodic jobs by interval)
- `src/vex-agent/sync/worker.ts:27 drainPendingRuns` — claim all pending, group by syncType, deduplicate, dispatch; refreshes prediction MTM after balance drain
- `src/vex-agent/sync/balance-sync.ts` — `fullBalanceSync` (all inventory wallets, per-wallet snapshot with group UUID); `selectiveBalanceSync(hint)` (chain-filtered, no snapshot)
- `src/vex-agent/sync/executor.ts` — per-run execution wrapper
- `src/vex-agent/sync/seed.ts` — `seedSyncJobs` (idempotent upsert of default sync job definitions into `protocol_sync_jobs`)
- `src/vex-agent/sync/position-projector.ts` — routes activity → open_positions upsert/close by product_type
- `src/vex-agent/sync/activity-populator.ts` — creates `proj_activity` rows from trade capture
- `src/vex-agent/sync/projectors/spot.ts:11 projectSpotLot` — FIFO buy→openLot; sell→`projectSpotSell` (BEGIN/FOR UPDATE/COMMIT for lot race safety)
- `src/vex-agent/sync/projectors/lp.ts:11 projectLpLifecycle` — zap-in→upsertPosition, zap-out→closePosition, zap-migrate→close old + open new carrying cost basis
- `src/vex-agent/sync/mtm.ts` — `refreshPredictionMtm` (mark-to-market for Polymarket prediction positions)
- `src/vex-agent/sync/lp-economics.ts` — record LP cashflow legs into `proj_lp_events` + `proj_lp_event_legs`
- `src/vex-agent/sync/prediction-settlement-sync.ts` — `reconcilePredictionSettlements` (close settled positions)
- `src/vex-agent/sync/chains.ts` — `resolveChainHint(chain) → { family, chainIds }` (EVM/Solana routing)
- `src/vex-agent/sync/instrument-key.ts` — canonical per-product instrument key construction
- `src/vex-agent/sync/portfolio-chain-map.ts` — maps wallets to active chains for snapshot
- `src/vex-agent/sync/benchmark.ts` — benchmark asset key resolution (SOL, ETH, etc.)
- `src/vex-agent/sync/replay.ts` — truncate + rebuild projection tables from raw executions
- `src/vex-agent/sync/synthetic-capture.ts` — create synthetic `trade_capture` for tools without native capture

### embeddings/

- `src/vex-agent/embeddings/client.ts:57 FORMATTER_VERSION = "v1-gemma-title-text"` — used in `tool_embeddings.content_hash` to auto-invalidate on format change; `embedDocument(title, summary)` → `"title: {t} | text: {s}"`; `embedQuery(query)` → `"task: search result | query: {q}"`; `embedTool(toolId, summary)`; `EmbedResult { embedding, providerModel }` — providerModel is authoritative (provider-reported, falls back to config.model)
- `src/vex-agent/embeddings/config.ts:40 loadEmbeddingConfig` — validates EMBEDDING_BASE_URL, EMBEDDING_MODEL, EMBEDDING_DIM, EMBEDDING_PROVIDER; throws with all errors collected; dim range [1, 8192]; request timeout 30 s, retries 2×

### scripts/ (one-line summaries)

- `_preflight.ts` — environment validation before script runs
- `cross-lingual-benchmark-dataset.ts` — generates cross-lingual recall benchmark dataset
- `cross-lingual-benchmark.ts` — runs cross-lingual recall benchmark
- `knowledge-export.ts` — exports all knowledge_entries to JSON
- `knowledge-import/` — imports knowledge entries from JSON backup
- `knowledge-import.ts` — CLI entry for knowledge import
- `knowledge-reembed.ts` — reembeds all active knowledge_entries (acquires maintenance_lease)
- `tool-embeddings-health.ts` — checks tool_embeddings coverage vs live manifests
- `tool-reembed.ts` — reembeds all tool_embeddings entries

### public/ (static assets)

Agent identity images: `blue.png`, `lite.png`, `logo.png`, `logo_clean.png`,
`new_echo_text.png`, `pink.png`, `purple.png`, `red.png`, `vex.png`, `pnl_card.png`,
`sticker.webm`.

## Key types and invariants

- `Session` (`src/vex-agent/db/repos/sessions.ts:87`) — `mode: SessionMode` IMMUTABLE; `permission: SessionPermission` IMMUTABLE; `selectedEvmWallet/selectedSolanaWallet: SessionWalletRef | null` IMMUTABLE post-creation; **no model field** (ADR-0001: model is GLOBAL).
- `SessionPermission` = `"restricted" | "full"` — per-session, immutable. Gates approval flow.
- `MissionRunStatus` (from `engine/types.ts`) — 9 values: `running | paused_approval | paused_wake | paused_error | paused_user | completed | failed | stopped | cancelled`; `coerceStatus` in mission-runs.ts throws on unknown value (no silent coercion).
- `KnowledgeSource` (`memory/policy.ts:134`) = `"observed" | "user_confirmed" | "inferred" | "hypothesis"`. Only `observed` + `user_confirmed` may appear in hot context (`listActiveForHotContext`). Ensures hypothesis/inference never auto-injects into system prompt.
- `KnowledgeStatus` (`knowledge/policy.ts:58`) = `"active" | "superseded" | "invalidated" | "archived"`. `superseded` is NOT writable via `updateStatus` — only via `supersedeEntry` (atomic tx with lineage FK).
- `EmbedResult.providerModel` — provider-reported model name (or config fallback). Callers **MUST** stamp this to `embedding_model` (not `config.model`) for recall filter consistency.
- `content_hash` on `knowledge_entries` — sha256(length-prefixed kind|title|summary|content_md). Text-only; metadata excluded. Same text = same hash = idempotent write (returns existing row, no silent merge).
- `content_hash` on `session_memories` — sha256(theme+happened_md+did_md+tried_md). Outstanding items EXCLUDED (mutable; including them would break dedup invariant on `markOutstandingResolved`).
- `body_md_hash` on `session_memories` — sha256(body_md). Mutates on `markOutstandingResolved`. Used as WHERE guard in `updateEmbedding` to prevent stale embedding overwrite under concurrency.
- `wallet_intents.failure_reason` — MUST be structural-only label (`ErrorKind:shortSha256(message)`). Raw RPC/wallet errors MUST NEVER persist here.
- **Session wallet atomicity**: `chk_sessions_evm_wallet_atomic` + `chk_sessions_solana_wallet_atomic` CHECK constraints enforce all-or-nothing per family (id IS NULL ↔ address IS NULL).
- **One pending wake per session**: `uniq_loop_wake_pending_per_session` partial UNIQUE on `loop_wake_requests(session_id) WHERE status='pending'`. `enqueue` uses `ON CONFLICT DO NOTHING`.

## Capabilities (stable IDs)

- **CAP-db-pool-manage**: Engine Postgres pool lifecycle (lazy init, tx wrapper, graceful close) — `src/vex-agent/db/client.ts:27 getPool`
- **CAP-db-migrate-run**: Apply pending SQL migrations with advisory lock + progress — `src/vex-agent/db/migrate.ts:20 runMigrations`
- **CAP-db-sessions-create**: Create session with immutable mode/permission/wallet selection — `src/vex-agent/db/repos/sessions.ts:182 createSession`
- **CAP-db-sessions-compact**: Persist rolling summary, archive prefix, bump checkpoint_generation — `sessions.ts:251 setRollingSummary`, `sessions-archive.ts archivePrefix`
- **CAP-db-messages-append**: Transactional message insert + message_count bump — `src/vex-agent/db/repos/messages.ts:133 addMessageReturningId`
- **CAP-db-messages-history**: Full history (archive + live, archive wins on id collision) — `messages.ts:265 getAllMessages`
- **CAP-db-mission-runs-cas**: Atomic compare-and-set flip to running — `mission-runs.ts:214 casFlipToRunning`
- **CAP-db-approvals-enqueue**: Transactional enqueue (queue + intent + mission status atomically) — `approvals.ts:89 enqueueWith` + `approval-intents.ts:125 createWith`
- **CAP-db-approvals-decide**: CAS decision write (`decision IS NULL` guard) — `approval-intents.ts:158 markDecisionWith`
- **CAP-db-loop-wake-enqueue**: Idempotent wake enqueue (one-pending-per-session) — `loop-wake.ts:104 enqueue`
- **CAP-db-loop-wake-claim**: Exactly-once claim (FOR UPDATE SKIP LOCKED, dedicated connection) — `loop-wake.ts:166 claimDue`
- **CAP-db-wallet-intents-lifecycle**: Durable prepare/confirm/execute/fail/cancel with cross-session miss invariant — `wallet-intents.ts consumeIfPending, markExecuted, markFailed, markAuditFailed`
- **CAP-db-runtime-control**: Durable pause/stop/resume/cancel_wake requests; observer at safe checkpoints — `runtime-control-requests.ts:139 observePending`
- **CAP-db-runner-leases-claim**: Exclusive per-session runner ownership — `runner-leases.ts claim`
- **CAP-db-compact-jobs-outbox**: Track 2 outbox: enqueue, SKIP LOCKED claim, heartbeat, stale recovery — `compact-jobs/crud.ts claimNextDueJob`
- **CAP-db-knowledge-write**: Idempotent write (content_hash dedup), hot-context filtering by source — `knowledge/crud.ts insertEntry`, `knowledge/hot-context.ts listActiveForHotContext`
- **CAP-db-knowledge-supersede**: Atomic predecessor→successor lineage tx — `knowledge-lifecycle/supersede.ts supersedeEntry`
- **CAP-db-knowledge-recall**: Cosine search with model+dim filter + rerank + inline/overflow split — `knowledge/recall.ts recallTopK`, `knowledge/ranking.ts:76 rerank`, `knowledge/recall-payload.ts:33 splitInlineAndOverflow`
- **CAP-db-session-memories-insert**: Narrative chunk insert with dedup (content_hash) and body_md_hash — `session-memories/crud.ts insertPreparedMemory`
- **CAP-db-session-memories-recall**: Cosine search with mandatory model+dim filter — `session-memories/recall.ts recallTopK`
- **CAP-db-session-memories-resolve**: Mark outstanding items resolved (atomic body_md_hash guard) — `session-memories/crud.ts markOutstandingResolved`
- **CAP-db-tool-blobs-store**: Off-prompt ephemeral blob storage with TTL + resume-path refresh — `tool-output-blobs.ts set, refreshTtl`
- **CAP-db-maintenance-lease-gate**: Singleton write-gate (FOR UPDATE/FOR SHARE TOCTOU-safe) for reembed — `maintenance-lease.ts acquireLease, checkLease`
- **CAP-db-rewind-checkpoints**: Create + LIFO restore with idempotency key — `rewind-checkpoints.ts create, markRestored`
- **CAP-memory-policy-classify**: Classify context pressure fraction → PressureBand — `memory/policy.ts:172 classifyPressure`
- **CAP-memory-exclusion-scan**: Reject chunks with live-state fraction ≥ 0.30 — `memory/exclusion-rules.ts:97 scanLiveState`
- **CAP-memory-theme-validate**: Validate/fallback theme slug — `memory/theme-validation.ts:36 validateTheme`
- **CAP-knowledge-content-hash**: SHA-256 text-identity hash — `knowledge/content-hash.ts:29 computeContentHash`
- **CAP-knowledge-rerank**: Combined score (similarity + recency + confidence + pinned) — `knowledge/ranking.ts:76 rerank`
- **CAP-knowledge-split-recall**: Inline/overflow split by entry-count and chars caps — `knowledge/recall-payload.ts:33 splitInlineAndOverflow`
- **CAP-sync-init**: Boot balance sync + projection seeding — `sync/index.ts:22 initSync`
- **CAP-sync-tick**: Periodic balance + prediction settlement sync — `sync/index.ts:57 syncTick`
- **CAP-sync-spot-project**: FIFO lot open/reduce with transactional sell — `sync/projectors/spot.ts:11 projectSpotLot`
- **CAP-sync-lp-project**: LP zap-in/out/migrate with cost-basis carry — `sync/projectors/lp.ts:11 projectLpLifecycle`
- **CAP-embeddings-document**: Embed knowledge entry (EmbeddingGemma title|text format) — `embeddings/client.ts:102 embedDocument`
- **CAP-embeddings-query**: Embed recall query (EmbeddingGemma task:search format) — `embeddings/client.ts:115 embedQuery`
- **CAP-embeddings-tool**: Embed tool manifest for discovery rerank — `embeddings/client.ts:128 embedTool`
- **CAP-embeddings-config**: Validate and load EMBEDDING_* env vars at startup — `embeddings/config.ts:40 loadEmbeddingConfig`

## Public API (consumed by)

- `src/vex-agent/engine/**` (Z1/Z2) — all repos via `@vex-agent/db/repos/*`; `getPool()` for `withTransaction`; `closePool()` called by Z6 before each engine dispatch
- `src/vex-agent/tools/**` (Z3) — `wallet-intents`, `loop-wake`, `executions`, `tool-output-blobs`, `recall-cache`, `knowledge/*`, `session-memories`
- `vex-app/src/main/agent/compact-worker.ts` — type import of `CompactJobsExecutorHandle`
- `vex-app/src/main/ipc/wallets-session.ts` — type import of `WalletIntent`
- `vex-app/src/main/ipc/_shared/runtime-resume-dispatch.ts` — dynamic `import("@vex-agent/db/repos/runtime-control-requests.js")`
- `vex-app/src/main/ipc/runtime/cancel-wake.ts` — references loop-wake repo (dynamic import)
- `vex-app/src/main/ipc/compaction.ts` — compact-jobs repo (dynamic import)

Z6 does NOT import the engine repos for sessions, messages, usage, approvals, mission-runs, or knowledge — it uses its own raw-pg queries against the same Postgres.

## Internal flow

### Write path: knowledge entry

1. Tool handler (`knowledge_write`) calls `computeContentHash(parts)` → 64-char hex
2. `embedDocument(title, summary)` → `EmbedResult { embedding, providerModel }`
3. `checkLease()` (FOR SHARE on maintenance_leases) — fails if reembed is active
4. `insertEntry(input)` — INSERT ON CONFLICT (content_hash) DO NOTHING → `{ entry, inserted: bool }`
5. Return existing row if !inserted (idempotent)

### Write path: session memory (Track 2)

1. `compact-jobs` executor claims job via `claimNextDueJob` (SKIP LOCKED)
2. LLM call (`callChunkerLLM`) → chunker output with theme, narrative sections, outstanding_items
3. For each chunk: `validateTheme` → `scanLiveState` (reject if ≥ 30% live) → `redact`
4. `prepareMemoryRender(chunk)` → `body_md` + `body_md_hash` + `content_hash`
5. `embedDocument(theme, body_md)` → `EmbedResult`
6. `insertPreparedMemory(prepared, embedResult)` — ON CONFLICT (session_id, content_hash) WHERE status='active' DO NOTHING
7. `markCompleted(jobId, audit)` — stamps inference_provider, inference_model, cost_usd

### Read path: knowledge recall

1. `embedQuery(query)` → query vector
2. `knowledge/recall.ts recallTopK` — `WHERE status='active' AND embedding_model=$m AND embedding_dim=$d ORDER BY embedding <=> $q LIMIT k*2`
3. `rerank(candidates, { k, now })` — combined score, stable sort
4. `splitInlineAndOverflow(reranked)` — inline (≤10 entries, ≤50 000 chars) + overflow
5. Overflow persisted to `recall_cache_entries` (TTL 15 min) via `recall-cache.ts set`

### Sync flow (post-mutation)

1. Protocol tool execution → `insertActivity` + `enqueueRun(syncJobId, executionId)`
2. `syncTick` (or `initSync` startup) → `drainPendingRuns`
3. Worker groups by syncType, deduplicates, extracts chain hints from trade_capture
4. `selectiveBalanceSync(hint)` → Khalani API → upsert `proj_balances`
5. `projectSpotLot` / `projectLpLifecycle` → update `proj_pnl_lots` / `proj_open_positions`
6. MTM refresh → `refreshPredictionMtm`

## Dependencies

### Imports FROM

- `src/lib/db/migrate-runner.ts` — shared advisory-locked migration runner (Z5)
- `src/lib/diagnostics/text-redaction.ts` — two-tier redaction (Z5 via `memory/redaction.ts`)
- `@utils/logger` (Z5) — winston logger (NOT cross-boundary)
- `@utils/package-assets` (Z5) — `getVexAgentMigrationsDir()`
- `src/vex-agent/inference/resilience.ts` (Z3) — `retryWithBackoff`, `withTimeout`, `isRetryableError`
- `src/vex-agent/engine/types.ts` (Z1) — `MissionRunStatus`, `ACTIVE_RUN_STATUSES`, etc.
- `@tools/khalani/types.ts` (Z5) — `ChainFamily` in sync worker
- `src/vex-agent/knowledge/policy.ts` — `KnowledgeStatus`, `KnowledgeSource`
- `src/vex-agent/memory/policy.ts` — `KnowledgeSource` (cross-import within Z4)

### Consumed BY

- `module.vex-agent.engine-core` (Z1) — all repos, `withTransaction`, pool
- `module.vex-agent.engine-runtime-events` (Z1) — messages, sessions
- `module.vex-agent.engine-mission` (Z2) — mission-runs, missions, loop-wake, rewind-checkpoints
- `module.vex-agent.engine-compact` (Z2) — compact-jobs, session-memories, knowledge
- `module.vex-agent.inference` (Z3) — usage
- `module.vex-agent.tools-internal` (Z3) — wallet-intents, loop-wake, tool-output-blobs, recall-cache, session-memories
- `module.vex-agent.tools-protocols` (Z3) — executions, knowledge, tool-embeddings
- **vex-app main (Z6)**: `compact-jobs` (type), `wallet-intents` (type), `runtime-control-requests` (dynamic import), `loop-wake` (dynamic import) — all other Z6 DB access is via own raw-pg layer

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-db-…`
- quality findings: `audits/current/quality-findings.md`
- related decisions: `decisions/ADR-0001-global-model-session-wallet.md` — confirms sessions table has NO `model_id` column; model is global, wallet is per-session (mig 026)
- related flows: `flows/FLOW-chat-turn.md`, `flows/FLOW-compaction.md`

## Refresh triggers

This doc is stale when any migration is added (`src/vex-agent/db/migrations/*.sql`),
any repo file changes, or when Z6 switches from dynamic imports to static imports of
engine repos (boundary shift).

## Open questions

- ~~Does `syncTick` / `startSyncExecutor` have a production desktop callsite?~~ RESOLVED (Bundle A / F11):
  Z6 `index.ts` now starts compact + wake + sync workers; `setupSyncWorker()` (`vex-app/src/main/agent/sync-worker.ts`) owns `startSyncExecutor`.
- `runtime_state` and `runtime_cycles` tables (mig 001) appear to be legacy loop infrastructure. Confirm if they are still written by any active code path or if they are dead state.
- `inbox_events` has `src/vex-agent/db/repos/inbox.ts`; older notes saying no repo exists are superseded.
