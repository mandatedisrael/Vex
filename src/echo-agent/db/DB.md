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

## Schema modules (001_initial.sql)

| Module | Tables | Purpose |
|--------|--------|---------|
| A. Identity & Content | `soul`, `memory_entries`, `folders`, `documents` | Agent identity, persistent memory, markdown documents in DB |
| B. Runtime & Sessions | `sessions`, `messages`, `messages_archive`, `approval_queue`, `runtime_state`, `runtime_cycles` | Conversation lifecycle, compaction, approvals, loop engine state |
| C. Automation | `schedules`, `schedule_runs`, `subagents`, `session_links`, `subagent_messages`, `inbox_events` | Cron tasks, subagent lifecycle, session relationships, autonomy queue |
| D. Inference & Provider | `usage_log`, `billing_snapshots` | Token usage with cache/reasoning breakdown, provider balance history |
| E. Protocol Pipeline | `protocol_executions`, `protocol_sync_jobs`, `protocol_sync_runs`, `proj_balances`, `proj_portfolio_snapshots`, `proj_open_positions`, `proj_activity` | Execution audit, sync pipeline, projection tables |
| F. Web Cache | `search_cache`, `fetch_cache` | Tavily search/fetch result cache with TTL |

## Key design decisions

**session_links is canonical** — No `parent_session_id` on sessions or subagents. All parent-child relationships go through `session_links(parent_session_id, child_session_id, relation_type, subagent_id?)`. This covers subagent, scheduler, loop, and handoff relationships without duplicating FK columns.

**Documents replace files** — No `knowledge_files` table. Content lives in `documents` with `folder_id` FK to `folders` table. Spaces (`knowledge`, `notes`) separate content domains. Soft delete via `archived_at`.

**NULL-safe unique indexes** — `folders` and `documents` have split unique indexes for root-level (NULL parent/folder) vs nested entries, because Postgres treats NULL != NULL in unique constraints.

**Protocol execution pipeline** — `protocol_executions` captures every mutating tool call with `external_refs JSONB` (txHash, orderId, positionPubkey etc.) indexed via GIN + partial btree. `protocol_sync_jobs` defines what to refresh per namespace. `protocol_sync_runs` audits each refresh. Projection tables (`proj_*`) hold derived state.

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
| `executions.ts` | Protocol | `recordExecution()`, `getById()`, `getByExternalRef()`, `getByNamespace()` |
| `sync.ts` | Protocol | `getJobsForNamespace()`, `getAllJobs()`, `getJob()`, `getLastCompletedRun()`, `enqueueRun()`, `claimPendingRun()`, `claimAllPending()`, `completeRun()`, `failRun()` |
| `balances.ts` | Projection | `upsertBalance()`, `replaceBalancesForChain()` (transactional), `getBalances()`, `getBalancesByChain()`, `getTotalUsd()`, `insertSnapshot()`, `getLatestSnapshot()`, `getSnapshotHistory()` |
| `usage.ts` | Inference | `logUsage()` (with cached/reasoning tokens), `getStats()` |
| `billing.ts` | Inference | `insertSnapshot()`, `getLatest()`, `getHistory()` |

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
