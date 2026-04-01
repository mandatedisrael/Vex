# Database Layer — Echo Agent

Own Postgres database, separate from legacy `src/agent/db/`. Connection via `ECHO_AGENT_DB_URL`.

## Architecture

```
db/
  client.ts          — Pool singleton + query/queryOne/execute helpers
  migrate.ts         — Startup migration runner (schema_version table tracking)
  migrations/
    001_initial.sql  — Full schema from scratch (no legacy migration)
  repos/             — One file per domain, pure SQL queries
```

## Schema modules

### 001_initial.sql (foundation)

| Module | Tables | Purpose |
|--------|--------|---------|
| A. Identity & Content | `soul`, `memory_entries`, `folders`, `documents` | Agent identity, persistent memory, markdown documents in DB |
| B. Runtime & Sessions | `sessions`, `messages`, `messages_archive`, `approval_queue`, `runtime_state`, `runtime_cycles` | Conversation lifecycle, compaction, approvals, loop engine state |
| C. Automation | `schedules`, `schedule_runs`, `subagents`, `session_links`, `subagent_messages`, `inbox_events` | Cron tasks, subagent lifecycle, session relationships, autonomy queue |
| D. Inference & Provider | `usage_log`, `billing_snapshots` | Token usage with cache/reasoning breakdown, provider balance history |
| E. Protocol Pipeline | `protocol_executions`, `protocol_capture_items`, `protocol_sync_jobs`, `protocol_sync_runs`, `proj_balances`, `proj_portfolio_snapshots`, `proj_open_positions`, `proj_pnl_lots`, `proj_activity` | Execution audit, batch capture items, sync pipeline, projection tables, FIFO lot ledger |
| F. Web Cache | `search_cache`, `fetch_cache` | Tavily search/fetch result cache with TTL |

### 003_w4_pnl.sql (PnL extensions)

| Table/Column | Purpose |
|--------------|---------|
| `proj_activity` +5 columns | `input_value_usd`, `output_value_usd`, `fee_value_usd`, `unit_price_usd`, `valuation_source` — USD valuation from source APIs |
| `proj_pnl_matches` (new) | FIFO lot match ledger — `match_kind` (matched/shortfall), `lot_id` (nullable), `cost_basis_usd`, `proceeds_usd`, `realized_pnl_usd`. Pro-rata math in SQL NUMERIC. |
| `proj_open_positions` +2 columns | `notional_usd`, `fee_usd` — prediction position economics |

### 002_engine_missions.sql (engine extensions)

| Table | Purpose |
|-------|---------|
| `missions` | Mission contract: goal, constraints, wallets, chains, protocols, risk profile, stop conditions. Lifecycle: draft → ready → running → completed/failed/cancelled |
| `mission_runs` | Per-run state: status, loop_mode, iteration_count, stop_reason, checkpoint. NO parent_run_id (session_links is canonical) |
| `messages` (extended) | +source, +message_type, +visibility, +origin_session_id, +subagent_id — engine metadata for message taxonomy |
| `messages_archive` (extended) | Same columns as messages — CRITICAL: must be synchronized for archivization (DELETE...RETURNING * → INSERT) |

## Key design decisions

**session_links is canonical** — No `parent_session_id` on sessions or subagents. All parent-child relationships go through `session_links(parent_session_id, child_session_id, relation_type, subagent_id?)`. This covers subagent, scheduler, loop, and handoff relationships without duplicating FK columns. Used for ownership guard: `subagent_reply`, `subagent_stop`, `subagent_status(id)` validate parent → child ownership.

**Documents replace files** — No `knowledge_files` table. Content lives in `documents` with `folder_id` FK to `folders` table. Spaces (`knowledge`, `notes`) separate content domains. Soft delete via `archived_at`.

**NULL-safe unique indexes** — `folders` and `documents` have split unique indexes for root-level (NULL parent/folder) vs nested entries, because Postgres treats NULL != NULL in unique constraints.

**Protocol execution pipeline** — `protocol_executions` captures every mutating tool call (1 row per invocation) with `external_refs JSONB` indexed via GIN + partial btree. `protocol_capture_items` holds per-position/per-trade items within a single execution — batch tool calls (predict.closeAll) produce N items, single calls synthesize 1. `proj_activity` references `capture_item_id` instead of relying on UNIQUE(execution_id), enabling N activity rows per execution. `protocol_sync_jobs` defines refresh strategies. Projection tables (`proj_*`) hold derived state.

**No cli_execute** — Scheduler task types: `tool_call`, `wake_agent`, `reminder`, `monitor`, `snapshot`, `backup`. No legacy CLI spawning.

## Repos

