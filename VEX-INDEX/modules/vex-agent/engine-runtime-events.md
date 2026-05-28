---
id: module.vex-agent.engine-runtime-events
kind: module
paths:
  - "src/vex-agent/engine/runtime/**"
  - "src/vex-agent/engine/events/**"
  - "src/vex-agent/engine/checkpoint/prefix.ts"
  - "src/vex-agent/engine/support/bug-report-registry.ts"
  - "src/vex-agent/engine/ingress.ts"
  - "src/vex-agent/engine/runtime-clock.ts"
  - "src/vex-agent/engine/types.ts"
  - "src/vex-agent/engine/index.ts"
source_commit: c138af8
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/vex-agent/engine/runtime/**"
  - "src/vex-agent/engine/events/**"
  - "src/vex-agent/engine/checkpoint/prefix.ts"
  - "src/vex-agent/engine/support/bug-report-registry.ts"
  - "src/vex-agent/engine/ingress.ts"
  - "src/vex-agent/engine/runtime-clock.ts"
  - "src/vex-agent/engine/types.ts"
  - "src/vex-agent/engine/index.ts"
  - "src/vex-agent/db/repos/runner-leases.ts"
  - "src/vex-agent/db/repos/runtime-control-requests.ts"
related:
  - module.vex-agent.engine-core
  - module.vex-agent.engine-runner
  - module.vex-agent.engine-mission
  - module.vex-agent.engine-compact
---

# Engine Runtime & Events

## Purpose

Provides the atomic run-lifecycle primitives (lease claim, status flip, control
observe, lease heartbeat+release), the three in-process event buses that
propagate transcript appends, stream deltas, and control-state transitions to
the vex-app main-process bridge, the single transcript-write entry point
(`appendMessage`), the ingress router for incoming user messages, the runtime
clock snapshot for prompt context, the compaction checkpoint-plan selector, the
injectable bug-report sink, and the engine's public domain types and barrel
export. Everything here is Z1 infrastructure that the core runner and wake/
compact executors build on.

## Retrieval keywords

- lease, runner lease, heartbeat, claimRunLeaseAndFlipToRunning, claimSessionLease
- observeAndApplyControl, pause_after_step, stop_terminal, paused_user
- releaseLeaseAndEmitControlState, release lease, emit control state
- controlStateBus, control bus, ControlStateEvent, runtime control
- transcriptEventBus, transcript bus, TranscriptAppendEvent, transcript append
- streamDeltaBus, stream bus, StreamDeltaEvent, stream delta, streaming
- appendMessage, appendEngineMessage, emitTranscriptAppend, transcript write
- routeUserMessage, submitOperatorInstruction, ingress, message routing
- runtime clock, RuntimeClockSnapshot, buildRuntimeClockPrompt
- selectPrefixWithGiantFallback, checkpoint plan, compaction prefix
- BugReportSink, setBugReportSink, bug report registry
- EngineContext, TurnResult, MissionRunStatus, MISSION_RUN_STATUSES
- SessionKind, Permission, MissionDraft, WalletPolicy, MessageMetadata

## State owned

- **DB tables** (written by this module):
  - `mission_runs` — status column flipped to `running` / `paused_user` / `stopped` by lease helpers
  - `runner_leases` — INSERT/UPSERT/DELETE by claim/release helpers; heartbeat renews `expires_at`
  - `loop_wake_requests` — cancelled (status=`cancelled`) as a side effect of `claimRunLeaseAndFlipToRunning` and `observeAndApplyControl` when previous status was `paused_wake` or a `stop_terminal` is applied
  - `runtime_control_requests` — status flipped `pending→observed→cleared` by `observeAndApplyControl`
  - `messages` + `sessions.message_count` — written atomically by `appendMessage`
- **In-process singletons**:
  - `transcriptEventBus` — `src/vex-agent/engine/events/transcript-bus.ts:98`
  - `streamDeltaBus` — `src/vex-agent/engine/events/stream-bus.ts:114`
  - `controlStateBus` — `src/vex-agent/engine/runtime/control-bus.ts:78`
  - `currentSink: BugReportSink` — `src/vex-agent/engine/support/bug-report-registry.ts:21`

## Boundary crossings

- **DB**: all three atomic lease helpers use `withTransaction` (pg pool) from `@vex-agent/db/client.ts`; `appendMessage` also uses `withTransaction`
- **DB repos** (read-only within this module): `runner-leases.ts` (`acquireLease`, `renewLease`, `releaseLease`, `getLease`), `mission-runs.ts` (`getActiveRunBySession`, `getRun`), `runtime-control-requests.ts` (types only), `loop-wake.ts` (`cancelForSession`), `missions.ts` (`getActiveMission`)
- **vex-app main bridge** subscribes to all three event buses via `setupAgentBridges()` in `vex-app/src/main/agent/index.ts`; the buses are the only cross-module boundary — no IPC call enters this module
- **No network, no wallet/signing, no Docker** — pure in-process + Postgres

## File map

### runtime/

- `src/vex-agent/engine/runtime/control-bus.ts:78 controlStateBus` — `ControlStateBus` singleton; emits `ControlStateEvent` (type, sessionId, missionRunId, runStatus, stopReason, pendingControlKind, leaseActive, leaseExpiresAt, correlationId); misbehaving listener isolated by try/catch
- `src/vex-agent/engine/runtime/lease-and-status.ts` — thin NodeNext ESM shim; re-exports `./lease-and-status/index.js` to preserve the stable import path
- `src/vex-agent/engine/runtime/lease-and-status/_types.ts` — public input/outcome discriminated unions: `ClaimRunInput`, `ClaimRunOutcome`, `ClaimSessionLeaseInput`, `ClaimSessionLeaseOutcome`, `ObserveControlInput`, `ObserveControlOutcome`
- `src/vex-agent/engine/runtime/lease-and-status/_row-shapes.ts` — internal Postgres row interfaces (`MissionRunRow`, `RunnerLeaseRow`, `ControlRequestRow`) + mappers (`mapLease`, `mapControlRequest`); NOT re-exported
- `src/vex-agent/engine/runtime/lease-and-status/claim-run-lease.ts:38 claimRunLeaseAndFlipToRunning` — 7-step atomic tx: lock run FOR UPDATE → validate fromStatuses → lock lease FOR UPDATE → validate lease absent/expired/same-owner → flip status=running + bump last_checkpoint_at → cancel pending wakes **conditional on `previousStatus === "paused_wake"`** (codex acceptance criterion #1) → upsert runner_leases
- `src/vex-agent/engine/runtime/lease-and-status/claim-session-lease.ts:16 claimSessionLease` — atomic per-session lease claim for chat-only (no mission_run_id); same FOR UPDATE guard pattern
- `src/vex-agent/engine/runtime/lease-and-status/observe-and-apply.ts:39 observeAndApplyControl` — atomic: SKIP LOCKED next pending control request → `observed` → lock active run → apply `pause_after_step` (→`paused_user`, wake cleanup if was `paused_wake`) or `stop_terminal` (→`stopped`, wake cancel, DELETE lease) → `cleared`; returns discriminated `ObserveControlOutcome`
- `src/vex-agent/engine/runtime/lease-and-status/index.ts` — barrel; re-exports all types and the three functions
- `src/vex-agent/engine/runtime/lease-handle.ts:69 createLeaseHandle` — wraps a claimed `RunnerLease`; starts heartbeat interval at `ttlMs/3` (min 1 s); `release()` is idempotent; `onLeaseLost` callback fires when renewal returns null (lease stolen); timer + renewFn + releaseFn injectable for tests
- `src/vex-agent/engine/runtime/release-and-emit.ts:41 releaseLeaseAndEmitControlState` — MUST be called in every runner `finally` instead of `handle.release()` directly; releases → re-reads DB state (getRun prefers specific runId, falls back to getActiveRunBySession) → emits `controlStateBus`; read/emit errors swallowed (fail-closed); callers must not branch on outcome

### events/

- `src/vex-agent/engine/events/transcript-bus.ts:98 transcriptEventBus` — `TranscriptEventBus` singleton; emits AFTER DB COMMIT; `TranscriptAppendEvent` carries `{type, sessionId, messageId, role, createdAt, messageType, correlationId}`; misbehaving listener isolated
- `src/vex-agent/engine/events/stream-bus.ts:114 streamDeltaBus` — `StreamDeltaBus` singleton for ephemeral inference stream previews; `StreamDeltaEvent` carries `{type, sessionId, streamId, sequence, deltaType, delta, createdAt, correlationId}`; `toStreamDeltaEvent:152` maps raw `StreamChunk` to engine schema; NEVER persisted
- `src/vex-agent/engine/events/append-transcript.ts:85 appendMessage` — the ONLY event-emitting transcript write; two paths: (1) no external client → own `withTransaction` + emit after COMMIT; (2) external client → storage-only, caller must call `emitTranscriptAppend` after their own COMMIT (prevents "emit without commit" failure)
- `src/vex-agent/engine/events/append-transcript.ts:116 appendEngineMessage` — convenience wrapper; sets role=`"system"` default + routes through `appendMessage`
- `src/vex-agent/engine/events/append-transcript.ts:142 emitTranscriptAppend` — manual emit helper for external-tx callers
- `src/vex-agent/engine/events/index.ts` — barrel; intentionally omits `addMessageReturningId` to avoid pulling storage dependency into bus consumers (vex-app main-process bridge imports transcript-bus directly)

### checkpoint/ + support/

- `src/vex-agent/engine/checkpoint/prefix.ts:54 selectPrefixWithGiantFallback` — given live messages, returns `CheckpointPlan`: `prefix` (pair-preserving archive prefix, cutoff id) | `giant_tool` (single oversized tool row; overflow rows with `metadata.payload.overflow===true` are skipped) | `noop`; constants: `TAIL_WINDOW=10`, `GIANT_TOOL_THRESHOLD=8_000`
- `src/vex-agent/engine/support/bug-report-registry.ts:24 getBugReportSink` / `:29 setBugReportSink` / `:34 resetBugReportSink` — injectable `BugReportSink` registry; default is `noopBugReportSink`; vex-app mounts production sink at `setupAgentBridges()` boot; engine emit sites (`turn-loop-bug-emit.ts`, `compact-jobs/bug-emit.ts`, `wake/executor.ts`, `mission-finalize.ts`) call `getBugReportSink()` via dynamic import

### Top-level engine files

- `src/vex-agent/engine/ingress.ts:43 routeUserMessage` — single user-message entry; cancels any pending wake (`loopWakeRepo.cancelForSession`); dispatches by active run status: `paused_wake` → `resumeMissionRunWithPreempt` (atomic claim + lease handle + resume); `paused_error` → persist interrupt + hint text; `running`/`paused_approval` → persist interrupt (approval flow resumes separately); else → `processAgentTurn` or `processMissionSetupTurn`
- `src/vex-agent/engine/ingress.ts:115 submitOperatorInstruction` — alias for `routeUserMessage`; the public API name consumed by vex-app `ipc/chat.ts`
- `src/vex-agent/engine/ingress.ts:123 resumeMissionRunWithPreempt` — private; uses `claimRunLeaseAndFlipToRunning` (fromStatuses=`["paused_wake"]`) + `createLeaseHandle` + `releaseLeaseAndEmitControlState` in finally; calls `resumeMissionRun` from core/runner
- `src/vex-agent/engine/runtime-clock.ts:49 buildRuntimeClockSnapshot` — pure function; derives `RuntimeClockSnapshot` from now/timezone/sessionStartedAt/missionRunStartedAt/missionDeadline/pendingWake; normalises timezone via `Intl.DateTimeFormat` with UTC fallback
- `src/vex-agent/engine/runtime-clock.ts:74 buildRuntimeClockPrompt` — renders snapshot as a prompt section with time rules for the model
- `src/vex-agent/engine/types.ts:59 MISSION_RUN_STATUSES` — canonical const array (9 statuses); source of truth for status enum; CI drift test pins all mirrors
- `src/vex-agent/engine/types.ts:79–95` — `ACTIVE_RUN_STATUSES`, `PAUSED_RUN_STATUSES`, `TERMINAL_RUN_STATUSES`, `ACTIVE_OR_PAUSED_RUN_STATUSES` — `ReadonlySet` classifiers; engine, repos, ingress, UI all read these sets, NOT literal arrays
- `src/vex-agent/engine/types.ts:239 EngineContext` — passed to runner/turn/prompts; `sessionKind`, `sessionPermission`, `missionId`, `missionRunId`, wallet fields, `walletPolicy`, `loadedDocuments`; **no model field** (ADR-0001: global model)
- `src/vex-agent/engine/index.ts` — public barrel; exports `routeUserMessage`, `submitOperatorInstruction`, all core/runner entry points, approval runtime, wake/compact executors, subagent runner, abort/retry/rewind, and all of `./types.ts`

## Key types & invariants

- `ControlStateEvent` (`src/vex-agent/engine/runtime/control-bus.ts:35`) — bus signal only; DB is source of truth; renderer re-reads `runtime.getState` after invalidation
- `ClaimRunOutcome` (`src/vex-agent/engine/runtime/lease-and-status/_types.ts:31`) — discriminated: `claimed | lease_busy | status_mismatch`; all callers MUST branch on `outcome` before proceeding
- `LeaseHandle` (`src/vex-agent/engine/runtime/lease-handle.ts:30`) — `release()` is idempotent; heartbeat clears on first `release()` call; a stolen lease triggers `onLeaseLost` callback, not an error throw
- `TranscriptAppendEvent` (`src/vex-agent/engine/events/transcript-bus.ts:37`) — emitted AFTER commit only; `messageId` is the DB SERIAL PK; `messageType` mirrors `messages.message_type` (null = plain chat row)
- `StreamDeltaEvent` (`src/vex-agent/engine/events/stream-bus.ts:58`) — ephemeral; never persisted; `streamId` + `sequence` correlate deltas within one turn; `deltaType` always equals `delta.kind`
- `CheckpointPlan` (`src/vex-agent/engine/checkpoint/prefix.ts:26`) — `giant_tool` skips overflow rows (`metadata.payload.overflow===true`); `noop` is a valid outcome the caller must handle without treating as error
- `MissionRunStatus` (`src/vex-agent/engine/types.ts:71`) — 9 values; `paused_user` added puzzle-03; mirrors must stay in sync (CI drift test)
- `EngineContext.sessionPermission` (`src/vex-agent/engine/types.ts:249`) — immutable per turn; every approval gate reads this field, never re-queries DB mid-turn
- **ADR-0001 invariant**: `EngineContext` has NO model/provider fields; model is global from env. Any `EngineContext.modelId` addition is a divergence.

## Capabilities (stable IDs)

- **CAP-engine-runtime-claim-run**: Atomic lease claim + status flip to `running` for mission runs — `src/vex-agent/engine/runtime/lease-and-status/claim-run-lease.ts:38 claimRunLeaseAndFlipToRunning`
- **CAP-engine-runtime-claim-session**: Atomic session-scoped lease for chat-only turns — `src/vex-agent/engine/runtime/lease-and-status/claim-session-lease.ts:16 claimSessionLease`
- **CAP-engine-runtime-observe-control**: Atomic observe + apply for `pause_after_step` / `stop_terminal` control requests at safe turn-loop boundary — `src/vex-agent/engine/runtime/lease-and-status/observe-and-apply.ts:39 observeAndApplyControl`
- **CAP-engine-runtime-lease-heartbeat**: Lease heartbeat + idempotent release — `src/vex-agent/engine/runtime/lease-handle.ts:69 createLeaseHandle`
- **CAP-engine-runtime-release-emit**: Post-release canonical control-state emit — `src/vex-agent/engine/runtime/release-and-emit.ts:41 releaseLeaseAndEmitControlState`
- **CAP-engine-events-transcript-bus**: In-process post-commit transcript append signal — `src/vex-agent/engine/events/transcript-bus.ts:98 transcriptEventBus`
- **CAP-engine-events-stream-bus**: In-process ephemeral stream delta signal — `src/vex-agent/engine/events/stream-bus.ts:114 streamDeltaBus`
- **CAP-engine-events-control-bus**: In-process control-state transition signal — `src/vex-agent/engine/runtime/control-bus.ts:78 controlStateBus`
- **CAP-engine-events-append-message**: Atomic transcript persist + event emit — `src/vex-agent/engine/events/append-transcript.ts:85 appendMessage`
- **CAP-engine-runtime-ingress**: User-message routing with wake preemption — `src/vex-agent/engine/ingress.ts:43 routeUserMessage`
- **CAP-engine-runtime-clock**: Deterministic UTC/local clock snapshot for prompt context — `src/vex-agent/engine/runtime-clock.ts:49 buildRuntimeClockSnapshot`
- **CAP-engine-runtime-checkpoint-plan**: Compaction plan selection (prefix / giant_tool / noop) — `src/vex-agent/engine/checkpoint/prefix.ts:54 selectPrefixWithGiantFallback`
- **CAP-engine-runtime-bug-sink**: Injectable bug-report sink registry — `src/vex-agent/engine/support/bug-report-registry.ts:29 setBugReportSink`
- **CAP-engine-runtime-types**: Canonical run-status enum, status sets, `EngineContext`, `TurnResult`, `MissionDraft` — `src/vex-agent/engine/types.ts`

## Public API (consumed by)

- `vex-app/src/main/ipc/chat.ts:148` → `submitOperatorInstruction` (dynamic import of engine barrel)
- `vex-app/src/main/ipc/_shared/runtime-resume-dispatch.ts:97` → `claimRunLeaseAndFlipToRunning`, `releaseLeaseAndEmitControlState` (dynamic imports)
- `vex-app/src/main/agent/transcript-bridge.ts:45` → `transcriptEventBus.subscribe`
- `vex-app/src/main/agent/stream-bridge.ts:115` → `streamDeltaBus.subscribe`
- `vex-app/src/main/agent/control-bridge.ts:24` → `controlStateBus.subscribe`
- `vex-app/src/main/ipc/runtime/_emit-control-state.ts:29` → `controlStateBus.emit` (direct, not via engine barrel — imports `@vex-agent/engine/runtime/control-bus.js` directly)
- `vex-app/src/main/agent/index.ts:34` → `setBugReportSink`, `resetBugReportSink`
- `vex-app/src/main/ipc/mission/_engine-dispatch.ts:52` → `getBugReportSink`
- `vex-app/src/main/ipc/_shared/runtime-resume-dispatch.ts:150` → `getBugReportSink`
- Engine-internal callers (Z2): `wake/executor.ts` → `claimRunLeaseAndFlipToRunning`, `createLeaseHandle`, `releaseLeaseAndEmitControlState`, `appendEngineMessage`, `getBugReportSink`; `compact-jobs/service.ts` → `selectPrefixWithGiantFallback`; `core/turn-loop-observe.ts` → `observeAndApplyControl`; `core/approval-runtime/continuation.ts` → `claimRunLeaseAndFlipToRunning`, `createLeaseHandle`, `releaseLeaseAndEmitControlState`; `core/runner/{agent,setup-turn,recover-prepare,mission-prepare}.ts` → `claimSessionLease` / `claimRunLeaseAndFlipToRunning`; ~12 Z1 turn-loop files → `appendMessage` / `appendEngineMessage`; `engine/prompts/index.ts` → `buildRuntimeClockSnapshot`, `buildRuntimeClockPrompt`

## Internal flow

### Chat-turn lease path
1. `vex-app/src/main/ipc/chat.ts` → dynamic import `submitOperatorInstruction`
2. `ingress.ts:43 routeUserMessage` cancels pending wake → reads active run
3. No active run / agent mode → `core/runner/agent.ts processAgentTurn` → `claimSessionLease` (atomic per-session lease)
4. `createLeaseHandle` starts heartbeat interval
5. Turn loop runs; `appendMessage` persists each message → emits `transcriptEventBus` post-commit; `streamDeltaBus` emits per chunk during inference
6. Loop exits (text response / stop signal / iteration limit)
7. Runner `finally` → `releaseLeaseAndEmitControlState` → release DB lease → re-read state → emit `controlStateBus`
8. vex-app bridges forward all three events to renderer via `broadcastToAllWindows`

### Control-request path
- IPC `runtime.requestStop` → `observeAndApplyControl` with kind `stop_terminal` → atomic flip `stopped` + wake cancel + lease DELETE → caller emits `controlStateBus` via `_emit-control-state.ts`
- IPC `runtime.requestPause` → kind `pause_after_step` → pending in DB; turn-loop checks at safe iteration boundary via `core/turn-loop-observe.ts` → `observeAndApplyControl` → flip `paused_user`

### Wake preempt path
1. User sends message while run is `paused_wake`
2. `routeUserMessage` detects `paused_wake` → calls `resumeMissionRunWithPreempt` (private)
3. `claimRunLeaseAndFlipToRunning(fromStatuses=["paused_wake"])` — cancels pending wake rows + flips to `running`
4. `createLeaseHandle` + `addOperatorInstruction` + `addOperatorCue` + `resumeMissionRun`
5. `finally` → `releaseLeaseAndEmitControlState`

## Dependencies

### Imports FROM

- `@vex-agent/db/client.ts` — `withTransaction`, `queryOneWith`, `executeWith`
- `@vex-agent/db/repos/runner-leases.ts` — `acquireLease`, `renewLease`, `releaseLease`, `getLease`, types
- `@vex-agent/db/repos/mission-runs.ts` — `getActiveRunBySession`, `getRun`, `casFlipToRunning` (legacy, removed in puzzle-03)
- `@vex-agent/db/repos/runtime-control-requests.ts` — types (`ControlRequest`, `ControlRequestKind`)
- `@vex-agent/db/repos/messages.ts` — `addMessageReturningId`
- `@vex-agent/db/repos/loop-wake.ts` — `cancelForSession`
- `@vex-agent/db/repos/missions.ts` — `getActiveMission`
- `@vex-agent/inference/types.ts` — `StreamChunk`, `InferenceUsage` (stream-bus.ts only)
- `@utils/logger.ts` — `logger` (warn)
- `src/lib/diagnostics/bug-report-sink.ts` — `noopBugReportSink`, `BugReportSink`

### Consumed BY

- `module.vex-agent.engine-core` (turn loop, turn, approval-runtime, operator-instructions, tool-output-overflow, rewind, run-tool)
- `module.vex-agent.engine-runner` (agent, mission runners, setup-turn, abort, retry, recover)
- `module.vex-agent.engine-mission` (via ingress preempt path)
- `module.vex-agent.engine-compact` (`compact-jobs/service.ts` → `selectPrefixWithGiantFallback`, `bug-emit.ts` → `getBugReportSink`)
- Z6 `vex-app/src/main/agent/` — bridge subscriptions + `setBugReportSink` mount
- Z6 `vex-app/src/main/ipc/` — `chat.ts`, `_shared/runtime-resume-dispatch.ts`, `runtime/_emit-control-state.ts`, `mission/_engine-dispatch.ts`
- Z2 `engine/prompts/index.ts` — `buildRuntimeClockSnapshot`, `buildRuntimeClockPrompt`
- Z2 `engine/wake/executor.ts` — lease helpers, `appendEngineMessage`, `getBugReportSink`

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-engine-runtime-…`, `audits/current/coverage-gaps.md#CAP-engine-events-…`
- related flows: `flows/FLOW-chat-turn.md` (pending), `flows/FLOW-mission-wake.md` (pending)
- related decisions: `decisions/ADR-0001-global-model-session-wallet.md` — `EngineContext` must NOT carry a model field
- quality findings: `audits/current/quality-findings.md` — F5 (`EV.engine.controlState` not bridged to renderer; `controlStateBus` emits never reach Z8)

## ADR-0001 contradiction check

No contradiction found. `EngineContext` (`types.ts:239`) has no `modelId` or provider fields. The buses carry `sessionId` / `missionRunId` only. No per-session model routing exists in any file in scope.

## Refresh triggers

Re-index when any of the following change:

- `src/vex-agent/engine/runtime/**` — lease/control semantics
- `src/vex-agent/engine/events/**` — bus shape or append-transcript contract
- `src/vex-agent/engine/types.ts` — status enum, EngineContext, TurnResult
- `src/vex-agent/engine/ingress.ts` — routing logic
- `src/vex-agent/db/repos/{runner-leases,runtime-control-requests,messages}.ts` — underlying row contracts
- Any new vex-app consumer of the three buses or lease helpers

## Open questions

- `observeAndApplyControl` always emits `terminalStatus: "stopped"` for `stop_terminal`; comment notes puzzle-04 may refine to `"cancelled"` when there is no committed work. Not yet done.
- `controlStateBus` emit path from `releaseLeaseAndEmitControlState` reaches `vex-app/src/main/agent/control-bridge.ts` which subscribes — but F5 (Structure.md): no preload subscription method / bridge method exists, so the event never reaches the renderer. The bridge fires into a void at the renderer layer.
- `_emit-control-state.ts` in `vex-app/src/main/ipc/runtime/` imports `controlStateBus` directly from `@vex-agent/engine/runtime/control-bus.js` (not through the engine barrel) — intentional to avoid pulling engine's full public surface; acceptable but worth noting for future refactor.
