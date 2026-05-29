---
id: module.vex-app.main-agent-bridge
kind: module
paths:
  - "vex-app/src/main/agent/**"
  - "vex-app/src/main/support/agent-bug-report-sink.ts"
  - "vex-app/src/main/support/bug-report-service.ts"
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change:
  - "vex-app/src/main/agent/**"
  - "vex-app/src/main/support/agent-bug-report-sink.ts"
  - "vex-app/src/main/support/bug-report-service.ts"
  - "vex-app/src/main/lifecycle/broadcast.ts"
  - "vex-app/src/main/database/compaction-db.ts"
  - "vex-app/src/main/database/wake-db.ts"
  - "vex-app/src/main/ipc/register-all.ts"
  - "vex-app/src/main/index.ts"
  - "src/vex-agent/engine/runtime/control-bus.ts"
  - "src/vex-agent/engine/events/transcript-bus.ts"
  - "src/vex-agent/engine/events/stream-bus.ts"
  - "src/vex-agent/engine/compact-jobs/executor.ts"
  - "src/vex-agent/engine/compact-jobs/chunker-call.ts"
  - "src/vex-agent/engine/wake/executor.ts"
related:
  - module.vex-app.main-bootstrap-lifecycle
  - module.vex-app.preload-shared-contracts
  - module.vex-agent.engine-runtime-events
  - module.vex-agent.engine-wake-subagents-prompts
  - module.vex-agent.engine-compact
  - fix-plan.F2
---

# vex-app Main-Process Agent Bridge + Background Workers

## Purpose

Bridges the in-process engine's event buses and background executors to the renderer and lifecycle management. Main-process agent integration owns three responsibilities:

1. **Event bridges** — subscribe engine event buses (transcript, control, stream) to `broadcastToAllWindows()` so renderer receives typed, re-validated refresh signals and ephemeral previews.
2. **Background supervisors** — own the compact-jobs Track-2 executor and wake executor so enqueued jobs and deferred wakes actually process into the session DB instead of remaining pending forever.
3. **Bug-report sink** — mount the production `BugReportSink` at boot to capture automatic engine-side failures into the local bug-report database.

## Retrieval keywords

- transcript-bridge, stream-bridge, control-bridge
- setupCompactWorker, setupWakeWorker, supervisor, executor
- isWakeProviderConfigured, pre-claim gate, provider config
- F2, F5, wake executor, compact executor, Track-2 chunker
- BrowserWindow broadcast, BugReportSink, bug-report-service
- transcript-bus, stream-bus, control-bus subscriptions
- orderedQuitCleanup, drain promises

## State owned

- **Bridge subscriptions**: three idempotent unsubscribe handlers returned by setup functions; stored in `globalCleanup` registry.
- **Supervisor lifecycle**: two timer-based startup supervisors (`compact-worker`, `wake-worker`) with non-reentrant `stop()` async callbacks.
- **In-flight work tracking**: compact supervisor tracks `started` / `stopped` / `inFlightTick` / `handle`; wake supervisor mirrors the same pattern.
- **Bug-report sink**: installed at `setupAgentBridges()` time, reset to noop on teardown.
- **Last-known control snapshot** (optional): control-bridge publishes control-state on every event but does not cache locally (DB is canonical).

## Boundary crossings

**Outbound:**
- Engine event buses (`transcriptEventBus`, `controlStateBus`, `streamDeltaBus` from `@vex-agent/engine/*`) → bridge subscriber → `broadcastToAllWindows(EV.engine.*)` → preload's internal `_dispatch.ts` subscribers → renderer callback.
- Engine compact/wake execution results → supervisor drains on quit → DB state stabilizes before Postgres shutdown.
- Engine-side failures (turn-loop, wake executor, compact executor) → `emitBugReportSafe()` (engine internal) → `BugReportSink` → `createBugReport()` → local SQLite support database.