| Repo | Domain | Key operations |
|------|--------|----------------|
| `soul.ts` | Identity | `getSoul()`, `upsertSoul()` |
| `memory.ts` | Memory | `appendMemory()` (hash dedup), `listEntriesWithIds()`, `replaceEntry()`, `deleteEntry()` |
| `folders.ts` | Content | `createFolder()`, `getFolderBySlug()`, `listFolders()`, `deleteFolder()` |
| `documents.ts` | Content | `getDocument()`, `upsertDocument()`, `listDocuments()`, `softDeleteDocument()`, `countDocuments()` |
| `sessions.ts` | Runtime | `createSession()`, `setScope()`, `checkpointSession()`, `archiveMessages()` |
| `messages.ts` | Runtime | `addMessage()`, `getLiveMessages()`, `getAllMessages()` |
| `approvals.ts` | Runtime | `enqueue()`, `approve()` (atomic CAS), `reject()`, `getPending()` |
| `session-links.ts` | Runtime | `linkSessions()`, `getChildSessions()`, `getParentSession()`, `getSubagentSession()` |
| `inbox.ts` | Autonomy | `publish()`, `consumePending()` (CTE + FOR UPDATE SKIP LOCKED), `peekPending()` |
| `search.ts` | Cache | `getCached()`/`cacheResult()`, `getCachedFetch()`/`cacheFetchResult()` |
| `schedules.ts` | Automation | `createSchedule()`, `deleteSchedule()`, `getEnabled()`, `recordRun()` |
| `subagents.ts` | Automation | `insert()`, `updateStatus()`, `getActive()`, `getRecent()`, `markOrphans()` |
| `subagent-messages.ts` | Automation | `sendMessage()`, `sendStructuredMessage()`, `getMessages()`, `getMessagesByDirection()`, `getUnhandled()`, `getMessagesByType()`, `markHandled()` |
| `executions.ts` | Protocol | `recordExecution()`, `getById()`, `getByExternalRef()`, `getByNamespace()` |
| `capture-items.ts` | Protocol | `recordCaptureItems()` (bulk insert N items per execution), `getByExecution()` |
| `sync.ts` | Protocol | `getJobsForNamespace()`, `getAllJobs()`, `getJob()`, `getLastCompletedRun()`, `enqueueRun()`, `claimPendingRun()`, `claimAllPending()`, `completeRun()`, `failRun()` |
| `balances.ts` | Projection | `upsertBalance()`, `replaceBalancesForChain()` (transactional), `getBalances()`, `getBalancesByChain()`, `getTotalUsd()`, `insertSnapshot()`, `getLatestSnapshot()`, `getSnapshotHistory()` |
| `activity.ts` | Projection | `insertActivity()` (with `captureItemId`), `getActivities()`, `getByExecution()` (returns list — batch captures produce N rows), `getByPositionKey()`, `getByInstrumentKey()` |
| `open-positions.ts` | Projection | `upsertPosition()`, `closePosition()`, `getOpen()`, `getByPositionKey()` |
| `pnl-lots.ts` | Projection | `openLot()`, `getOpenLots()` (FIFO ordered), `reduceLot()`, `closeLot()` |
| `pnl-matches.ts` | Projection | `recordMatchFromLot()` (SQL pro-rata), `recordShortfall()`, `getMatchesByInstrument()`, `getMatchesBySell()`, `getTotalRealizedPnl()` |
| `usage.ts` | Inference | `logUsage()` (with cached/reasoning tokens), `getStats()` |
| `billing.ts` | Inference | `insertSnapshot()`, `getLatest()`, `getHistory()` |
| `missions.ts` | Engine | `createDraft()`, `updateDraft()`, `setStatus()`, `setApprovedAt()`, `getMission()`, `getMissionBySession()`, `getActiveMission()` |
| `mission-runs.ts` | Engine | `createRun()`, `updateStatus(id, status, stopReason?, stopPayload?)`, `setLastCheckpoint()`, `incrementIterations()`, `getActiveRun()`, `getRun()`, `getRunBySession()` |
| `runtime.ts` | Engine | `getState()`, `setActiveLoop()`, `updatePhase()`, `stopLoop()`, `recordCycleStart()`, `recordCycleEnd()` |
| `messages.ts` (extended) | Runtime | Added `addMessage(sessionId, msg, metadata?)` with optional `MessageMetadata`, `addEngineMessage()` helper |

## ENV

```bash
ECHO_AGENT_DB_URL=postgresql://echo_agent:echo_agent@localhost:5432/echo_agent
```

Falls back to `postgresql://echo_agent:echo_agent@localhost:5432/echo_agent` if unset.

## Startup

```typescript
import { runMigrations } from "@echo-agent/db/migrate.js";
await runMigrations(); // idempotent, safe to call every boot
```
