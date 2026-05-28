# Fix Plan — F2: wake worker never started (mission autonomous defer→wake dead)

Harness session: `harness-integration-blockers`. Status: revised after Codex BLOCKED #1; re-submitting.

## Goal
Start the engine's wake executor inside vex-app main so `loop_defer`-scheduled `paused_wake` mission
runs actually wake and resume. Today `startWakeExecutor` has zero production call sites → deferred
autonomous missions sleep forever.

## Rules/skills read
CLAUDE.md + rules/{00,10,20,30,60,70,80}; router → `vex-process-boundaries`, `vex-performance-cleanup`
(idempotent cleanup sequenced at quit), `vex-agent-policy`.

## Files inspected
- `src/vex-agent/engine/wake/executor.ts` — `startWakeExecutor(opts) → {stop()}`, poll 2s/batch 10; pure
  `tick(now,limit,deps)`; `buildProductionDeps()`. **No provider self-gate** (unlike compact executor).
- `src/vex-agent/engine/compact-jobs/executor.ts:104` — compact executor's PRE-CLAIM gate:
  `if (!process.env.OPENROUTER_API_KEY || !process.env.AGENT_MODEL) { rate-limited warn; return; }`.
- `vex-app/src/main/agent/compact-worker.ts` + its test — supervisor pattern + lifecycle test to mirror.
- `vex-app/src/main/database/compaction-db.ts` `probeCompactJobsReady` (own pg.Client).
- `vex-app/src/main/lifecycle/ordered-quit-cleanup.ts` `makeOrderedQuitCleanup(stopWorker, quitCleanup)`.
- `src/__tests__/vex-agent/engine/wake/executor.test.ts` — tests the PURE `tick` with injected `WakeDeps`.

## Design (after Codex BLOCKED #1 — gate must be pre-claim, in the executor)
`claimDue()` is DESTRUCTIVE (`pending→consumed`); `resumeMissionRun()` can fail after it. So the
provider/config gate must run EVERY tick BEFORE `claimDue`, in the executor — not only at supervisor
start. This mirrors the compact executor's per-claim self-gate. Supervisor then matches compact exactly
(DB+schema only). Predicate = `OPENROUTER_API_KEY && AGENT_MODEL` (both — provider resolve needs the key,
loadConfig needs the model). `lockSecretSession()` does NOT clear env secrets, so the only real
"absent config" case is pre-first-unlock; the per-tick gate covers it. Broader re-lock semantics are out
of F2 scope. Supervisor concurrency logic is DUPLICATED (Option A) — no shared-supervisor extraction in
this fix (Codex-confirmed).

## Implementation steps
1. `src/vex-agent/engine/wake/executor.ts`:
   - Add `isProviderReady(): boolean` to `WakeDeps`.
   - In `tick()`, FIRST statement: `if (!deps.isProviderReady()) return [];` (pre-claim; no row consumed).
   - Export `isWakeProviderConfigured(): boolean` = `Boolean(process.env.OPENROUTER_API_KEY) && Boolean(process.env.AGENT_MODEL)` (mirrors compact predicate).
   - `buildProductionDeps()`: `isProviderReady: isWakeProviderConfigured`.
2. `vex-app/src/main/database/wake-db.ts` (NEW): `probeLoopWakeReady()` = `to_regclass('public.loop_wake_requests')` via `buildPoolConfig` + `pg.Client` (mirrors compaction-db probe; any failure → false).
3. `vex-app/src/main/agent/wake-worker.ts` (NEW): `setupWakeWorker(deps?) → () => Promise<void>`, a
   near-exact copy of `setupCompactWorker` — supervisor gate = `ensureDbUrl().ok && probeLoopWakeReady()`
   (NO provider check; the executor self-gates). deps: `ensureDbUrl`, `probeReady` (→ probeLoopWakeReady),
   `startExecutor` (→ narrow dynamic `import("@vex-agent/engine/wake/executor.js").startWakeExecutor`),
   `intervalMs`. Same non-reentrant / single-in-flight-tick / stop-drains / stop-during-startup-teardown.
4. `vex-app/src/main/index.ts`: `const stopWakeWorker = setupWakeWorker();` after `setupCompactWorker()`;
   drain BOTH before Postgres teardown AND log rejected stops:
   ```
   makeOrderedQuitCleanup(async () => {
     const results = await Promise.allSettled([stopCompactWorker(), stopWakeWorker()]);
     for (const r of results) if (r.status === "rejected") log.error("[main] worker stop failed during quit", r.reason);
   }, cleanupOnQuit)
   ```

## Verification plan
- `src/__tests__/vex-agent/engine/wake/executor.test.ts` (extend): `makeDeps` defaults `isProviderReady: () => true` (existing tests unchanged); NEW: `tick` with `isProviderReady: () => false` → returns `[]` and `claimDue` NOT called; NEW: `isWakeProviderConfigured()` → true iff BOTH env vars set (test key-absent → false, model-absent → false). (Codex: "claimDue not called when either absent".)
- `vex-app/src/main/agent/__tests__/wake-worker.test.ts` (mirror compact-worker.test.ts): no start until DB+schema ready; starts exactly once; `stop()` idempotent + stops executor; stop-races-start tears down.
- `vex-app/src/main/database/__tests__/wake-db.test.ts` (mirror compaction-db probe test): true when `to_regclass` resolves; false on missing table / connect failure.
- `pnpm --dir vex-app run lint` (tsc + boundary); root source tsc; targeted vitest on all new/changed tests.
- Manual: autonomous mission `loop_defer`s a short wake → resumes after the delay.

## Risks / mitigations
- Pre-claim gate keeps `claimDue` from consuming rows when config absent (Codex #1). Both KEY+MODEL (Codex #2/#4).
- Long-lived 2s poll bounded + idempotent `stop()` sequenced before Postgres teardown (perf-cleanup).
- Duplicated supervisor (~100 lines, Option A) — flagged for later extraction (Codex #3).
- Rejected worker-stop results logged at quit (Codex #5).
- Silent per-tick skip when config absent (no log spam); supervisor's DB-wait already logs once.
- Re-lock-after-unlock: env secrets persist (lock doesn't clear them) so resume still works; broader lock
  semantics out of F2 scope (Codex-confirmed).