**Inbound:**
- `broadcastToAllWindows` is called only by bridges; it safely sends to non-destroyed windows only.
- Supervisors reach into engine via narrow dynamic imports (`import("@vex-agent/engine/compact-jobs/executor.js")`, `import("@vex-agent/engine/wake/executor.js")`) to avoid pulling the full runner graph at link time.

**Never allowed:**
- Renderer must not import or instantiate bridges; bridges are main-process-only orchestrators.
- Renderer must not subscribe engine buses directly; bridges are the exclusive subscription site.

## File map

| Path | Line | Symbol | Purpose |
|------|------|--------|---------|
| `vex-app/src/main/agent/index.ts` | 24 | `setupAgentBridges()` | Single entry point: mounts all bridges + bug-report sink; returns unified teardown. Called once in `registerAllIpcHandlers()` flow. |
| `vex-app/src/main/agent/transcript-bridge.ts` | 44 | `setupTranscriptBridge()` | Subscribes `transcriptEventBus`; re-validates each `TranscriptAppendEvent` through shared Zod schema; broadcasts via `EV.engine.transcriptAppend`. Drops malformed payloads + logs. |
| `vex-app/src/main/agent/stream-bridge.ts` | 114 | `setupStreamBridge()` | Subscribes `streamDeltaBus`; maps raw engine deltas to sanitized renderer shape (drops `argsDelta` fragments, replaces raw error text); re-validates; broadcasts via `EV.engine.streamDelta`. Puzzle 9-2 addition. |
| `vex-app/src/main/agent/stream-bridge.ts` | 51 | `toRendererStreamDelta()` | Pure mapper function — converts engine stream event to renderer-facing shape with sanitization. Drops tool-call arg fragments and provider error text. Returns `null` for unmappable events (dropped). |
| `vex-app/src/main/agent/control-bridge.ts` | 23 | `setupControlBridge()` | Subscribes `controlStateBus`; re-validates each `ControlStateEvent` through shared Zod schema; broadcasts via `EV.engine.controlState`. Puzzle 3 (runtime control transitions). |
| `vex-app/src/main/agent/compact-worker.ts` | 62 | `setupCompactWorker()` | Supervisor for Track-2 compaction executor. Polls every 30s until DB + `compact_jobs` schema ready; starts executor ONCE; returns idempotent async `stop()` for ordered quit cleanup. Injected deps allow test override. |
| `vex-app/src/main/agent/wake-worker.ts` | 62 | `setupWakeWorker()` | Supervisor for wake executor. Mirrors compact-worker pattern: polls every 30s until DB + `loop_wake_requests` schema ready; starts executor ONCE; executor self-gates on provider config (OPENROUTER_API_KEY + AGENT_MODEL in env). Returns idempotent `stop()`. |
| `vex-app/src/main/support/agent-bug-report-sink.ts` | 39 | `createAgentBugReportSink()` | Factory for production `BugReportSink`. Installed at boot by `setupAgentBridges()`, unmounted on teardown. Runs engine-side failures through rate limiter + `createBugReport()` transport. Failures are silent (no engine side effects). |
| `vex-app/src/main/support/bug-report-service.ts` | — | `createBugReport()` | Persists bug report to local SQLite support database. Called by transcript-bridge (validation drops), stream-bridge (mapping failures), control-bridge (validation drops), and agent-bug-report-sink (automatic engine failures). |
| `vex-app/src/main/lifecycle/broadcast.ts` | 16 | `broadcastToAllWindows()` | Sends IPC event to all non-destroyed BrowserWindows. Guards against destroyed-window throws; used by bridges and other main-process event emitters (Docker, Compose, migrations). |

## Key types & invariants

### Subscription lifecycle (bridges)
- **Idempotent**: calling `setupTranscriptBridge()` (or stream, control) multiple times creates multiple independent subscriptions. In practice called once at boot.
- **Cleanup**: returned `() => void` unsubscribes from the engine bus and must be registered in `globalCleanup` to ensure teardown.
- **Defense-in-depth validation**: engine type-checks the emit shape → bridge re-validates with `.safeParse().strict()` → preload re-validates on receive (third layer).
- **Misbehaving listener isolation**: if a bridge callback throws, the event bus's `Set<listener>` iteration continues (other subscribers unaffected).

