---
id: boundary.database-contracts
kind: boundary
paths:
  - src/vex-agent/db/**
  - vex-app/src/main/database/**
  - vex-app/resources/migrations/**
  - vex-app/scripts/copy-migrations.mjs
  - vex-app/scripts/check-build-artifacts.mjs
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - src/vex-agent/db/**
  - vex-app/src/main/database/**
  - vex-app/resources/migrations/**
  - vex-app/scripts/copy-migrations.mjs
  - vex-app/scripts/check-build-artifacts.mjs
  - vex-app/src/main/ipc/{database,memory,knowledge,messages,compaction,usage}.ts
related:
  - module.vex-app.main-database-migrations
  - module.vex-app.main-docker-compose-onboarding
  - module.vex-app.main-bootstrap-lifecycle
  - module.vex-agent.data-memory-knowledge
  - module.src-root.lib-db-utilities
  - ADR-0001-global-model-session-wallet
---

# boundary.database-contracts — Engine pool vs main raw `pg` layer

## Two clients, one database

The Vex desktop app runs a single local Postgres (pgvector) instance. Two distinct DB clients connect to it:

| Layer | Path | Connection model |
|---|---|---|
| Engine | `src/vex-agent/db/client.ts` | shared `pg.Pool` instance owned by engine; typed repos in `src/vex-agent/db/repos/**` |
| Main app | `vex-app/src/main/database/*.ts` | raw `pg.Client` per call (no shared pool documented); separate connection-state machine |

This is deliberate. Engine owns the canonical schema and the write paths. Main owns lifecycle (Docker/compose state) and a parallel read-oriented layer used by IPC handlers (memory, knowledge, messages, usage, approvals, compaction status, bug reports, sessions, missions, wake schema probe).

## Schema source of truth

- Canonical migrations: `src/vex-agent/db/migrations/`.
- Schema version: **027** (latest applied as of `cf05003`).
- SQL file count: **24** (gaps at 007 / 008 / 012 are intentional, predate `cf05003`).
- App-packaged mirror: `vex-app/resources/migrations/` — must match canonical bytes; synced by `vex-app/scripts/copy-migrations.mjs`; release-critical (verified by `vex-app/scripts/check-build-artifacts.mjs`).
- Migration runner: `vex-app/src/main/database/migrate-runner.ts` (uses `lib/db/migrate-runner` semantics from root). Idempotent via `schema_version` table.

## Contract: shared SQL + shared schemas

- The two clients agree by virtue of pointing at the same DB. There is no ORM bridging.
- Column / row contract changes MUST update:
  1. canonical migration in `src/vex-agent/db/migrations/`,
  2. engine repos in `src/vex-agent/db/repos/**`,
  3. main raw queries in `vex-app/src/main/database/*.ts` that hit the affected columns,
  4. mirror in `vex-app/resources/migrations/`,
  5. shared schema if shape leaves the DB to renderer.
- Failing to update any of these is the primary drift risk on this boundary.

## Key DB facts (Round 1 + Round 3 verification)

- `sessions` has NO `model_id` column (ADR-0001 — model is global).
- `sessions` HAS wallet selection fields (mig026): EVM wallet id+address, Solana wallet id+address.
- `loop_wake_requests` schema is gated by a `to_regclass('public.loop_wake_requests')` probe (`vex-app/src/main/database/wake-db.ts probeLoopWakeReady`) — wake worker won't start until schema is present.
- `compact_jobs` migration 017 owns the Track-2 queue.
- `inbox_events` HAS a repo in `src/vex-agent/db/repos/inbox.ts` (older notes that said "no repo" are obsolete).
- Vector columns have no `vector(n)` typmod. Recall filters by `embedding_model` + `embedding_dim` (currently 768 from bundled llama.cpp).
- `dim-lock` invariant (`vex-app/src/main/database/dim-lock.ts`) enforces consistent embedding dim across stored vectors.

## Crossing rules

- Renderer NEVER touches the DB directly. All DB access goes through main IPC (`CH.{memory,knowledge,messages,compaction,usage,sessions,approvals,wallets,...}.*`).
- Main IPC handlers MAY dynamically import engine repos when intentionally documented (e.g. wallet intents, runtime-control, loop-wake, compact-jobs, knowledge status update). All other DB reads go through main's raw `pg` layer.
- Postgres URL: written by `vex-app/src/main/compose/render.ts` + `vex-app/src/main/compose/electron-secret-adapter.ts` (Compose secret); main reads via `vex-app/src/main/database/db-config.ts`. Engine receives the URL via dynamic-import call site or `process.env` if engine reaches `client.ts` after main has set the URL.
- Engine repos and main raw queries MUST both treat sensitive columns (e.g. `tool_calls` JSON, `wallet_address`) as outputs requiring sanitization before crossing IPC.

## Invariants

- One Postgres instance per install; `endpoint-policy.ts` in Docker layer rejects remote contexts.
- Migrations applied serially; partial migrations leave DB in a known-bad state; rollback policy currently relies on user reset (acceptable for local desktop install).
- Migration mirror parity is a release-critical artifact check.
- Engine is the authority on write contracts; main raw queries should read only (with documented exceptions like wake/compact admin).
- Connection teardown on quit: main's `connection-state` disconnects AFTER compact + wake workers drain (see `boundary.process-boundaries` and FLOW-wake-resume).
- ADR-0001: no per-session model column; sessions wallet selection is per-session.

## Open gaps (verify in follow-ups)

- ~~**GAP-Z6-sync-worker**~~ FIXED (Bundle A): `setupSyncWorker()` (`vex-app/src/main/agent/sync-worker.ts`) now drains `protocol_sync_jobs`/`protocol_sync_runs`, gated by `database/sync-db.ts probeProtocolSyncReady()`. Started at boot after wake, drained on quit. No provider gate — sync does public-address network reads (not key access), so it can run pre-unlock (privacy trade-off).
- **Drift risk**: column renames or new sensitive fields in engine repos require matching updates in main raw queries; no automated check enforces parity.
- **Schema gaps 007 / 008 / 012**: intentional, but document the historical reason somewhere durable (suggest fix-plan or comment in migration index).

## Refresh triggers

Any change to: `src/vex-agent/db/**`, `vex-app/src/main/database/**`, `vex-app/resources/migrations/**`, `vex-app/scripts/copy-migrations.mjs`, `vex-app/scripts/check-build-artifacts.mjs`, or IPC handlers reading shared schemas tied to DB columns.

## Cross-references

- `module.vex-agent.data-memory-knowledge` — engine schema and repos (Round 1).
- `module.vex-app.main-database-migrations` — main raw `pg` layer (Round 3).
- `module.src-root.lib-db-utilities` — root `lib/db/migrate-runner` etc.
- `module.vex-app.main-docker-compose-onboarding` — Compose secret + connection URL handoff.
- `boundary.process-boundaries` — DB never crosses to renderer.
- `audits/current/coverage-gaps.md` — `GAP-Z6-sync-worker`.
