---
id: module.vex-agent.engine-runner
kind: module
paths:
  - "src/vex-agent/engine/core/runner/**"
  - "src/vex-agent/engine/core/approval-runtime.ts"
  - "src/vex-agent/engine/core/approval-runtime/**"
  - "src/vex-agent/engine/core/rewind.ts"
  - "src/vex-agent/engine/core/resume.ts"
  - "src/vex-agent/engine/core/reject.ts"
  - "src/vex-agent/engine/core/approval-intent-preview.ts"
source_commit: c138af8
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/vex-agent/engine/core/runner/**"
  - "src/vex-agent/engine/core/approval-runtime.ts"
  - "src/vex-agent/engine/core/approval-runtime/**"
  - "src/vex-agent/engine/core/rewind.ts"
  - "src/vex-agent/engine/core/resume.ts"
  - "src/vex-agent/engine/core/reject.ts"
  - "src/vex-agent/engine/core/approval-intent-preview.ts"
related:
  - module.vex-agent.engine-core
  - module.vex-agent.engine-runtime-events
  - module.vex-agent.engine-mission
  - ADR-0001-global-model-session-wallet
---

# Engine Runner + Approval Runtime

## Purpose

Implements all execution entry points for the Vex engine: the agent-turn
runner, mission setup turn, mission start/resume/recover lifecycle (prepare +
run split), abort/retry/rewind/rewind-checkpoint, and the full approval
decision runtime (approve/reject CAS, TTL sweep, post-tx side effects, and
mission resume continuations). Every function that touches `mission_runs` status
transitions or `runner_leases` lives here or is composed from here. Provider
resolution occurs ONCE per entry point (global model — no per-session model per
ADR-0001).

## Retrieval keywords

- processAgentTurn, agent turn, chat turn
- processMissionSetupTurn, mission setup turn
- prepareMissionStart, runPreparedMissionStart, mission start, dispatched
- prepareMissionRecover, runPreparedMissionRecover, mission recover
- resumeMissionRun, resumePreparedMissionRun, mission resume, continue
- finalizeMissionRunStatus, finalizeMissionRunError, paused_error, completed, failed, cancelled
- abortMissionRun, abortActiveMissionForSession, stopActiveMissionForEdit, mission stop, mission abort
- retryActiveMissionRun, /retry, paused_error retry
- rewindSession, /rewind, archive suffix, rewind_checkpoint
- approveAndResume, rejectApproval, back-compat wrappers
- prepareApprove, prepareReject, expireApproval, approval decision
- runResumeAfterDecision, discardContinuation, PreparedContinuation
- sweepExpiredApprovals, TTL sweep
- buildIntentPreview, buildPolicySnapshot, approval preview, criticalArgs
- session lease, runner_lease, claimSessionLease, claimRunLeaseAndFlipToRunning
- runtime continuation, iteration_limit, timeout, scheduleRuntimeContinuation
- AbortController registry, in-process abort signal
- approvals-cleanup, rejectPendingApprovalsForSession

## State owned

- `runner_leases` table — via `claimSessionLease` / `claimRunLeaseAndFlipToRunning` /
  `releaseLeaseAndEmitControlState` (imported from `engine/runtime/lease-and-status.js`).
- `mission_runs.status` — set to `running / paused_error / failed / completed / cancelled /
  stopped / paused_wake` by finalize helpers and abort.
- `missions.status` — set to `running / completed / failed / cancelled / draft` by finalize
  and abort.
- `missions.approved_at` — cleared by `stopActiveMissionForEdit` and
  `prepareMissionRecover`; set by `prepareMissionRecover` tx.
- `approval_queue.status` / `approval_intents.decision` / `approval_intents.execution_status` —
  CAS-committed by snapshot tx inside `buildApproveSnapshot` / `buildRejectSnapshot`.
- `loop_wake_requests` — cancelled by `abortMissionRun`, `stopMissionRunForEdit`, `rewindSession`
  via `loopWakeRepo.cancelForSession`; created by `scheduleRuntimeContinuation`.
- `messages` / `messages_archive` — suffix archive + `rewind_checkpoint_id` stamping by
  `rewindSession` tx; tool-result appends by `applyApproveSideEffects` /
  `applyRejectSideEffects`.
- `rewind_checkpoints` — created by `rewindSession` tx.
- In-process `AbortController` registry (`controllers` Map, `abortIntents` Map) in
  `runner/abort.ts:44–45`.

## Boundary crossings

- **DB (engine pool)**: all repo imports use `@vex-agent/db/repos/*`; multi-table atomic ops via
  `withTransaction` from `@vex-agent/db/client.js`.
- **Inference / provider**: `resolveProvider()` + `provider.loadConfig()` called ONCE at the top
  of each entry point — global model (ADR-0001).
- **Tool dispatch**: `applyApproveSideEffects` calls `dispatchTool` from
  `@vex-agent/tools/dispatcher.js` (post-tx side effect, not inside the decision tx).
- **Event buses**: `appendMessage` / `appendEngineMessage` (transcript bus); finalize helpers
  emit on `controlStateBus` via lazy `import("../../runtime/control-bus.js")`.
- **Bug-report sink**: `finalizeMissionRunError` + `finalizeMissionRunStatus`
  (`system_error` path) call `emitBugReportSafe` from `src/lib/diagnostics/bug-report-sink.js`.
- **Wake repo**: `scheduleRuntimeContinuation` writes `loop_wake_requests`; abort/rewind cancel
  via `loopWakeRepo.cancelForSession`.
- **Blob TTL refresh**: `applyApproveSideEffects` + `applyRejectSideEffects` + `resumePreparedMissionRun`
  call `refreshBlobTtlForRecentMessages`.

## File map

- `runner/agent.ts:29` `processAgentTurn` — agent-mode one-shot turn; maxIterations=10;
  claims session lease BEFORE first state mutation; releases in `finally`.
- `runner/setup-turn.ts:34` `processMissionSetupTurn` — mission setup phase; missionRunId=null;
  auto-creates draft; applies `parseModelMissionOutput` patch; caps at maxIterations=15.
- `runner/shared.ts:14` `toToolDefinitions`, `:27` `DEFAULT_LOOP_CONFIG` (maxIter=50,
  timeout=600 000ms, contextLimit=128 000) — shared by all mission runners.
- `runner/mission.ts:59` `startMission` (non-IPC), `:115` `resumeMissionRun` (non-IPC);
  both compose prepare+run halves; re-export `prepareMissionStart`,
  `runPreparedMissionStart`, `resumePreparedMissionRun`, etc.
- `runner/mission-prepare.ts:133` `prepareMissionStart` — 8-step security-first pipeline
  (ownership check → active-run gate × 2 → provider → lease → session permission →
  `commitMissionStart`); returns `PreparedMissionStart` opaque struct; structured outcome
  union `PrepareMissionStartOutcome` (11 variants).
- `runner/mission-run.ts:102` `runPreparedMissionStart` — activation msg + hydrate + tools +
  `runTurnLoop` + `finalizeMissionRunStatus` + lease release in `finally`.
- `runner/mission-run.ts:209` `resumePreparedMissionRun` — `updateStatus(running)` + blob
  refresh + hydrate + `runTurnLoop` + `finalizeMissionRunStatus`; NO lease release (caller owns it).
- `runner/mission-finalize.ts:70` `finalizeMissionRunStatus` — maps `StopReason` to run/mission
  status; handles `user_stopped+edit→draft`, `goal_reached→completed`, `user_stopped→cancelled`,
  `iteration_limit|timeout→paused_wake` (via `scheduleRuntimeContinuation`), `system_error→failed+bug-report`,
  `compact_unable_at_critical→paused_error`.
- `runner/mission-finalize.ts:181` `finalizeMissionRunError` — writes `paused_error` with
  structured evidence; emits bug report; re-throws for caller to wrap in `MissionRunPausedError`.
- `runner/abort.ts:106` `abortMissionRun` — cancel wakes → reject approvals →
  (a) live loop: fire `AbortSignal`; (b) paused/out-of-process: DB-direct `cancelled`.
- `runner/abort.ts:153` `abortActiveMissionForSession` — resolves active run then delegates.
- `runner/abort.ts:168` `stopActiveMissionForEdit` — sets `abortIntents("edit")` →
  AbortSignal → run=`stopped`, mission=`draft`; used by `/rewind` for paused runs.
- `runner/abort.ts:176` `stopMissionRunForEdit` — synchronous variant of the above.
- `runner/retry.ts:36` `retryActiveMissionRun` — atomic `claimRunLeaseAndFlipToRunning`
  for `paused_error|paused_wake` → delegates to `resumeMissionRun`; lease released in `finally`.
- `runner/runtime-continuation.ts:39` `scheduleRuntimeContinuation` — enqueues
  `loop_wake_requests` with 5s `AUTO_CONTINUE_AFTER_MS`; appends `runtime_yield` engine message.
- `runner/approvals-cleanup.ts:15` `rejectPendingApprovalsForSession` — per-row CAS
  reject of all `pending` approvals for a session; shared by abort + rewind.
- `runner/recover.ts:32` `recoverFailedMissionRun` (non-IPC) — composes prepare+run halves.
- `runner/recover-prepare.ts:87` `prepareMissionRecover` — same 8-step shape as
  `prepareMissionStart`; atomic tx: `setStatus(running)` + `setApprovedAt` + `createRun`
  (with `recoveredFromRunId`) + `getRun` readback.
- `runner/recover-run.ts:27` `runPreparedMissionRecover` — best-effort recovery banner +
  delegates to `resumePreparedMissionRun`; lease release in `finally`.
- `approval-runtime.ts:70` `prepareApprove` — orchestrates approve path (snapshot tx +
  side effects); returns `ApprovePrepareOutcome`.
- `approval-runtime.ts:142` `prepareReject` — reject path.
- `approval-runtime.ts:187` `expireApproval` — auto-reject for TTL boundary.
- `approval-runtime/snapshot.ts:129` `buildApproveSnapshot` — single locked tx
  (`FOR UPDATE OF i, q`) with DB-side `NOW()` TTL gate; returns `ApproveSnapshot`
  discriminated union (6 variants).
- `approval-runtime/snapshot.ts:248` `buildRejectSnapshot` — 4-variant `RejectSnapshot`.
- `approval-runtime/post-tx.ts:100` `applyApproveSideEffects` — `markExecutionStatus(dispatching)`
  → blob refresh → wallet hydrate → `dispatchTool` → result hash → `appendMessage` (tool result) →
  `claimResumeContinuation` → returns `ApprovePrepareOutcome{kind:"dispatched"}`.
- `approval-runtime/post-tx.ts:332` `applyRejectSideEffects` — blob refresh → append rejection
  tool-result → `claimResumeContinuation`.
- `approval-runtime/continuation.ts:19` `claimResumeContinuation` — wraps
  `claimRunLeaseAndFlipToRunning(fromStatuses:["paused_approval","running"])`;
  returns opaque `PreparedContinuation | null`.
- `approval-runtime/continuation.ts:68` `runResumeAfterDecision` — consumes continuation
  (calls `resumeMissionRun`); lease released in `finally`. MUST be called at most once.
- `approval-runtime/continuation.ts:89` `discardContinuation` — idempotent lease release.
- `approval-runtime/sweep.ts:30` `sweepExpiredApprovals` — batch 50 expired intents →
  `expireApproval` per row with per-row exception isolation; returns `SweepResult`
  (swept/errored/continuations array to main for dispatching).
- `approval-runtime/helpers.ts` — `shortSha256`, `summarizeErrorForLog`,
  `buildDispatchFailedToolResultContent` (structural-only, no raw error text),
  `buildRejectedToolResultContent`, `extractToolCall` (supports both `{command,args}` and
  legacy `{name,arguments}` shapes), `LEASE_TTL_MS=5min`, `SWEEP_BATCH_LIMIT=50`.
- `approval-runtime/types.ts:22` `PreparedContinuation`, `:29` `ApprovePrepareOutcome`
  (5 kinds), `:70` `RejectPrepareOutcome` (3 kinds), `:95` `SweepResult`,
  `:106` `ApprovalDispatchError`, `:125` `ApprovalDecisionInconsistencyError`,
  `:146` `ApprovalPostDecisionError`.
- `rewind.ts:81` `rewindSession` — 5-step: (1) abort/stop active run,
  (2) compute cutoff, (3) reject pending approvals, (4) cancel wakes,
  (5) atomic tx: lock session row + create `rewind_checkpoint` + archive suffix stamped
  with checkpoint id + update `archived_count`.
- `resume.ts:29` `approveAndResume` — back-compat wrapper: `prepareApprove` +
  `runResumeAfterDecision` (synchronous). IPC must NOT use this.
- `reject.ts:40` `rejectApproval` — back-compat wrapper: `prepareReject` +
  `runResumeAfterDecision` (synchronous). IPC must NOT use this.
- `approval-intent-preview.ts:129` `buildIntentPreview` — allow-listed
  `criticalArgs` (21 keys); unwraps `execute_tool` wrapper → target protocol tool via
  `resolveEffectiveCall`; coerces to JSON-safe scalars; never embeds nested objects.
- `approval-intent-preview.ts:168` `buildPolicySnapshot` — captures enqueue-time
  `permission/sessionKind/missionRunActive/contextUsageBand/missionId/missionRunId/role`.

## Key types & invariants

- `PreparedMissionStart` (`runner/mission-prepare.ts:64`) — opaque struct holding all
  resolved inputs (runId, lease, provider, config, permission). No fallible IO after step 7;
  the lease is already acquired.
- `PreparedMissionRecover` (`runner/recover-prepare.ts:47`) — same shape; adds
  `newRunId` + `recoveredFromRunId`.
- `PreparedContinuation` (`approval-runtime/types.ts:22`) — opaque; holds `LeaseHandle`;
  MUST call `runResumeAfterDecision` or `discardContinuation` exactly once to avoid lease leak.
- `ApprovePrepareOutcome` (`approval-runtime/types.ts:29`) — 5-variant union:
  `dispatched | cached_approved | expired | already_rejected | run_terminated`.
- `RejectPrepareOutcome` (`approval-runtime/types.ts:70`) — 3-variant:
  `rejected | cached_rejected | already_approved`.
- `PrepareMissionStartOutcome` (`runner/mission-prepare.ts:82`) — 11-variant structured
  rejection map; no throw for expected rejections.
- `IntentSnapshotRow` (`approval-runtime/snapshot.ts:39`) — denormalised intent+queue join
  held inside the locked tx; never escapes the snapshot phase.
- `RewindOutcome` (`rewind.ts:49`) — immutable result with `noop`, `blocked`,
  `archivedMessages`, `checkpointId`, `missionRunImpact`.
- **Invariant**: `abortMissionRun` + `rewindSession` both call `rejectPendingApprovalsForSession`
  before any message/status mutation, preventing a concurrent `approveAndResume` from dispatching
  against stale state.
- **Invariant**: `runPreparedMissionStart` / `resumePreparedMissionRun` register an
  `AbortController` at entry and unregister in `finally` — never leaked on throw.
- **Invariant**: `finalizeMissionRunError` always logs before the DB write, so even a DB
  outage leaves a log trail; it re-throws the DB error so the caller surfaces it rather
  than silently swallowing.
- **Invariant**: approval snapshot tx commits `approval_queue.status` + `approval_intents.decision`
  atomically. A queue `pending` row alongside a non-null `decision` is a hard invariant
  violation surfaced as `ApprovalDecisionInconsistencyError`.

## Capabilities (stable IDs)

- **CAP-engine-runner-agent-turn**: process a single agent-turn (conversational, one-shot,
  up to 10 tool-call iterations) — `runner/agent.ts:29 processAgentTurn`
- **CAP-engine-runner-setup-turn**: process a mission setup turn (missionRunId=null, 15-iter
  cap, auto-create draft, patch apply) — `runner/setup-turn.ts:34 processMissionSetupTurn`
- **CAP-engine-runner-mission-start**: atomic 8-step prepare + long-running run for fresh
  mission; IPC returns `dispatched` after durable row — `runner/mission-prepare.ts:133 prepareMissionStart`,
  `runner/mission-run.ts:102 runPreparedMissionStart`
- **CAP-engine-runner-mission-resume**: resume a mission run (wake, approval continuation,
  retry) — `runner/mission-run.ts:209 resumePreparedMissionRun`
- **CAP-engine-runner-mission-finalize**: map `StopReason` to run+mission status;
  `paused_wake` via runtime continuation; bug report on `system_error` —
  `runner/mission-finalize.ts:70 finalizeMissionRunStatus`
- **CAP-engine-runner-mission-error**: persist `paused_error` with evidence + bug report;
  always re-throw — `runner/mission-finalize.ts:181 finalizeMissionRunError`
- **CAP-engine-runner-mission-recover**: create new run from failed run's frozen contract
  snapshot; durable atomic tx; links via `recoveredFromRunId` —
  `runner/recover-prepare.ts:87 prepareMissionRecover`,
  `runner/recover-run.ts:27 runPreparedMissionRecover`
- **CAP-engine-runner-abort**: operator-driven abort; cancel wakes + reject approvals +
  AbortSignal or DB-direct finalize — `runner/abort.ts:106 abortMissionRun`
- **CAP-engine-runner-stop-for-edit**: stop run → mission returns to `draft` (not `cancelled`);
  sets `abortIntents("edit")` — `runner/abort.ts:168 stopActiveMissionForEdit`
- **CAP-engine-runner-retry**: atomic `claimRunLeaseAndFlipToRunning` for
  `paused_error|paused_wake` → `resumeMissionRun` — `runner/retry.ts:36 retryActiveMissionRun`
- **CAP-engine-runner-runtime-continuation**: schedule 5s wake on `iteration_limit|timeout`;
  appends `runtime_yield` engine message — `runner/runtime-continuation.ts:39 scheduleRuntimeContinuation`
- **CAP-engine-runner-rewind**: archive live tape suffix atomically (lock session + checkpoint
  + archive suffix + update count); stop paused runs; reject approvals; cancel wakes —
  `rewind.ts:81 rewindSession`
- **CAP-engine-approval-prepare-approve**: locked-tx approve (DB-side NOW() TTL gate,
  CAS queue+intent); post-tx: dispatch tool, append tool-result, claim continuation —
  `approval-runtime.ts:70 prepareApprove`
- **CAP-engine-approval-prepare-reject**: locked-tx reject; post-tx: append rejection result,
  claim continuation — `approval-runtime.ts:142 prepareReject`
- **CAP-engine-approval-expire**: auto-reject at TTL boundary (reuses `buildRejectSnapshot`
  with expired reason) — `approval-runtime.ts:187 expireApproval`
- **CAP-engine-approval-resume-continuation**: consume `PreparedContinuation` → `resumeMissionRun`
  + lease release — `approval-runtime/continuation.ts:68 runResumeAfterDecision`
- **CAP-engine-approval-sweep**: batch TTL sweep (50/cycle, per-row isolation); returns
  continuations to caller (main) for background dispatch —
  `approval-runtime/sweep.ts:30 sweepExpiredApprovals`
- **CAP-engine-approval-intent-preview**: allow-listed `criticalArgs` preview for UI;
  `execute_tool` unwrap; policy snapshot — `approval-intent-preview.ts:129 buildIntentPreview`,
  `:168 buildPolicySnapshot`

## Public API (consumed by)

### IPC layer (vex-app main) — dynamic imports

- `vex-app/src/main/ipc/chat.ts` → `submitOperatorInstruction` (via `engine/ingress.js`,
  which calls `processAgentTurn` or `processMissionSetupTurn`; not a direct import).
- `vex-app/src/main/ipc/mission/start.ts` → `prepareMissionStart`, `runPreparedMissionStart`
  (lazy `import("@vex-agent/engine/core/runner/mission.js")`).
- `vex-app/src/main/ipc/mission/recover.ts` → `prepareMissionRecover`, `runPreparedMissionRecover`
  (lazy `import("@vex-agent/engine/core/runner/recover.js")`).
- `vex-app/src/main/ipc/mission/rewind.ts` → `rewindSession`
  (lazy `import("@vex-agent/engine/core/rewind.js")`).
- `vex-app/src/main/ipc/approvals.ts` → `prepareApprove`, `prepareReject`,
  `runResumeAfterDecision`, `ApprovalDispatchError`, `ApprovalPostDecisionError`,
  `ApprovalDecisionInconsistencyError`
  (lazy `import("@vex-agent/engine/core/approval-runtime.js")`).
- `vex-app/src/main/ipc/approvals/_sweep.ts` → `sweepExpiredApprovals`, `runResumeAfterDecision`
  (lazy import; sweep runs on 5-min interval + first boot).
- `vex-app/src/main/ipc/approvals/_map-outcomes.ts` — type-only import for outcome union shapes.
- `vex-app/src/main/ipc/_shared/runtime-resume-dispatch.ts` + `runtime/request-resume.ts` +
  `mission/continue.ts` → `claimRunLeaseAndFlipToRunning` (via `engine/runtime/lease-and-status.js`);
  fire-and-forget `dispatchPreparedMission(() => resumeMissionRun(runId))`.

### Note: abort/retry NOT directly wired in vex-app IPC

`abortMissionRun`, `abortActiveMissionForSession`, `stopActiveMissionForEdit`, and
`retryActiveMissionRun` are exported from `engine/index.ts` but **no IPC handler in
`vex-app/src/main/ipc/` calls them**. Stop goes through `runtime-stop-dispatch.ts` (enqueues
a `stop_terminal` control request; the turn loop observes it). Retry and edit-stop have no
IPC handler at all — tests only. Back-compat wrappers `approveAndResume` / `rejectApproval`
are exported from `engine/index.ts` but also have no direct IPC callers; IPC uses
`prepareApprove`/`prepareReject` directly.

### Engine-internal consumers

- `engine/ingress.ts` → `processAgentTurn`, `processMissionSetupTurn` (via `runner.js`).
- `engine/wake/executor.ts` → `resumeMissionRun` (mission run wake-resume).
- `engine/core/rewind.ts` → `stopActiveMissionForEdit` (from `runner/abort.ts`),
  `rejectPendingApprovalsForSession` (from `runner/approvals-cleanup.ts`).
- `engine/core/approval-runtime/continuation.ts` → `resumeMissionRun` (via `runner/mission.js`).
- `engine/core/runner/retry.ts` → `resumeMissionRun` (lazy import of `runner/mission.js`).

## Internal flow

### Agent turn

```
processAgentTurn(sessionId, userInput, signal)
  → resolveProvider() + loadConfig()             # global model, throws if absent
  → claimSessionLease(ownerId)                   # puzzle-03: BEFORE first mutation
  → appendMessage(user)
  → hydrateEngineSession
  → getOpenAITools + computeBand
  → runTurnLoop(maxIter=10, inferenceAbortSignal=signal)
  → return TurnResult
  finally: releaseLeaseAndEmitControlState
```

### Mission start (IPC path — durable dispatch)

```
IPC: prepareMissionStart({missionId, sessionId})   # security-first 8 steps
  1. getMission → cross-session ownership check
  2. getActiveRunBySession (1st gate)
  3. resolveProvider + loadConfig
  4. claimSessionLease(ownerId)
  5. getActiveRunBySession (2nd gate, post-lease race)
  6. sessionsRepo.getSession → read permission
  7. commitMissionStart (atomic: acceptance+readiness+no-overlap+createRun)
  8. return PreparedMissionStart{runId, lease, provider, config, permission}
→ IPC returns {dispatched, runId}
→ fire-and-forget: runPreparedMissionStart(prepared)
  → addMissionActivationMessage
  → hydrateEngineSession
  → getOpenAITools + computeBand
  → runTurnLoop(maxIter=50, abortSignal=controller.signal)
  → finalizeMissionRunStatus
  catch: finalizeMissionRunError → throw MissionRunPausedError
  finally: unregisterMissionRunAbortController; releaseLeaseAndEmitControlState
```

### Approval approve (IPC path)

```
IPC: prepareApprove(approvalId)
  → withTransaction(buildApproveSnapshot)
      FOR UPDATE OF i, q
      TTL check: NOW() vs expires_at
      run terminal guard
      CAS: approveWith + markDecision('approved')
      → approved_in_tx
  → applyApproveSideEffects(approvalId, snapshot)
      markExecutionStatus('dispatching')
      refreshBlobTtlForRecentMessages
      hydrateEngineSession → walletResolution, walletPolicy
      dispatchTool(toolName, toolArgs)
        catch: onDispatchThrow → paused_error + ApprovalDispatchError
      markExecutionStatus('succeeded'|'failed')
      appendMessage(tool result)
      claimResumeContinuation(sessionId, missionRunId, ownerId)
        claimRunLeaseAndFlipToRunning(fromStatuses:['paused_approval','running'])
        → PreparedContinuation | null
      → ApprovePrepareOutcome{kind:'dispatched', continuation}
→ IPC returns mapApproveOutcome(outcome)
→ dispatchPreparedMission(() => runResumeAfterDecision(continuation))
    → resumeMissionRun(cont.missionRunId)
    finally: releaseLeaseAndEmitControlState
```

### Approval TTL sweep

```
runScheduledSweep() [every 5 min, first call at registration]
  → sweepExpiredApprovals(now)
      approvalIntentsRepo.getExpired(now, 50)
      for each intent: expireApproval(approvalId)
        buildRejectSnapshot(client, id, 'expired_ttl')
        applyRejectSideEffects → PreparedContinuation | null
      → SweepResult{swept, errored, continuations}
  → for each continuation: dispatchPreparedMission(() => runResumeAfterDecision(cont))
```

### Rewind

```
rewindSession(sessionId, turns)
  → getActiveRunBySession
       running → throw BLOCKED (operator must /mission stop first)
       paused_* → stopActiveMissionForEdit (run=stopped, mission=draft)
  → selectCutoffMessage (N user messages from end)
  → rejectPendingApprovalsForSession
  → loopWakeRepo.cancelForSession
  → withTransaction:
       SELECT id FROM sessions WHERE id=$1 FOR UPDATE
       rewindCheckpointsRepo.createCheckpoint(archivedCount=0)
       sessionsRepo.archiveSuffix(sessionId, cutoffMessageId, checkpoint.id)
       rewindCheckpointsRepo.setCheckpointArchivedCount(real count)
  → return RewindOutcome
```

## Dependencies

**Imports FROM:**
- `module.vex-agent.engine-core` — `hydrateEngineSession`, `buildSessionWalletResolution`
  (`core/hydrate.js`); `runTurnLoop`, `TurnLoopConfig` (`core/turn-loop.js`); `computeBand`
  (`core/context-band.js`); `appendMessage`, `appendEngineMessage` (`engine/events/index.js`).
- `module.vex-agent.engine-runtime-events` — `claimSessionLease`, `claimRunLeaseAndFlipToRunning`,
  `createLeaseHandle`, `releaseLeaseAndEmitControlState` (`engine/runtime/`);
  `controlStateBus`, `CONTROL_STATE_EVENT_TYPE` (`engine/runtime/control-bus.js`).
- `module.vex-agent.engine-mission` — `commitMissionStart`, `getMissionSetupState`,
  `createMissionDraft`, `applyMissionPatch`, `parseModelMissionOutput`, `resolveMissionPromptContext`,
  `requireMissionPromptContextFromSnapshot` (various `engine/mission/*.js`);
  `refreshBlobTtlForRecentMessages` (`engine/wake/blob-refresh.js`).
- `module.vex-agent.inference` — `resolveProvider` (`inference/registry.js`).
- `module.vex-agent.tools` — `getOpenAITools` (`tools/registry.js`); `dispatchTool`
  (`tools/dispatcher.js`); `InternalToolContext` (`tools/internal/types.js`).
- `module.vex-agent.db` — all repos (missions, mission-runs, sessions, approvals,
  approval-intents, messages, loop-wake, runner-leases, rewind-checkpoints); `withTransaction`,
  `queryOneWith` (`db/client.js`).
- `module.src-root.lib` — `emitBugReportSafe` (`lib/diagnostics/bug-report-sink.js`);
  `getBugReportSink` (`engine/support/bug-report-registry.js`).

**Consumed BY:**
- `module.vex-agent.engine-core` — `engine/ingress.ts` calls `processAgentTurn`,
  `processMissionSetupTurn`; `engine/index.ts` re-exports all public names.
- `module.vex-agent.engine-mission` — `wake/executor.ts` calls `resumeMissionRun`.
- `module.vex-app.main` — IPC handlers for mission start/recover/rewind (dynamic imports);
  approvals IPC (`prepareApprove`, `prepareReject`, `runResumeAfterDecision`,
  `sweepExpiredApprovals`); runtime resume dispatcher fires `resumeMissionRun` via
  `_shared/runtime-resume-dispatch.ts`.

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-engine-runner-abort`
  (abort/retry have no IPC wiring — see Open questions #1)
- quality findings: `audits/current/quality-findings.md#FINDING-engine-*`
- related flows: `flows/FLOW-mission-start.md`, `flows/FLOW-approval-restricted-resume.md`
  (not yet written — Round 2)
- related decisions: `decisions/ADR-0001-global-model-session-wallet.md`
  (model is global — `resolveProvider()` called once per entry point, no per-session model)

## Refresh triggers

Any change to the scope paths listed in front matter invalidates this doc. Also watch:
- `src/vex-agent/engine/runtime/lease-and-status.ts` — lease CAS helpers called heavily here.
- `src/vex-agent/engine/types.ts` — `TERMINAL_RUN_STATUSES`, `ACTIVE_RUN_STATUSES`, `StopReason`.
- `src/vex-agent/db/repos/approval-intents.ts` — `getExpired`, `markDecision*`, `markExecutionStatus`.
- `vex-app/src/main/ipc/approvals.ts` + `approvals/_sweep.ts` — IPC dispatch shape for approve/reject/sweep.
- `vex-app/src/main/ipc/mission/start.ts` + `recover.ts` + `rewind.ts` — IPC dispatch shape for mission lifecycle.

## Open questions

1. **Abort/retry not wired in IPC**: `abortMissionRun`, `retryActiveMissionRun`, and
   `stopActiveMissionForEdit` are exported from `engine/index.ts` but have no IPC handlers
   in `vex-app/src/main/ipc/`. Mission stop goes through `runtime-stop-dispatch.ts`
   (enqueue-only control request). Retry has no IPC handler at all. Is this intentional
   (operator uses transcript slash commands only)? If not, missing handlers = users cannot
   `/retry` or abort from the UI.

2. **`resumePreparedMissionRun` does NOT release its own lease**: the function owns the
   turn-loop but delegates lease release to its callers (`runPreparedMissionStart`,
   `runPreparedMissionRecover`, `runResumeAfterDecision`, `retryActiveMissionRun`). If a
   new callsite forgets the `finally` block, the lease leaks. Not a bug in current code
   but a latent trap.

3. **`approveAndResume` / `rejectApproval` back-compat wrappers**: both await the full
   resumed turn loop synchronously. IPC correctly uses `prepareApprove`/`prepareReject`
   directly. The wrappers exist only for non-IPC callers (tests). They should be explicitly
   deprecated/flagged if a test suite starts calling them on real DB without an intent
   to block.

4. **`execute_tool` wrapper preview resolution**: `resolveEffectiveCall` in
   `approval-intent-preview.ts:101` correctly unwraps `execute_tool({toolId, params})`
   for the preview. However, if `params` is missing or not a plain object, it falls back
   to an empty `args` map — the `criticalArgs` preview would then be empty for a
   `user_wallet_broadcast` action. Confirm whether the protocol tool always sets `params`
   at dispatch time.

5. **TTL sweep wiring in vex-app main**: `_sweep.ts` runs on a 5-min interval started
   at `registerApprovalsHandlers`. Confirm this registration is idempotent on IPC handler
   re-registration (e.g. after a vault re-lock) to prevent duplicate sweep intervals.