### Supervisor lifecycle (workers)
- **Non-reentrant startup**: `started` + `stopped` flags prevent race conditions during async probes; re-checks after each await.
- **Single executor instance**: once the executor starts, the supervisor clears its timer and lets the executor self-schedule (compact: 5000ms default; wake: hardcoded 2000ms).
- **Race-safe shutdown**: `stop()` awaits any in-flight startup tick; if `startExecutor()` completes AFTER `stop()` is called, the executor is immediately torn down (stopped flag re-checked before storing handle).
- **Idempotent stop**: calling `stop()` twice is safe; second call finds `stopped=true` and returns immediately.
- **Ordered quit semantics**: both `stopCompactWorker()` and `stopWakeWorker()` are awaited sequentially BEFORE `cleanupOnQuit()` (which stops Compose and closes Postgres).

### Wake executor pre-claim gate
- **Location**: engine's `src/vex-agent/engine/wake/executor.ts:307` function `isWakeProviderConfigured()`.
- **Check**: `process.env.OPENROUTER_API_KEY && process.env.AGENT_MODEL`.
- **Timing**: checked BEFORE every `claimDue()` tick. If false, executor returns early without claiming pending rows.
- **Data safety**: `claimDue()` is destructive (flips pending→consumed); claiming without provider config would burn the retry budget prematurely. The gate prevents this.
- **Unlock path**: vault injects secrets into `process.env` on unlock; provider env (from `loadProviderDotenv()`) loads at boot; both must be in place.

### Compact executor provider gate
- **Location**: engine's `src/vex-agent/engine/compact-jobs/executor.ts:104` inline check.
- **Check**: `process.env.OPENROUTER_API_KEY && process.env.AGENT_MODEL`.
- **Granularity**: per-tick. Warning rate-limited per executor instance (one log per missing-config streak, reset on recovery).
- **Implication**: if provider config is absent, the executor stays idle and logs a warning every poll interval (5000ms default).

### Compact chunker provider usage
- **Location**: `src/vex-agent/engine/compact-jobs/chunker-call.ts:64` dynamic import.
- **Issue flagged for audit (Round 1)**: `new OpenRouterProvider()` is constructed directly in the chunker instead of using the centralized inference registry singleton. This bypasses any future provider deduplication, pooling, or accounting logic that might exist in the registry.
- **Current impact**: minimal (single-instance context, no registry singleton yet); future changes to provider lifecycle should surface this call.

## Capabilities (stable IDs)

- `CAP-vexapp-bridge-publish-transcript` — transcript-bridge: subscribe `transcriptEventBus`, re-validate, broadcast `EV.engine.transcriptAppend`.
- `CAP-vexapp-bridge-publish-stream` — stream-bridge: subscribe `streamDeltaBus`, sanitize (drop `argsDelta`, safe error text), broadcast `EV.engine.streamDelta`.
- `CAP-vexapp-bridge-publish-controlState` — control-bridge: subscribe `controlStateBus`, re-validate, broadcast `EV.engine.controlState`.
- `CAP-vexapp-bridge-setup-all` — `setupAgentBridges()`: unified entry point that mounts transcript, stream, control, and bug-report-sink in one call.
- `CAP-vexapp-worker-supervise-compact` — compact-worker supervisor: poll until DB ready, start executor ONCE, drain before quit.
- `CAP-vexapp-worker-supervise-wake` — wake-worker supervisor: poll until DB ready, start executor ONCE, drain before quit.
- `CAP-vexapp-worker-gate-wake-provider` — wake executor's pre-claim gate: `isWakeProviderConfigured()` blocks `claimDue()` until OPENROUTER_API_KEY + AGENT_MODEL in env.
- `CAP-vexapp-worker-gate-compact-provider` — compact executor per-tick gate: skip claim if OPENROUTER_API_KEY + AGENT_MODEL missing (rate-limited warning).
- `CAP-vexapp-sink-bug-report-automatic` — `createAgentBugReportSink()`: mount production sink; engine failures flow through rate limiter → local SQLite storage.

