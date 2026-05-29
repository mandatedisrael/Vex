---
id: FLOW-wake-resume
kind: flow
paths:
  - src/vex-agent/tools/internal/loop-defer.ts
  - src/vex-agent/engine/wake/executor.ts
  - vex-app/src/main/agent/wake-worker.ts
  - vex-app/src/main/database/wake-db.ts
  - vex-app/src/main/index.ts
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change:
  - src/vex-agent/tools/internal/loop-defer.ts
  - src/vex-agent/engine/wake/**
  - src/vex-agent/engine/core/resume.ts
  - vex-app/src/main/agent/wake-worker.ts
  - vex-app/src/main/database/wake-db.ts
  - vex-app/src/main/index.ts
  - src/vex-agent/db/migrations/**
related:
  - module.vex-app.main-agent-bridge
  - module.vex-app.main-bootstrap-lifecycle
  - module.vex-app.main-database-migrations
  - module.vex-app.main-ipc-engine-orchestration
  - module.vex-agent.engine-wake-subagents-prompts
  - module.vex-agent.engine-mission
  - module.vex-agent.engine-runner
  - module.vex-agent.inference
  - fix-plan.F2
  - ADR-0001-global-model-session-wallet
---

# FLOW-wake-resume: Mission self-defer (`loop_defer`) → wake worker → resume

## Trigger
A mission runner calls the internal `loop_defer` tool to sleep itself until a future timestamp (mission self-pacing). Mission run status flips from `running` to `paused_wake`.

## Preconditions
- Mission run is active (`runs.status='running'`).
- Local Postgres reachable; `loop_wake_requests` table exists (migration applied).
- Vault unlocked AND `process.env.OPENROUTER_API_KEY && AGENT_MODEL` resolved — wake executor pre-claim gate (F2) refuses to claim otherwise.

## Steps

| # | caller (file:line symbol) | callee | state change | persistence / event | failure mode |
|---|---------------------------|--------|--------------|---------------------|---------------|
| 1 | engine turn loop calls internal `loop_defer({reason, defer_until})` | `src/vex-agent/tools/internal/loop-defer.ts:62 handleLoopDefer` | inserts row into `loop_wake_requests(run_id, fire_at, reason)`; engine transitions run to `paused_wake`; releases lease | row insert; row update `runs.status='paused_wake'`; transcript appendMessage("Deferred until …") | invalid `defer_until` format |
| 2 | Electron main boot (`vex-app/src/main/index.ts:143`) ran `setupWakeWorker()` at startup; supervisor ticks every 30s | `vex-app/src/main/agent/wake-worker.ts setupWakeWorker` | supervisor probes `loop_wake_requests` schema via `wake-db.ts probeLoopWakeReady()` (uses `to_regclass`) | none | DB not ready → supervisor delays start (idempotent retry) |
| 3 | each supervisor tick (when schema present): dynamic-import `@vex-agent/engine/wake/executor.js startWakeExecutor`, call `tick()` | `src/vex-agent/engine/wake/executor.ts:83 startWakeExecutor` / per-tick callback | none yet | none | none |
| 4 | **F2 pre-claim gate** inside executor `tick()` — invokes injected `deps.isProviderReady()` (default = `isWakeProviderConfigured()` checks both `OPENROUTER_API_KEY && AGENT_MODEL`) | if false → return `[]` immediately (no destructive claim) | none | none | provider not configured → silent skip; row stays |
| 5 | gate passes → `claimDue()` does `SELECT … FOR UPDATE SKIP LOCKED` on due rows | engine claims `loop_wake_requests` row + claims the run lease | row update (lease holder, fire_at_claimed); run still `paused_wake` until resume | row update | lease conflict → row skipped |
| 6 | executor injects a wake banner into transcript, calls `resumeMissionRun` | engine resumes turn loop from where it was deferred (`src/vex-agent/engine/core/resume.ts`) | run status `running`; transcript append wake banner + assistant turn | row updates; transcript event; control-state event (F5 RESOLVED (Bundle B) — now bridged via `onControlState` preload method → renderer `useControlStateLiveSync` pushes runtime status live) | provider failure during resume → `paused_error` |
| 7 | turn loop continues until next stop condition (`loop_defer` again, finalize, approval gate, compaction pressure) | same as FLOW-chat-turn / FLOW-mission-start | as before | as before | as before |
| 8 | app quit: `vex-app/src/main/index.ts` drains compact + wake workers via `Promise.allSettled` BEFORE Postgres teardown | workers' `stop()` is idempotent; rejected stops are logged | none | log line | none |

## Invariants
- F2 pre-claim provider gate MUST live **inside** the executor's `tick()` (NOT only in supervisor) because `claimDue()` is destructive; supervisor gate alone would still let a row be consumed and never resumed if provider is unconfigured.
- Gate checks BOTH env vars: `OPENROUTER_API_KEY && AGENT_MODEL`, mirroring the compact executor's gate.
- Wake worker MUST be started AFTER `loadProviderDotenv()` runs in main boot (F1 ordering).
- Wake worker MUST drain before Compose/Postgres teardown on quit; otherwise an in-flight resume can hit a dead DB.
- `SELECT … FOR UPDATE SKIP LOCKED` is the only safe claim form; no double-claim possible across processes/instances.
- ADR-0001: wake resumes the global model, no `sessions.model_id` lookup.

## Related modules / capabilities
- `module.vex-app.main-agent-bridge` — `CAP-vexapp-worker-supervise-wake`, `CAP-vexapp-worker-gate-wake-provider`
- `module.vex-app.main-bootstrap-lifecycle` — `CAP-vexapp-boot-start-wake-worker`, `CAP-vexapp-quit-drain-workers`
- `module.vex-app.main-database-migrations` — `CAP-vexapp-db-wake-probe-schema`
- `module.vex-agent.engine-wake-subagents-prompts` — wake executor capabilities; subagents intentionally disabled
- `module.vex-agent.engine-runner` — resume capability
- `module.vex-agent.inference` — provider readiness shared with F2 gate

## Known failure modes
- **Vault locked at wake time.** Gate returns false → row sits until next supervisor tick OR until vault is unlocked AND env is re-injected. No data loss; just delayed resume.
- **Provider models API transient failure.** Same handling as FLOW-chat-turn — resume can fail with `paused_error`; `/mission continue` recovers when provider returns.
- **Schema not yet present.** Supervisor uses `to_regclass('public.loop_wake_requests')` to gate startup; never errors loudly on a fresh install pre-migration.
- **Crash mid-resume.** Lease and fire_at_claimed timestamps allow recovery on next boot — uncommitted resume's row claim expires; another tick picks it up safely.
- **F5 RESOLVED (Bundle B).** Wake-driven runtime status changes (paused_wake → running → done) ARE now pushed live to renderer: the control-state event is bridged through the `onControlState` preload method and the renderer `useControlStateLiveSync(sessionId)` hook invalidates `runtimeKeys.state` + `approvalsKeys.pending` on each event (with a 30s runtime-state fallback interval). Push is primary; because the emit is post-commit (on lease release) and can be dropped at the preload Zod gate or fire before the renderer subscribes, the `ApprovalsRegion` 5s `refetchInterval` is retained as a fast fallback. Transcript content (wake banner + assistant turn) still refreshes via the transcript live-sync.
