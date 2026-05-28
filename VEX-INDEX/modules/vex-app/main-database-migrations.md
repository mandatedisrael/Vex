---
id: module.vex-app.main-database-migrations
kind: module
title: "Vex Electron Main Process — Raw Postgres Layer & Migration Runner"
source_commit: cf05003
indexed_at: 2026-05-28
paths:
  - vex-app/src/main/database/**
  - vex-app/src/main/ipc/database.ts
  - vex-app/src/main/ipc/memory.ts
  - vex-app/src/main/ipc/knowledge.ts
  - vex-app/src/main/ipc/messages.ts
  - vex-app/src/main/ipc/compaction.ts
  - vex-app/src/main/ipc/usage.ts
stale_when_paths_change:
  - "vex-app/src/main/database/*.ts"
  - "vex-app/src/main/ipc/database.ts"
  - "vex-app/src/main/ipc/memory.ts"
  - "vex-app/src/main/ipc/knowledge.ts"
  - "vex-app/src/main/ipc/messages.ts"
  - "vex-app/src/main/ipc/compaction.ts"
  - "vex-app/src/main/ipc/usage.ts"
  - "vex-app/resources/migrations/**"
  - "vex-app/scripts/copy-migrations.mjs"
  - "vex-app/scripts/check-build-artifacts.mjs"
  - "src/vex-agent/db/client.ts"
  - "src/vex-agent/db/repos/**"
  - "src/vex-agent/db/migrations/**"
related:
  - module.vex-app.main-bootstrap-lifecycle
  - module.vex-app.main-docker-compose-onboarding
  - module.vex-app.preload-channels-events-errors
  - module.vex-agent.data-memory-knowledge
  - "ADR-0001-global-model-session-wallet"
---

# Vex Electron Main Process — Raw Postgres Layer & Migration Runner

## Purpose

The Vex Electron desktop app owns a **parallel raw `pg.Client` layer** for reading session metadata, memory, knowledge, messages, approvals, usage, and compaction status from the same local Postgres instance that the engine (`src/vex-agent`) writes to.

This module:
1. **Isolates the renderer** — it never receives a connection string, password, or DB URL.
2. **Decouples the GUI build** — intentionally avoids importing engine repos; SQL is the contract.
3. **Owns migration responsibility** — the desktop app runs migrations on Postgres boot (M6), backed by a single-source-of-truth SQL directory synced from the engine.
4. **Enforces data boundaries** — DB helpers sanitize JSONB (messages tool calls, approvals, metadata) and redact sensitive columns before IPC.

Capabilities surface via IPC handlers: migration status, connection probes, session/memory/knowledge/message lists, compaction status, and usage aggregates.

## Retrieval keywords

- raw pg layer, pg.Client, pg.Pool
- migrate-runner, migration progress, single-flight dedup
- dim-lock, vector dimension invariant, embedding
- connection-state, db-config, password file
- progress-bus, ReplayBus, migration events
- sessions wallet selection, per-session mig026
- schema version 027, 24 SQL files, gaps 007/008/012
- session scope (`vex_app`), foreign scope guard
- IPC handlers: memory, knowledge, messages, usage, compaction, approvals
- JSONB reduction, sanitization, tool_call redaction
- sync executor wired (F11 fixed in Bundle A — `agent/sync-worker.ts` + `database/sync-db.ts`)

## State owned

**Single module-level connection state** (no shared pool):
- `current: DbConnection | null` — compose-side writer stores `pgPort` + `pgPasswordPath` after successful Docker Compose stack bootstrap.
- All DB reads derive `pg.Client` instances per-call from `buildPoolConfig()`, which reads the password file once.
- Migration runner owns a dedicated short-lived `pg.Pool` (max=1) for each run, then closes it.

**Migration progress events**:
- `migrationProgressBus: ReplayBus<MigrateProgress>` — typed singleton, emits `{ kind, applied, message, ts }` during migration.
- Subscription fires on in-process listeners; late renderer joins query `peek()` + explicit IPC send.

**Dim-lock invariant**:
- `countRowsWithDimNotMatching(targetDim)` probes `knowledge_entries` rows where `embedding_dim <> targetDim`.
- Non-zero count = user must export/wipe/re-import knowledge to change the embedding model.

## Boundary crossings

**Engine vs. main — separate `pg.Client` instances:**
- Engine pool: `src/vex-agent/db/client.ts` owns its own connection via `VEX_DB_URL`.
- Main pool: `vex-app/src/main/database/db-config.ts` derives config from `connection-state.ts` (set by Compose handler).
- **Both must use the same DB URL** after onboarding writes it to the vault and environment.

**Postgres URL handoff**:
1. Compose handler (IPC) writes `pgPort` + `pgPasswordPath` → `setDbConnection()` on successful stack bootstrap.
2. Migrate runner reads config → creates pool → runs migrations → tears down pool.
3. Engine (separate process, dynamic import) reads `VEX_DB_URL` from environment (set at app boot).
4. **Renderer never sees connection string.** IPC responses are sanitized DTOs.

**SQL as contract**:
- Migrations are versioned in `src/vex-agent/db/migrations/` (canonical source).
- Desktop app copies them to `vex-app/resources/migrations/` via `copy-migrations.mjs` (release-critical).
- Both sides parse the same SQL file names + version numbers; schema shape is the synchronization point.

## File map

### Core connection & pool setup
- **`connection-state.ts` (27 lines)** — Module-level storage for `DbConnection { pgPort, pgPasswordPath }`. Set by Docker Compose handler; read by db-config.
- **`db-config.ts` (45 lines)** — Builds `DbPoolConfig` from connection-state + password file. Returns null if Compose hasn't run yet.

### Migration runner
- **`migrate-runner.ts` (139 lines)** — M6 migration orchestrator. Owns per-call `pg.Pool` lifecycle, calls engine's `runMigrationsWithProgress()`, maps `MigrateRunResult` to IPC result, emits progress events to bus.
- **`progress-bus.ts` (16 lines)** — `ReplayBus<MigrateProgress>` singleton. Delivers "applied 5/12" events to in-process listeners; IPC handler peeks latest + sends to renderer.

### Readiness gates & probes
- **`dim-lock.ts` (128 lines)** — Embedding dimension lock for model-switch UX. `countRowsWithDimNotMatching(targetDim)` returns orphaned-row count. `probeDbReachable()` is a 2s best-effort connectivity check for envState.
- **`wake-db.ts` (60+ lines)** — `probeLoopWakeReady()` gates F2 wake-worker supervisor: returns true only if Postgres reachable AND `loop_wake_requests` table exists (migrations done).
- **`compaction-db.ts` (60+ lines)** — `probeCompactJobsReady()` mirrors wake-db; gates compaction status tracking. Read-only `getCompactionStatus()` returns app-scoped `compact_jobs` rows.

### Session-scoped read helpers
- **`sessions-db.ts` (80+ lines)** — Multi-session shell metadata. Creates sessions + missions in a transaction. Reads are app-scoped (`scope = 'vex_app'`, non-deleted). Enforces `ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES` whitelist (mirrors engine).
- **`missions-db.ts` (large)** — Mission CRUD: create draft, start run, checkpoint, finalize. Syncs acceptance/status with engine via shared `missions.status` enum.
- **`mission-runs-db.ts`** — Mission run state: fetch, list, checkpoint updates.
- **`missions-db-normalize.ts`** — Normalization helpers for mission tree structure.

### DB-backed IPC read handlers
- **`memory-db.ts` (80+ lines)** — Per-session memory list + stats. Sanitizes: omits narrative columns (`body_md`, `happened_md`, etc.), raw embeddings, hashes. Exposes outstanding work as counts only.
- **`knowledge-db.ts` (80+ lines)** — Global knowledge store list. Sanitizes: omits `content_md`, `source_refs`, `content_hash`, `embedding`, `embedding_model`, `embedding_dim`. Only metadata + ID leaves main.
- **`messages-db.ts` (large)** — Chat messages. Sanitizes `tool_calls` JSONB: best-effort `namespace:command` extraction (strings only; rejects nested objects). Metadata JSONB dropped until puzzle 02. Derives `kind` from `metadata.message_type` internally.
- **`usage-db.ts` (60+ lines)** — Usage metrics per session + context window. Handles `NUMERIC cost` column with explicit null checks. App-scoped (mirrors `memory-db`).
- **`approvals-db.ts` (large)** — Approval queue read + sanitization. **Critical:** `tool_call` JSONB (wallet addresses, amounts, transfer args) is reduced to allow-listed renderer DTO; raw JSONB never crosses IPC.
- **`bug-reports-db.ts`** — User-submitted crash/error logs. Write helper.
- **`wake-db.ts`, **`compaction-db.ts`** — Schema readiness + status (see above).

### IPC handlers
- **`vex-app/src/main/ipc/database.ts` (80+ lines)** — `migrate()` handler with single-flight dedup. Maps `MigrateRunResult → Result<MigrateResult>`. Failure is `err({ code: "data.migration_failed" })`, not a success kind.
- **`vex-app/src/main/ipc/memory.ts`** — `listSession()`, `getStats()` handlers backed by `memory-db`.
- **`vex-app/src/main/ipc/knowledge.ts`** — `list()`, `getStatus()` handlers backed by `knowledge-db`.
- **`vex-app/src/main/ipc/messages.ts`** — `listSession()`, `listTail()` handlers backed by `messages-db`.
- **`vex-app/src/main/ipc/usage.ts`** — `getContextWindow()`, `getLastTurn()`, `getSessionTotals()` handlers backed by `usage-db`.
- **`vex-app/src/main/ipc/compaction.ts`** — `getStatus()`, `getHistory()` handlers backed by `compaction-db`.

### Build artifacts
- **`vex-app/resources/migrations/` (24 .sql files)** — Mirrored from `src/vex-agent/db/migrations/` by `copy-migrations.mjs`. Includes intentional gaps (007, 008, 012 were skipped/deleted during engine development).
- **`vex-app/scripts/copy-migrations.mjs`** — Copies canonical migrations before build. Must run before packaging; release safety.
- **`vex-app/scripts/check-build-artifacts.mjs`** — CI check: validates mirror parity + file count (24).

## Key types & invariants

### Connection lifecycle

1. **Compose handler writes** `setDbConnection({ pgPort, pgPasswordPath })` after Docker stack reaches `running` / `reused`.
2. **Migrate runner reads** → builds pool config → runs migrations → closes pool.
3. **Engine (separate process)** imports `VEX_DB_URL` from environment (set by main process at boot).
4. **Renderer** never receives connection metadata. Only sanitized DTOs cross IPC.

### Migration safety

- **Single-source-of-truth**: `src/vex-agent/db/migrations/` is canonical.
- **Mirror validity**: `vex-app/resources/migrations/` must match (24 files, same names/versions, checked by `check-build-artifacts.mjs`).
- **Single-flight dedup**: M6 handler dedups concurrent renderer calls; one underlying run.
- **Idempotent**: `runMigrationsWithProgress()` uses `schema_version` table to track applied versions. Re-running is safe.
- **Progress events**: emitted to in-process listeners; late renderer join via `peek()` + explicit send.

### Schema version & file count

- **Schema version**: Postgres table `schema_version { version INTEGER PRIMARY KEY }` tracks applied migrations.
- **24 SQL files** in both canonical and mirrored directories.
- **Intentional gaps**: versions 007, 008, 012 were skipped during engine development (files deleted, not created).
- **Latest version**: 027 (`per_wallet_snapshots`).

### Sessions & wallets (ADR-0001)

- **Model is GLOBAL**: `AGENT_MODEL` env + `OPENROUTER_API_KEY` vault secret. **No per-session model selection.**
- **Wallets are PER-SESSION**: migration 026 adds `selected_evm_wallet_id`, `selected_evm_wallet_address`, Solana equivalents. Selection is immutable post-creation.
- **No `sessions.model_id` column** — superseded by ADR-0001. Any future per-session-model code is a divergence.

### Scope boundaries

- **`VEX_APP_SESSION_SCOPE = 'vex_app'`** — Sessions created by the GUI get this scope.
- **Foreign scope guard**: `memory-db`, `usage-db`, `compaction-db` return `null` for unknown/foreign/deleted session IDs. No fabricated stats.
- **App-scoped mission runs**: `sessions-db` whitelist `ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES` mirrors engine.

### JSONB sanitization

**Messages:**
- `tool_calls` JSONB: extracted `toolName` as `namespace:command` (strings only; nested objects rejected).
- `metadata` JSONB: dropped from renderer DTO (puzzle 02 will introduce controlled union).
- `kind` derived internally from `metadata.message_type`.

**Approvals:**
- `tool_call` JSONB: reduced to allow-listed `ApprovalPreview` DTO.
- Raw `tool_call` (wallet addresses, amounts, args) **never crosses IPC**.

**Memory:**
- Omitted: `body_md`, `happened_md`, `did_md`, `tried_md`, embeddings, hashes.
- Exposed: outstanding-work counts (open/resolved), `created_at`, theme summary.

**Knowledge:**
- Omitted: `content_md`, `source_refs`, `content_hash`, `embedding`, `embedding_model`, `embedding_dim`.
- Exposed: title, source, created_at, status.

## Capabilities (stable IDs)

**Core infrastructure:**
- `CAP-vexapp-db-connect` — Compose handler → `setDbConnection()`.
- `CAP-vexapp-db-status` — `probeDbReachable()`, `probeLoopWakeReady()`, `probeCompactJobsReady()`.
- `CAP-vexapp-db-config` — Derive pool config from connection-state + password file.

**Migration:**
- `CAP-vexapp-db-migrate-run` — M6 handler: `vex.database.migrate()` with single-flight dedup.
- `CAP-vexapp-db-migrate-progress` — Event: `vex.database.migrateProgress` (ReplayBus + broadcast).
- `CAP-vexapp-db-migrate-result` — Result: `{ kind: "applied" | "noop" | "failed", message, applied?, files? }`.

**Session metadata:**
- `CAP-vexapp-db-sessions-create` — Create session + mission in transaction.
- `CAP-vexapp-db-sessions-list` — List app-scoped sessions with deletion guard.
- `CAP-vexapp-db-sessions-delete` — Mark session deleted; cascade to missions/runs.
- `CAP-vexapp-db-missions-* ` — Mission CRUD (draft, start, checkpoint, finalize).

**Memory & knowledge (read-only):**
- `CAP-vexapp-db-memory-list` — IPC handler: `vex.memory.listSession()` (sanitized).
- `CAP-vexapp-db-memory-stats` — IPC handler: `vex.memory.getStats()` (outstanding counts).
- `CAP-vexapp-db-knowledge-list` — IPC handler: `vex.knowledge.list()` (sanitized).
- `CAP-vexapp-db-knowledge-status` — IPC handler: `vex.knowledge.getStatus()`.

**Messages & usage (read-only):**
- `CAP-vexapp-db-messages-list` — IPC handler: `vex.messages.listSession()`, `listTail()` (tool_call sanitized).
- `CAP-vexapp-db-usage-context-window` — IPC handler: `vex.usage.getContextWindow()`.
- `CAP-vexapp-db-usage-last-turn` — IPC handler: `vex.usage.getLastTurn()`.
- `CAP-vexapp-db-usage-totals` — IPC handler: `vex.usage.getSessionTotals()`.

**Approvals & compaction (read-only):**
- `CAP-vexapp-db-approvals-list` — IPC handler: `vex.approvals.list()` (tool_call sanitized).
- `CAP-vexapp-db-compaction-status` — IPC handler: `vex.compaction.getStatus()`.
- `CAP-vexapp-db-compaction-history` — IPC handler: `vex.compaction.getHistory()`.

**Dimension lock:**
- `CAP-vexapp-db-dim-lock` — `countRowsWithDimNotMatching()` for embedding model switch gate.

## Public API (consumed by)

**Compose handler** (`vex-app/src/main/ipc/docker.ts`):
- `setDbConnection(dbConn | null)` — writes state after Compose bootstrap.
- `setDbConnection(null)` — on teardown.

**Migration handler** (`vex-app/src/main/ipc/database.ts`):
- `runMigrationsForIpc(): Promise<MigrateRunResult>` — runs migrations, emits progress.
- `migrationProgressBus.subscribe()` — in-process listeners.
- `migrationProgressBus.peek()` — late renderer join.

**Readiness gates**:
- `probeDbReachable()` → `boolean | null`.
- `probeLoopWakeReady()` → `boolean`.
- `probeCompactJobsReady()` → `boolean`.

**Session/memory/knowledge/message/usage/approval/compaction read handlers**:
- `listSessionMemories(sessionId, limit)` → `Result<MemoryDto[] | null>`.
- `getMemoryStats(sessionId)` → `Result<MemoryStatsDto | null>`.
- `listKnowledgeEntries(input)` → `Result<KnowledgeListResult>`.
- `listSessionMessages(sessionId, limit)` → `Result<MessagePage | null>`.
- `getContextWindow(sessionId)` → `Result<ContextWindowDto | null>`.
- `listApprovalsForSession(sessionId)` → `Result<ApprovalSummaryDto[]>`.
- `getCompactionStatus(sessionId)` → `Result<CompactionStatusDto | null>`.

**Agent bridge** (wake/compaction executors):
- `probeLoopWakeReady()` — schema gate (F2).
- `probeCompactJobsReady()` — schema gate (F1, Track 2).

## Internal flow

### Boot & migration sequence

1. **App start** → main process loads environment.
2. **Compose handler** (M5) → `docker compose up -d` → waits for readiness.
3. **On success** → `setDbConnection({ pgPort, pgPasswordPath })`.
4. **IPC: migrate()** (M6) → check config → create pool → `runMigrationsWithProgress()` → close pool.
5. **Progress events** → emitted to ReplayBus, broadcast to renderer.
6. **Engine boot** (separate process, dynamic import) → reads `VEX_DB_URL` from env → uses same DB.

### Session create (missions)

1. Renderer sends `CH.sessions.create({ mode: 'mission', permission, initialGoal })`.
2. Handler calls `createSessionAndMission()`.
3. `BEGIN; INSERT sessions; INSERT missions; COMMIT;` — atomic.
4. `mission_runs` created later via `startMission()` after conversational setup.

### Memory/knowledge/message read flow

1. Renderer sends `CH.memory.listSession({ sessionId, limit })`.
2. IPC handler calls `listSessionMemories(sessionId, limit)`.
3. `memory-db.ts` → `buildPoolConfig()` → single-shot `pg.Client`.
4. Query sanitized: omit narrative/embedding/hash columns.
5. Return `ok(MemoryDto[])` or `ok(null)` if foreign scope / unknown.
6. Handler logs success/error, returns `Result<SessionMemoryListResult>`.

### Approval read (sanitization example)

1. Renderer sends `CH.approvals.list({ sessionId })`.
2. `approvals-db.ts` → query `approval_queue` rows.
3. For each row, extract `tool_call` JSONB → reduce to `ApprovalPreview` DTO.
4. **Raw `tool_call` (wallet addrs, amounts) is mapped away before IPC send.**
5. Return sanitized `ApprovalSummaryDto[]`.

## Dependencies

**Postgres client:**
- `pg` (Pool, Client, types) — main-side raw DB layer.
- Engine `@vex-lib/db/migrate-runner.js` — `runMigrationsWithProgress()` function.

**Shared schemas** (read-only from main process):
- `@shared/schemas/database.js` — `migrateInputSchema`, `migrateResultSchema`.
- `@shared/schemas/sessions.js` — session/mission/run types + `VEX_APP_SESSION_SCOPE`.
- `@shared/schemas/memory.js`, `knowledge.js`, `messages.js`, `usage.js`, `approvals.js`, `compaction.js` — DTO + input schemas.

**IPC infrastructure:**
- `@shared/ipc/result.js` — `ok()`, `err()`, `Result<T, VexError>`.
- `@shared/ipc/channels.js` — channel definitions.
- `registerHandler()` — IPC handler registration + error stamping.

**Logger:**
- `../logger/` — structured logging (no secrets).

**Events:**
- `../events/event-bus.ts` — `ReplayBus<T>` primitive.

**Compose integration:**
- `connection-state.ts` exports set/get functions for Docker Compose handler to call.

## Cross-references

**Related modules:**
- `module.vex-app.main-bootstrap-lifecycle` — app start, Docker Compose orchestration.
- `module.vex-app.main-docker-compose-onboarding` — Compose stack setup, password file generation.
- `module.vex-agent.data-memory-knowledge` — engine-side repos, schema definitions (456 lines; canonical schemas).
- `ADR-0001-global-model-session-wallet` — global model, per-session wallet decision.

**Engine side** (same DB, separate pool):
- `src/vex-agent/db/client.ts` — engine's `getPool()`, own connection via `VEX_DB_URL`.
- `src/vex-agent/db/repos/*` — engine read/write models (NOT imported by vex-app).
- `src/vex-agent/db/migrations/` — canonical migrations (24 files, versions 001–027 with gaps).

**IPC channels** (schema-defined):
- `CH.database.migrate` → `vex.database.migrate()`.
- `CH.memory.listSession` → `vex.memory.listSession()`.
- `CH.knowledge.list` → `vex.knowledge.list()`.
- `CH.messages.listSession` → `vex.messages.listSession()`.
- etc.

## Refresh triggers

This module is stale if:

1. **Connection handoff changes** — Compose writes to a different location; main reads from a different state key.
2. **Migration source changes** — canonical migrations move; mirror path changes; sync script breaks.
3. **Schema changes** — new tables/columns; migration file is added/removed; version numbering changes.
4. **IPC contract changes** — new read handlers; sanitization rules change; response DTOs expand.
5. **Scope boundaries change** — `VEX_APP_SESSION_SCOPE` value changes; foreign-scope guard is relaxed/removed.
6. **JSONB sanitization rules change** — sensitive columns added to read queries; tool_call reduction weakened; metadata exposed.
7. **Sync executor activation** (F11) — if async sync executor is finally wired into main boot, update boot flow section.

Watch paths:
- `vex-app/src/main/database/*.ts`
- `vex-app/src/main/ipc/docker.ts` (Compose handler)
- `vex-app/resources/migrations/**`
- `src/vex-agent/db/migrations/**`
- `src/vex-agent/db/client.ts`

## Open questions

### F11: Sync executor not wired

**Status**: FIXED (Bundle A / Round 4)  
**Resolution**: `setupSyncWorker()` (`vex-app/src/main/agent/sync-worker.ts`) is started in `vex-app/src/main/index.ts` after `setupWakeWorker()` and drained in the quit `Promise.allSettled([...])`. Schema gate is `vex-app/src/main/database/sync-db.ts probeProtocolSyncReady()` (`to_regclass('public.protocol_sync_jobs')`), mirroring `wake-db.ts`. No provider gate (sync makes public-address network reads, not inference calls), so it starts as soon as the schema is ready — pre-unlock public-address egress is an accepted privacy trade-off (no key access). Dual Codex GREEN LIGHT.

### Schema version vs. file count

**Status**: RESOLVED  
**Finding**: 24 SQL files, latest version 027, but versions 007/008/012 are missing (deleted during engine development, not created).

**Evidence**:
- `find src/vex-agent/db/migrations/ -name "*.sql"` lists 24 files.
- Files: 001–027 visible, but 007, 008, 012 absent.
- Migration table `schema_version { version INTEGER PRIMARY KEY }` tracks which versions are applied.

**Impact**: Normal. Intentional gaps are safe — `schema_version` is the source of truth, not file count.

**Confidence**: High. Files confirmed in place; no data loss.

### Column rename drift between main-side raw queries and engine repos

**Status**: RISK (procedural, not active bug)  
**Finding**: Main process writes raw SQL; engine repos write ORM/type-safe queries. If a table column is renamed in a migration, main-side raw queries must be updated separately.

**Evidence**:
- `memory-db.ts` uses raw `SELECT ... FROM session_memories WHERE ...`.
- Engine `src/vex-agent/db/repos/session-memories.ts` (if it exists) uses `query()` builder.
- If a migration renames `body_md` → `narrative_md`, the raw query breaks, but TypeScript won't catch it.

**Impact**: Late runtime failure (500 error on IPC call).

**Mitigation**: Code review checklist for migrations: verify both main-side raw queries and engine repos are updated. No automated cross-check currently exists.

**Confidence**: Medium. Pattern is clear; no observed drift yet.

### Lifecycle on Compose teardown

**Status**: UNVERIFIED  
**Finding**: When Docker Compose stack is torn down (user quits app or explicit teardown), `setDbConnection(null)` is called, but DB clients may still be in-flight from renderer requests.

**Evidence**:
- `docker.ts` calls `setDbConnection(null)` on teardown/error.
- In-flight IPC handlers calling `buildPoolConfig()` will get `null` and return `dbUnavailable()` error.
- No explicit drain/timeout for pending DB operations before null-ing the connection.

**Impact**: Race condition possible but expected — IPC handlers are meant to fail gracefully when DB is unavailable.

**Mitigation**: Renderer should handle `dbUnavailable()` error and surface "services stopping" to user. No changes needed if this is already tested.

**Confidence**: Medium. Architecture is sound; edge case testing unclear.