## Public API (consumed by)

### Callers
- `vex-app/src/main/ipc/register-all.ts:96` — calls `setupAgentBridges()` and pushes teardown into `globalCleanup`.
- `vex-app/src/main/index.ts:136, 143` — calls `setupCompactWorker()` and `setupWakeWorker()` after `registerAllIpcHandlers()`.
- `vex-app/src/main/index.ts:152–162` — sequences both worker `stop()` callbacks through `makeOrderedQuitCleanup()` BEFORE compose/Postgres teardown.

### Event listeners (preload/renderer)
- `vex-app/src/preload/agent/engine.ts:17–20` — exposes `vex.engine.onTranscriptAppend()`, `vex.engine.onStreamDelta()`, and `vex.engine.onControlState()` (F5 RESOLVED (Bundle B): `onControlState` now bridged, re-validating each payload via `controlStateEventSchema` at the third layer).
- Renderer hooks via TanStack Query and real-time invalidation on `EV.engine.*` signals.

## Internal flow

### Transcript bridge flow
```
transcriptEventBus (engine) →
  subscribe listener in setupTranscriptBridge() →
    on emit: safeParse(event) via transcriptAppendEventSchema →
      if !success: drop + log warning + backfill bug report (soft fail) →
      if success: broadcastToAllWindows(EV.engine.transcriptAppend, parsed.data) →
        main process IPC dispatch →
          preload _dispatch.ts subscriber re-validates + calls renderer callback →
            renderer invalidates TanStack Query cache →
              refetch messages.getTail (DB row is canonical)
```

### Stream bridge flow (sanitization path)
```
streamDeltaBus (engine) →
  subscribe listener in setupStreamBridge() →
    on emit: toRendererStreamDelta(event) [pure mapping] →
      if throws or maps to null: drop + log warning →
      if mapped: safeParse(mapped) via streamDeltaEventSchema →
        if !success: drop + log warning →
        if success: broadcastToAllWindows(EV.engine.streamDelta, parsed.data) →
          [same preload/renderer path as transcript]

Sanitization detail: argsDelta stripped (cannot safely redact mid-JSON-stream);
provider error text replaced with generic "Stream error"; only numeric code preserved.
```

### Control bridge flow
```
controlStateBus (engine) →
  subscribe listener in setupControlBridge() →
    on emit: safeParse(event) via controlStateEventSchema →
      if !success: drop + log warning →
      if success: broadcastToAllWindows(EV.engine.controlState, parsed.data) →
        [preload/renderer path — F5 RESOLVED (Bundle B): preload exposes onControlState;
         renderer useControlStateLiveSync invalidates runtimeKeys.state + approvalsKeys.pending]
```

### Compact worker supervisor flow
```
setupCompactWorker() at boot →
  immediate tick + setInterval(tick, 30000ms) →
    each tick:
      ensureDbUrl(correlationId) → check VEX_DB_URL valid →
      probeCompactJobsReady() → check Postgres reachable + schema migrated →
        if !ready: log once, return early →
        if ready + !started: startCompactJobsExecutor() →
          executor runs on 5000ms timer, claims jobs, processes, self-gates on provider config →
          return handle; set started=true; clear interval; return handle →
            (if stop() called during startExecutor await: tear down handle + return)

makeOrderedQuitCleanup() on app quit →
  Promise.allSettled([stopCompactWorker(), stopWakeWorker()]) →
    stopCompactWorker() → stop=true, clearInterval, await inFlightTick, stop(handle) →
      executor drains in-flight work against live DB →
  then cleanupOnQuit() → Compose down, Postgres close
```

