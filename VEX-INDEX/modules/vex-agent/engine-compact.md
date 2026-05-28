---
id: module.vex-agent.engine-compact
kind: module
paths:
  - "src/vex-agent/engine/compact-jobs/**"
source_commit: c138af8
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/vex-agent/engine/compact-jobs/**"
  - "src/vex-agent/engine/checkpoint/prefix.ts"
  - "src/vex-agent/engine/core/turn-loop*.ts"
  - "src/vex-agent/tools/internal/compact/now.ts"
  - "src/vex-agent/db/repos/compact-jobs/**"
  - "src/vex-agent/db/migrations/017_compact_jobs.sql"
  - "src/vex-agent/memory/policy.ts"
  - "vex-app/src/main/agent/compact-worker.ts"
related:
  - module.vex-agent.engine-core
  - module.vex-agent.engine-runtime-events
  - module.vex-agent.data-memory-knowledge
  - module.vex-agent.inference
---

# Engine Compaction (compact-jobs)

## Purpose

Implements the two-track compaction pipeline that shrinks a session's live
transcript when context pressure reaches the barrier band. **Track 1** is a
synchronous, atomic single-transaction operation that archives the prefix,
sets the rolling summary, bumps `checkpoint_generation`, and enqueues a
Track 2 outbox row — it commits in one round-trip and returns immediately.
**Track 2** is a fully independent async worker (`startCompactJobsExecutor`)
that polls `compact_jobs` at 5-second intervals and calls the LLM chunker to
produce narrative `session_memories` chunks. Track 2 failure never blocks or
rolls back Track 1. The parallel-non-blocking separation is a hard product
invariant.

## Retrieval keywords

- compaction, compact, summarization, archive prefix, transcript shrink
- compact_now tool, forced fallback, giant-tool, checkpoint generation
- Track 1, Track 2, chunker, compact_jobs outbox, session_memories
- executeCompactNow, startCompactJobsExecutor, withCheckpointMutex
- setupCompactWorker, maybeRunForcedCompactFallback

## State owned

- **DB table** `compact_jobs` (mig 017): outbox for Track 2. Status machine:
  `pending → running → completed | failed → permanently_failed`.
  Unique index on `(session_id, checkpoint_generation)` prevents duplicate
  enqueue. Heartbeat (`heartbeat_at`) + stale threshold 2 min; worker recovers
  stale-running rows on boot.
- **DB column** `sessions.checkpoint_generation` (INTEGER): monotone,
  incremented atomically by Track 1 under `SELECT … FOR UPDATE`.
- **DB column** `sessions.summary` (TEXT): rolling summary; wholesale-replaced
  (not merged) on each Track 1 commit.
- **Process-local in-memory mutex** `compactInFlight` Map in `state.ts`:
  per-session promise chain serialising concurrent `executeCompactNow` calls
  within the same process.
- **Process-local in-memory Set** `sessionMutex` in executor `tick()`:
  prevents the worker from processing two jobs for the same session
  concurrently.
- **Process-local rate-limit map** `lastEmitByWorker` in
  `heartbeat-rate-limit.ts`: caps `compact-worker.heartbeat_failed` logs to
  one per 60 s per worker ID.

## Boundary crossings

- **DB (engine pool)**: `compact-jobs/service.ts` uses a dedicated pg `Client`
  checked out of the engine pool for the Track 1 transaction (all writes
  inside one `BEGIN/COMMIT`). `archived-prefix.ts` and the executor use the
  shared `query()` helper.
- **DB (engine pool repo layer)**: `enqueueJob`, `claimNextDueJob`, `heartbeat`,
  `markCompleted`, `markFailed`, `recoverStaleRunning`, `resetPermanentlyFailed`
  in `db/repos/compact-jobs/`.
- **LLM (OpenRouter)**: Track 2 `chunker-call.ts` calls
  `provider.chatCompletionSimple()` over the same `OPENROUTER_API_KEY` /
  `AGENT_MODEL` env vars the in-turn provider uses. 30 s `Promise.race` timeout.
- **Embedding service**: `embedDocument()` (Docker Model Runner `:12434`) called
  per accepted chunk in `chunk-processing.ts`.
- **`session_memories` repo**: `insertPreparedMemory` + `prepareMemoryRender`
  after embedding.
- **`messages_archive` table**: Track 1 calls `archivePrefix` or
  `forkToolMessageToArchive`; Track 2 reads archived rows via
  `loadArchivedPrefix`.
- **Bug-report sink** (`engine/support/bug-report-registry.ts`): emitted on
  permanent Track 2 failure via `bug-emit.ts` → `emitBugReportSafe`.
- **vex-app main** (`vex-app/src/main/agent/compact-worker.ts`): owns the
  Track 2 executor lifecycle via `setupCompactWorker`. Started from
  `vex-app/src/main/index.ts:136` after `compact_jobs` schema is confirmed
  ready (`probeCompactJobsReady`).

## File map

- `src/vex-agent/engine/compact-jobs/service.ts:64 executeCompactNow` —
  Track 1 entry point. Acquires mutex, runs the atomic transaction (summary
  replace + generation bump + token_count reset + enqueue + archive/fork),
  returns `CompactCommitResult`.
- `src/vex-agent/engine/compact-jobs/service.ts:42 CompactCommitArgs` —
  input type; `source: "agent_tool" | "forced_fallback"`.
- `src/vex-agent/engine/compact-jobs/service.ts:50 CompactCommitResult` —
  discriminated union: `{kind:"committed",generation,archivedMessages,jobId,
  redactionCounts,planMode}` | `{kind:"noop",reason}`.
- `src/vex-agent/engine/compact-jobs/state.ts:18 withCheckpointMutex` —
  process-local per-session promise-chain mutex wrapping `executeCompactNow`.
  `resetCompactMutexForTests` for unit-test cleanup.
- `src/vex-agent/engine/compact-jobs/executor.ts:64 startCompactJobsExecutor` —
  Track 2 poll loop (default 5 s). Returns `CompactJobsExecutorHandle {stop}`.
  Worker ID: `compact-worker-<pid>-<uuid8>`. Stale recovery on boot. Pre-claim
  provider-config gate prevents burning retry budget when env not wired.
  Per-session `sessionMutex` Set.
- `src/vex-agent/engine/compact-jobs/executor.ts:154 processJob` —
  per-job lifecycle: loadArchivedPrefix → callChunkerLLM → processChunkerOutput
  → markCompleted (owner-checked). Heartbeat interval 20 s; claim-loss flag
  cancels mid-job.
- `src/vex-agent/engine/compact-jobs/archived-prefix.ts:25 loadArchivedPrefix` —
  reads `messages_archive` for `(session_id, source_start..source_end)` range.
- `src/vex-agent/engine/compact-jobs/archived-prefix.ts:50 renderRedactedArchivedTranscript` —
  redacts each archived row before sending to remote chunker.
- `src/vex-agent/engine/compact-jobs/archived-prefix.ts:76 redactStringArray` —
  per-element redaction with aggregated counts; used for structured columns.
- `src/vex-agent/engine/compact-jobs/chunker-call.ts:47 callChunkerLLM` —
  builds and fires the chunker prompt against OpenRouter; Zod-validates
  `ChunkerOutputSchema` on response; throws (not empty-array) on any failure
  so the outbox row stays retryable.
- `src/vex-agent/engine/compact-jobs/chunker-call.ts:23 ChunkerOutputSchema` —
  Zod schema for `{chunks:[{theme,entities[],protocols[],error_classes[],
  chains[],tasks[],happened_md,did_md,tried_md,outstanding_items[]}]}`.
- `src/vex-agent/engine/compact-jobs/chunk-processing.ts:56 processChunkerOutput` —
  per-chunk: redact all string fields → validate/fallback theme → exclusion scan
  → prepareMemoryRender → embedDocument → insertPreparedMemory. Returns
  `ChunkProcessingOutcome` discriminated union with three claim-loss variants.
- `src/vex-agent/engine/compact-jobs/forced-fallback.ts:30 maybeRunForcedCompactFallback` —
  deterministic (no LLM) synthesis of compact args from DB state, then delegates
  to `executeCompactNow`. Called by turn-loop at critical band when agent did
  not call `compact_now`.
- `src/vex-agent/engine/compact-jobs/giant-tool.ts:13 buildGiantToolPlaceholder` —
  stub text injected into live `messages` when a single oversized tool row is
  forked to archive.
- `src/vex-agent/engine/compact-jobs/heartbeat-rate-limit.ts:18 shouldEmitHeartbeatFailure` —
  60 s / worker rate-limiter for transient heartbeat DB errors.
- `src/vex-agent/engine/compact-jobs/bug-emit.ts:15 emitCompactWorkerPermanentlyFailedBug` —
  emits `compact_unable_at_critical` severity:critical bug report on terminal
  Track 2 failure; fail-closed via `emitBugReportSafe`.
- `src/vex-agent/engine/checkpoint/prefix.ts:54 selectPrefixWithGiantFallback` —
  out-of-scope owner but called by Track 1. Returns `CheckpointPlan` with
  modes `prefix | giant_tool | noop`. `TAIL_WINDOW=10`,
  `GIANT_TOOL_THRESHOLD=8000` chars. Skips overflow-flagged tool rows.

## Key types & invariants

- `CompactJob` (`src/vex-agent/db/repos/compact-jobs/types.ts:24`) —
  full outbox row. `attemptCount / maxAttempts` (default 3) gate
  `permanently_failed` escalation.
- `CompactJobStatus` (`types.ts:9`) — closed union:
  `pending | running | completed | failed | permanently_failed`.
- `CheckpointPlan` (`engine/checkpoint/prefix.ts:26`) — `prefix | giant_tool | noop`.
- `CompactCommitArgs.source` — `"agent_tool"` (called from `compact_now` tool
  handler) vs `"forced_fallback"` (called from turn-loop critical-band path).
  Surfaced in `compact.committed` log.
- **Track 1 atomicity invariant**: summary replace + generation bump +
  token_count reset + `enqueueJob` + `archivePrefix`/`forkToolMessageToArchive`
  all commit in a single DB transaction under a `SELECT … FOR UPDATE` on
  `sessions`. No observer can see a half-archived transcript.
- **Track 2 non-blocking invariant**: Track 1 always commits before Track 2
  starts work. Track 2 failure leaves `compact_jobs` row in `failed`/
  `permanently_failed` but never rolls back Track 1. This is a hard product
  invariant.
- **Provider-config gate**: executor's `tick()` checks `OPENROUTER_API_KEY` and
  `AGENT_MODEL` before claiming any job. Missing config → idle, one warning
  log per streak, no retry-budget burn.
- **Chunker throw-not-empty**: `callChunkerLLM` throws on any parse/schema/
  config failure rather than returning `[]`, preserving the outbox row as
  retryable.
- **Exact-body embedding contract**: the bytes rendered by `prepareMemoryRender`
  are the bytes embedded by `embedDocument` and stored in `session_memories`.
- **Redaction before remote**: `renderRedactedArchivedTranscript` scrubs the
  transcript before it leaves the process to the OpenRouter chunker. All
  structured LLM output fields are also redacted before DB write.
- **Claim-loss defense-in-depth**: heartbeat flips `claimLost` flag;
  `processChunkerOutput` checks at entry, pre-render, post-embed, and
  post-loop; `markCompleted`/`markFailed` are owner-checked at the DB.
- **Token count reset**: Track 1 writes `token_count = 0` in the same UPDATE
  as `checkpoint_generation` bump, preventing a stale-critical-band forced
  fallback on restart.

## Capabilities (stable IDs)

- **CAP-compact-track1-commit**: Atomic single-tx compaction: archive prefix (or
  fork giant-tool), replace rolling summary, bump generation, enqueue Track 2 job.
  `service.ts:64 executeCompactNow`
- **CAP-compact-track1-mutex**: Per-session process-local serialization of
  concurrent compact calls. `state.ts:18 withCheckpointMutex`
- **CAP-compact-track1-plan**: Prefix vs giant-tool vs noop selection.
  `engine/checkpoint/prefix.ts:54 selectPrefixWithGiantFallback`
- **CAP-compact-track1-giant-tool**: Fork oversized tool row to archive, inject
  stub placeholder in live messages. `service.ts:171 forkToolMessageToArchive`
  + `giant-tool.ts:13 buildGiantToolPlaceholder`
- **CAP-compact-track1-forced-fallback**: Deterministic (LLM-free) compact
  synthesis at critical band when agent did not call `compact_now`.
  `forced-fallback.ts:30 maybeRunForcedCompactFallback`
- **CAP-compact-track2-executor**: Poll-based async worker claiming and
  processing Track 2 outbox jobs. `executor.ts:64 startCompactJobsExecutor`
- **CAP-compact-track2-heartbeat**: Per-job ownership heartbeat with claim-loss
  detection and rate-limited error logging.
  `executor.ts:164 heartbeatTimer` + `heartbeat-rate-limit.ts:18 shouldEmitHeartbeatFailure`
- **CAP-compact-track2-chunker**: LLM call to OpenRouter with Zod-validated
  structured output. `chunker-call.ts:47 callChunkerLLM`
- **CAP-compact-track2-chunk-processing**: Per-chunk redact → theme validate →
  exclusion scan → render → embed → insert pipeline.
  `chunk-processing.ts:56 processChunkerOutput`
- **CAP-compact-track2-stale-recovery**: Bootstrap recovery of stale-running
  jobs on worker start. `executor.ts:84 recoverStaleRunning`
- **CAP-compact-track2-retry-backoff**: Exponential backoff on failure;
  permanent escalation at `maxAttempts=3`.
  `executor.ts:275 markFailed` + `db/repos/compact-jobs/crud.ts`
- **CAP-compact-track2-bug-report**: Terminal failure surfaces a
  `compact_unable_at_critical` bug report via the injectable sink.
  `bug-emit.ts:15 emitCompactWorkerPermanentlyFailedBug`
- **CAP-compact-track2-retry-ipc**: User-triggered retry of a permanently-failed
  job from the renderer via IPC. `vex-app/src/main/ipc/compaction.ts:118`
  + `db/repos/compact-jobs/crud.ts resetPermanentlyFailed`
- **CAP-compact-agent-tool**: `compact_now` tool visible to agent at barrier
  band and above. `src/vex-agent/tools/internal/compact/now.ts:56 handleCompactNow`
- **CAP-compact-supervisor**: Electron main supervised startup of Track 2
  executor, gated on DB readiness. `vex-app/src/main/agent/compact-worker.ts:62 setupCompactWorker`

## Public API (consumed by)

| Caller | Entry |
|--------|-------|
| `src/vex-agent/tools/internal/compact/now.ts:77` | `executeCompactNow` (Track 1, agent_tool path) |
| `src/vex-agent/engine/core/turn-loop-waiting-for-wake.ts:36` | `maybeRunForcedCompactFallback` (critical band before wake) |
| `src/vex-agent/engine/core/turn-loop.ts` (via `turn-loop-tool-batch.ts:275`) | `compact_committed` engine signal → `applyPostCompactBookkeeping` |
| `src/vex-agent/engine/index.ts:47` | re-exports `startCompactJobsExecutor` |
| `vex-app/src/main/agent/compact-worker.ts:51` | `startCompactJobsExecutor` (Track 2 executor, via dynamic import) |
| `vex-app/src/main/index.ts:136` | `setupCompactWorker()` (Electron main boot) |
| `vex-app/src/main/ipc/compaction.ts:159` | `resetPermanentlyFailed` (retry IPC) |
| `src/__tests__/integration/engine/compact-service.int.test.ts` | `executeCompactNow`, `startCompactJobsExecutor` |
| `src/__tests__/integration/memory/long-mission.test.ts` | `executeCompactNow`, `startCompactJobsExecutor` |

## Internal flow

### Track 1 — sync in-turn compaction

```
agent calls compact_now tool
  │
  └─► handleCompactNow (tools/internal/compact/now.ts:56)
        │  Zod-parse args (conversation_summary, preserve_md, thread_themes_hints)
        └─► executeCompactNow (service.ts:64)
              │  withCheckpointMutex (state.ts:18) — process-local per-session queue
              └─► executeCompactNowInner (service.ts:68)
                    1. redact(agentSummary / preserveMd / themeHints)
                    2. pool.connect() → BEGIN
                    3. SELECT checkpoint_generation FROM sessions WHERE id = $1 FOR UPDATE
                       → nextGen = current + 1
                    4. getLiveMessagesWithId(sessionId, tx)   ← same tx connection
                    5. selectPrefixWithGiantFallback(messages)
                       → plan: {prefix|giant_tool|noop}
                    6. if noop → ROLLBACK, return {kind:"noop"}
                    7. setRollingSummary(sessionId, redactedSummary, tx)  ← REPLACE
                    8. UPDATE sessions SET checkpoint_generation=$nextGen, token_count=0
                    9. enqueueJob({...}, tx)  ← idempotent ON CONFLICT (session,gen)
                       → enq.job.id
                    10a. [prefix mode] archivePrefix(sessionId, cutoffMessageId, ...)
                    10b. [giant_tool mode] buildGiantToolPlaceholder(bloatedMsgId, jobId)
                                          forkToolMessageToArchive(sessionId, ..., placeholder)
                    11. COMMIT
                    → {kind:"committed", generation, archivedMessages, jobId, ...}

handleCompactNow returns ToolResult with engineSignal {type:"compact_committed"}
turn-loop-tool-batch.ts detects compact_committed → drains remaining batch calls
  with synthetic "batch_aborted_by_compact" results
turn-loop.ts:330 calls applyPostCompactBookkeeping
  → writes compaction_committed marker message (display)
  → reloads live messages + rolling summary
  → merges operator interrupts
  → sets postCompactBridgeRemaining = POST_COMPACT_BRIDGE_CYCLES (2)
```

**Forced fallback** (runtime path, no LLM):
```
turn-loop-waiting-for-wake.ts (critical band check)
  └─► maybeRunForcedCompactFallback(sessionId)
        1. synthesizeAgentSummary — sessions.summary + last 5 assistant msgs
        2. synthesizePreserveMd  — unresolved outstanding_items from session_memories
        3. synthesizeThemes      — top 3 recent themes from session_memories stats
        └─► executeCompactNow({..., source:"forced_fallback"})
              [same Track 1 flow as above]
```

### Track 2 — async chunker worker

```
setupCompactWorker (vex-app/src/main/agent/compact-worker.ts:62)
  │  supervisor: polls every 30 s until DB + compact_jobs schema ready
  └─► startCompactJobsExecutor (executor.ts:64)
        │  workerId = "compact-worker-<pid>-<uuid8>"
        │  recoverStaleRunning(WORKER_STALE_THRESHOLD_MS=120s)  — on boot
        └─► schedule() / tick() loop (default 5 s)
              │  pre-claim gate: check OPENROUTER_API_KEY + AGENT_MODEL in env
              │  claimNextDueJob(workerId) FOR UPDATE SKIP LOCKED
              │  sessionMutex.has(job.sessionId)? → markFailed(backoff=5s), skip
              └─► processJob(job, workerId)
                    │  heartbeatTimer (setInterval 20 s) → heartbeat(jobId, workerId)
                    │    claimLost flag if heartbeat returns false
                    │
                    1. loadArchivedPrefix(sessionId, start, end)
                       ← messages_archive WHERE session_id AND id BETWEEN start AND end
                       └─ empty range → throw "compact_worker_empty_archive_range"
                    [claimLost check]
                    2. callChunkerLLM(job, archivedPrefix)
                       a. renderRedactedArchivedTranscript(archivedPrefix)
                       b. build systemPrompt + userPrompt (summary, preserve, themes, transcript)
                       c. provider.chatCompletionSimple() with TRACK2_TIMEOUT_MS=30s race
                       d. JSON.parse + ChunkerOutputSchema.safeParse → throw if invalid
                    [claimLost check]
                    3. processChunkerOutput({job, chunkerOutput, claimGuard})
                       for each raw chunk:
                         a. redact all string fields (theme, narrative, structured arrays)
                         b. validateTheme(redacted) || buildFallbackTheme(...)
                         c. scanLiveState(body) → exclusionScan; if rejected: skip
                         [claimLost mid-loop checks → claim_lost_silent]
                         d. prepareMemoryRender({theme, happenedMd, didMd, triedMd, outstandingTexts})
                         e. embedDocument(theme, prep.bodyMd)
                         [claimLost mid-loop check → claim_lost_silent]
                         f. insertPreparedMemory({sessionId, gen, theme, embedding, ...}, prep)
                    [claimLost post-loop check → claim_lost_after_loop]
                    4. markCompleted(jobId, workerId, auditData)  — owner-checked
                    │
                    └─ on error: markFailed(jobId, workerId, msg, backoff=TRACK2_RETRY_BACKOFF_BASE_MS*attemptCount)
                         if result.terminal: emitCompactWorkerPermanentlyFailedBug(...)
```

## Dependencies

**Imports FROM:**
- `module.vex-agent.engine-core`: `selectPrefixWithGiantFallback` (checkpoint/prefix.ts),
  `appendMessage`/`appendMessageForSession` (turn-loop post-compact via events), turn-loop
  helpers consuming the `compact_committed` engine signal.
- `module.vex-agent.data-memory-knowledge`: `db/repos/compact-jobs/` (all CRUD),
  `db/repos/sessions.js` (`setRollingSummary`, `getLiveMessagesWithId`),
  `db/repos/sessions-archive.js` (`archivePrefix`, `forkToolMessageToArchive`),
  `db/repos/session-memories/` (`insertPreparedMemory`, `prepareMemoryRender`,
  `getSessionMemoryStats`), `memory/redaction.js` (`redact`),
  `memory/exclusion-rules.js` (`scanLiveState`), `memory/theme-validation.js`,
  `memory/policy.js` (all constants), `db/client.js` (`getPool`, `query`, `queryOne`).
- `module.vex-agent.inference`: `inference/openrouter.js` (`OpenRouterProvider`,
  `chatCompletionSimple`) — dynamic import in `chunker-call.ts`.
- `module.vex-agent.engine-runtime-events` (support): `engine/support/bug-report-registry.js`
  (`getBugReportSink`) — dynamic import in `bug-emit.ts`.
- Z5 root: `lib/diagnostics/bug-report-sink.js` (`emitBugReportSafe`),
  `utils/logger.js`.
- `module.vex-agent.data-memory-knowledge` (embeddings): `embeddings/client.js`
  (`embedDocument`).

**Consumed BY:**
- `module.vex-agent.engine-core` (turn-loop): `forced-fallback.ts` and the
  `compact_committed` signal path.
- `src/vex-agent/tools/internal/compact/now.ts` (agent tool): `executeCompactNow`.
- Z6 vex-app main: `vex-app/src/main/agent/compact-worker.ts` (Track 2 lifecycle),
  `vex-app/src/main/ipc/compaction.ts` (status/history/retry IPC).
- Integration tests: `src/__tests__/integration/`.

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-compact-track2-retry-ipc`
  (renderer CompactionChip + retry flow — partially implemented in Z8)
- quality findings: `audits/current/quality-findings.md` (none specific to this
  module at source_commit; cost telemetry `costUsd: null` is a documented
  deferred item — PR3)
- related flows: `flows/FLOW-compaction.md` (not yet written — Round 2)
- related decisions: `decisions/ADR-0001-global-model-session-wallet.md`
  (global model applies to Track 2 chunker; no per-session model override)

## Refresh triggers

This doc is stale when any path in `stale_when_paths_change` has changed since
`source_commit: c138af8`. Key change signals:

- Any edit to `src/vex-agent/engine/compact-jobs/**` — Track 1 or Track 2 logic
- `memory/policy.ts` constant changes (timeouts, retry counts, bridge cycles)
- `engine/checkpoint/prefix.ts` — plan modes or thresholds
- `db/migrations/017_compact_jobs.sql` — schema change
- `vex-app/src/main/agent/compact-worker.ts` — supervisor lifecycle change

## Open questions

- `costUsd: null` is always written at `markCompleted` (PR3 deferred). When
  cost telemetry is implemented, the `inference_completed_at` and
  `cost_usd` columns in `compact_jobs` will carry data — verify the
  `CompactionChip` in Z8 is wired to surface it.
- `chunksRejectedByRedaction` is always written as 0 (schema column preserved
  for a future redaction-threshold drop policy). No open finding yet.
- Track 2 uses the same `AGENT_MODEL` as the in-turn inference — if a future
  per-session model is introduced (currently ruled out by ADR-0001), the
  chunker model selection will need a separate decision.
