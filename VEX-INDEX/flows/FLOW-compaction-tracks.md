---
id: FLOW-compaction-tracks
kind: flow
paths:
  - src/vex-agent/engine/compact-jobs/service.ts
  - src/vex-agent/engine/compact-jobs/executor.ts
  - src/vex-agent/engine/compact-jobs/chunker-call.ts
  - src/vex-agent/tools/internal/compact/now.ts
  - vex-app/src/main/agent/compact-worker.ts
  - vex-app/src/main/index.ts
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change:
  - src/vex-agent/engine/compact-jobs/**
  - src/vex-agent/tools/internal/compact/now.ts
  - src/vex-agent/engine/checkpoint/prefix.ts
  - src/vex-agent/engine/core/turn-loop*.ts
  - src/vex-agent/memory/policy.ts
  - src/vex-agent/db/repos/compact-jobs/**
  - src/vex-agent/db/migrations/017_compact_jobs.sql
  - vex-app/src/main/agent/compact-worker.ts
  - vex-app/src/main/index.ts
related:
  - module.vex-app.main-agent-bridge
  - module.vex-app.main-bootstrap-lifecycle
  - module.vex-agent.engine-compact
  - module.vex-agent.engine-core
  - module.vex-agent.inference
  - module.vex-agent.data-memory-knowledge
---

# FLOW-compaction-tracks: Two-track compaction (Track 1 sync atomic + Track 2 async chunker)

## Trigger
Engine reaches context pressure during turn loop. The turn-loop's compact-gate decides Track 1 must run now. Alternatively, user invokes `/compact now` slash → internal tool `compact/now.ts` triggers Track 1 explicitly.

## Preconditions
- Postgres reachable; `compact_jobs` table present (migration 017).
- Track 2 needs `OPENROUTER_API_KEY && AGENT_MODEL` to actually chunk; Track 1 does NOT.
- ADR-0001 holds: model is global; no per-session model.

## Steps

| # | caller (file:line symbol) | callee | state change | persistence / event | failure mode |
|---|---------------------------|--------|--------------|---------------------|---------------|
| 1 | turn loop pressure check OR `/compact now` | `src/vex-agent/engine/compact-jobs/service.ts:64 executeCompactNow` | begin DB transaction | none | none |
| 2 | Track 1 INSIDE the transaction: build prefix summary, archive transcript prefix, enqueue Track 2 job row | service writes prefix checkpoint, archives, inserts `compact_jobs` row, COMMITs | row inserts (`compact_checkpoints`, `compact_jobs`); messages archived | commit may fail → transaction rolls back; turn loop sees error | rollback (no partial state) |
| 3 | Track 1 returns synchronously; turn loop continues with compacted context | engine appends synthetic recap message; control-state event | row updates; transcript appendMessage | F5 RESOLVED (Bundle B): control-state event now bridged to renderer (`onControlState` preload + `useControlStateLiveSync`), but it invalidates runtime-state + approvals — NOT compaction history (that uses `useCompactionLiveSync` transcript invalidation) |
| 4 | Electron main boot started `setupCompactWorker()` (`vex-app/src/main/index.ts:136`) → supervisor `vex-app/src/main/agent/compact-worker.ts` ticks every 30s | dynamic-import `@vex-agent/engine/compact-jobs/executor.js startCompactJobsExecutor` and call tick() | none | none | DB not ready → supervisor delays |
| 5 | Track 2 executor `src/vex-agent/engine/compact-jobs/executor.ts:64 startCompactJobsExecutor` | provider gate (`OPENROUTER_API_KEY && AGENT_MODEL`) check; if missing → skip tick | none | none | provider missing → silent skip; job stays |
| 6 | gate passes → polls `compact_jobs` for due rows (FOR UPDATE SKIP LOCKED), claims one | row update (claim) | none | claim contention → skipped |
| 7 | executor calls Track-2 chunker `compact-jobs/chunker-call.ts:64` — directly constructs `OpenRouterProvider` (Round-1 finding, Codex-confirmed by-design: bypasses inference registry singleton/reset path) | OpenRouter chunker generates structured chunks from archived prefix | none | API failure → row marked failed, retry budget exhausts |
| 8 | executor embeds chunks (calls embedding service — see local services contract; bundled is llama.cpp on `127.0.0.1:55134/v1`, dim 768) | embedding rows produced | none | embedding service unreachable → fail row, retry later |
| 9 | executor writes `session_memories` rows (one per chunk) + marks `compact_jobs.status='completed'` | DB rows inserted; row update | row inserts; row update | partial write → retry-safe by job id |
| 10 | app quit: drain compact worker BEFORE Postgres teardown (`vex-app/src/main/index.ts:151–163` Promise.allSettled) | worker `stop()` is idempotent; rejected stops logged | none | log line | none |

## Invariants
- **Track 1 atomicity.** Summary + archive + enqueue happen in a single transaction; either all or none persist.
- **Track 2 non-blocking.** Track 2 failure NEVER rolls back Track 1; Track 1 protects the live context window even if chunking is down.
- **Track 2 provider gate is per-tick.** Missing key/model → silent skip (no destructive claim).
- **Track-2 chunker direct-construct.** `chunker-call.ts` instantiates `OpenRouterProvider` directly, bypassing `inference/registry.ts` singleton/reset path. This is a Round-1 finding to track (no pooling/accounting, and `resetProvider()` does not affect in-flight Track 2 calls).
- Track 1 turns loop on the SAME engine context — compaction does not stop the turn; it changes the context view going forward.
- ADR-0001: chunker uses global model from env.

## Related modules / capabilities
- `module.vex-app.main-agent-bridge` — `CAP-vexapp-worker-supervise-compact`
- `module.vex-app.main-bootstrap-lifecycle` — `CAP-vexapp-boot-start-compact-worker`, `CAP-vexapp-quit-drain-workers`
- `module.vex-agent.engine-compact` — Track-1/Track-2 separation invariant + 15 CAPs documented
- `module.vex-agent.engine-core` — turn loop pressure check
- `module.vex-agent.inference` — provider readiness; Track-2 chunker singleton-bypass finding
- `module.vex-agent.data-memory-knowledge` — `compact_jobs` migration 017, `session_memories` schema, `compact_checkpoints`

## Known failure modes
- **OpenRouter chunker outage.** Track 2 job stays pending until budget exhausts; live context still works because Track 1 already trimmed.
- **Embedding service down.** Same as above; chunks land without embeddings if retry path tolerates that (verify), otherwise job fails.
- **Stale Track-2 provider after vault re-key.** Because chunker bypasses registry, `resetProvider()` from onboarding/provider persist does NOT replace the in-flight Track-2 provider instance. Mitigation: Track-2 instance is per-job-tick, so next tick gets a fresh construct from current env. Document explicitly.
- **F5 RESOLVED (Bundle B).** The control-state event is now bridged to the renderer (`onControlState` preload method + `useControlStateLiveSync`), but it invalidates runtime-state + approvals queries only — it does NOT push compaction-history transitions. Compaction-history transitions (Track 1 completes; Track 2 finishes) still reach the UI via the compaction history view's own transcript-driven invalidation (`useCompactionLiveSync`) over TanStack query, not via controlState.