### Wake worker supervisor flow
Same pattern as compact worker, but:
- Probes `probeLoopWakeReady()` (checks `loop_wake_requests` schema).
- Executor self-gates on `isWakeProviderConfigured()` (OPENROUTER_API_KEY + AGENT_MODEL).
- Executor hardcoded 2000ms poll interval (not configurable like compact's 5000ms).

### Bug-report sink flow
```
setupAgentBridges() at boot →
  createAgentBugReportSink() → factory returns BugReportSink →
    setBugReportSink(sink) → install into engine global →
      engine-side failures (turn-loop, wake, compact) emit via emitBugReportSafe() →
        sink.emit(input) →
          limiter.tryAdmit({...}) → rate limit per category/sessionId/correlationId →
            if dropped: return (silent) →
            if admitted: createBugReport({...}, {transport, now}) →
              insert into local SQLite support.bug_reports table →
                (failures swallowed — sink must not crash engine)

setupAgentBridges() teardown →
  resetBugReportSink() → restore noop default (test hygiene)
```

## Dependencies

### Main process inbound
- **Electron**: `BrowserWindow`, `contextBridge` (for preload).
- **Root `@vex-agent` imports**: narrow dynamic imports of `compact-jobs/executor.js`, `wake/executor.js` to avoid pulling runner graph.
- **Engine bus singletons**: `transcriptEventBus`, `controlStateBus`, `streamDeltaBus` (imported DIRECTLY from `*-bus.js`, not via barrel).
- **Shared Zod schemas**: `transcriptAppendEventSchema`, `controlStateEventSchema`, `streamDeltaEventSchema`.
- **Root `src/vex-agent` direct imports**: `engine/runtime/control-bus.ts`, `engine/events/transcript-bus.ts`, `engine/events/stream-bus.ts`, `engine/wake/executor.ts`, `engine/compact-jobs/executor.ts`.

### Main process outbound
- **IPC broadcast**: `broadcastToAllWindows()` (own utility).
- **Bug report**: `createBugReport()` from `../support/bug-report-service.ts`.
- **Logging**: `log` from `../logger/index.ts`.
- **DB probes**: `probeCompactJobsReady()`, `probeLoopWakeReady()` from `../database/*.ts`.
- **DB URL resolution**: `ensureEngineDbUrl()` from `../ipc/runtime/_ensure-engine-db-url.js`.

### Preload inbound (events only)
- Preload's `_dispatch.ts` `subscribe()` helper receives `ipcRenderer.on()` listener registration from main's `broadcastToAllWindows()`.
- Preload re-validates every payload through Zod before calling renderer callback.

## Cross-references

- **ADR-0001-global-model-session-wallet**: global model, per-session wallet. Wake and compact executor gates depend on global `AGENT_MODEL` in env.
- **module.vex-agent.engine-runtime-events**: source of `transcriptEventBus`, `controlStateBus`, `streamDeltaBus` subscribed by bridges.
- **module.vex-agent.engine-wake-subagents-prompts**: source of wake executor (`WakeExecutorHandle`, `startWakeExecutor()`).
- **module.vex-agent.engine-compact**: source of compact executor (`CompactJobsExecutorHandle`, `startCompactJobsExecutor()`).
- **module.vex-app.preload-shared-contracts**: preload's `_dispatch.ts` and `engine.ts` that expose `onTranscriptAppend()`, `onStreamDelta()` to renderer.
- **module.vex-app.main-bootstrap-lifecycle**: `registerAllIpcHandlers()`, `globalCleanup` registry, `makeOrderedQuitCleanup()`.
- **fix-plan.F2**: wake worker implementation shipped in 97c2c9c.

## Refresh triggers

This module is stale if:

1. Changes to `vex-app/src/main/agent/**` (bridge or supervisor files).
2. Changes to `vex-app/src/main/support/agent-bug-report-sink.ts` or `bug-report-service.ts`.
3. Changes to engine bus structures: `src/vex-agent/engine/runtime/control-bus.ts`, `src/vex-agent/engine/events/transcript-bus.ts`, `src/vex-agent/engine/events/stream-bus.ts`.
4. Changes to executor signatures: `src/vex-agent/engine/compact-jobs/executor.ts`, `src/vex-agent/engine/wake/executor.ts` (especially pre-claim gates, lifecycle).
5. Changes to `vex-app/src/main/index.ts` (order of operations, cleanup sequencing).
6. Changes to `vex-app/src/main/ipc/register-all.ts` (where `setupAgentBridges()` is wired).
7. Changes to `vex-app/src/main/lifecycle/broadcast.ts` (which all bridges use).
8. Changes to DB schema probes: `vex-app/src/main/database/compaction-db.ts`, `vex-app/src/main/database/wake-db.ts`.
9. Changes to preload's engine bridge (`vex-app/src/preload/agent/engine.ts`) that add/remove event methods.

## Open questions

### F5 gap — control-state not exposed to preload — RESOLVED (Bundle B)
- **Status**: RESOLVED (commit 85ed941). Codex GREEN LIGHT (plan + final review).
- **Main**: `vex-app/src/main/agent/control-bridge.ts:33` broadcasts `EV.engine.controlState` via `broadcastToAllWindows()` (unchanged).
- **Preload**: `vex-app/src/preload/agent/engine.ts` now adds `onControlState: (cb) => subscribe(EV.engine.controlState, controlStateEventSchema, cb)` (+ the method on `EngineEventsBridge`), re-validating each payload at the third layer.
- **Renderer**: `useControlStateLiveSync(sessionId)` (`renderer/lib/api/runtime.ts`), mounted in `SessionPanel`, invalidates `runtimeKeys.state` + `approvalsKeys.pending` per event with a 30s runtime fallback. `ApprovalsRegion` retains its 5s poll as a fast fallback (the emit is post-commit on lease release, not in the approval transaction).

### Compact executor's direct OpenRouter construction
- **Status**: Round-4 Codex verdict = confirmed-by-design (acceptable today).
- **Question**: `src/vex-agent/engine/compact-jobs/chunker-call.ts:64` constructs `new OpenRouterProvider()` directly instead of going through a provider registry singleton.
- **Why it matters**: if inference provider management moves to a registry with pooling, caching, or usage accounting, the compact executor will bypass that logic. `resetProvider()` does NOT affect an in-flight chunker call; per-job fresh construction picks up current env on the next tick.
- **Evidence**: line 64, `const provider = new OpenRouterProvider();` (no registry lookup).
- **Mitigation**: mark as FINDING for future refactor if registry is introduced.

### Wake executor provider gate timing
- **Question**: is the provider gate checked per-tick (before claiming) or once at startup?
- **Answer**: PER-TICK. `src/vex-agent/engine/wake/executor.ts:96` calls `isWakeProviderConfigured()` inside the loop, before every `claimDue()`.
- **Implication**: if vault is unlocked mid-run, the wake executor resumes work immediately on the next tick (no restart needed).

### Stream bridge ephemeral semantics
- **Question**: are stream deltas persisted or preview-only?
- **Answer**: PREVIEW-ONLY, ephemeral. `src/vex-agent/engine/events/stream-bus.ts` is signal-only; the canonical persisted message is written by the turn-loop and delivered via `transcriptAppend`.
- **Implication**: renderer must not rely on stream-delta ordering or completeness; it's optimization fuel for streaming text/tool-call progress, not a durable record.

### Are bridge subscriptions cleaned up on hot-reload?
- **Question**: if the app reloads without quitting (e.g. dev HMR), do bridges unsubscribe?
- **Answer**: depends on hot-reload implementation. In production (no reload), bridges live for the app's lifetime and are cleaned up by `globalCleanup` on quit.
- **Risk**: if a hot-reload path forgets to await `teardowns` before re-mounting bridges, subscriptions leak (multiple listeners per event).

### Compact worker claim-loss cancellation flag
- **Question**: what happens if a heartbeat reports the worker lost ownership mid-job?
- **Answer**: `src/vex-agent/engine/compact-jobs/executor.ts:163` sets `claimLost=true`. Checked between expensive stages (archive load, chunker call, embeddings). If true, `processJob()` returns early without marking complete/failed (row stays running + owned by the replacement worker).
- **Implication**: no duplicate Track-2 output; cost control; correctness preserved by heartbeat race-safe ownership checks.
