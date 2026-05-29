---
id: module.vex-app.main-ipc-engine-orchestration
kind: module
title: Main-Process IPC Engine Orchestration
short: IPC handler plumbing, cancellation registry, chat submit, mission lifecycle, runtime control, approvals, session CRUD
tags: [electron, ipc, engine-bridge, async, lifecycle]
indexed_at: 2026-05-29
source_commit: 85ed941
paths:
  - vex-app/src/main/ipc/register-handler.ts
  - vex-app/src/main/ipc/register-all.ts
  - vex-app/src/main/ipc/cancel.ts
  - vex-app/src/main/ipc/cancel-helpers.ts
  - vex-app/src/main/ipc/chat.ts
  - vex-app/src/main/ipc/mission.ts
  - vex-app/src/main/ipc/mission/index.ts
  - vex-app/src/main/ipc/mission/start.ts
  - vex-app/src/main/ipc/mission/continue.ts
  - vex-app/src/main/ipc/mission/stop.ts
  - vex-app/src/main/ipc/mission/recover.ts
  - vex-app/src/main/ipc/mission/rewind.ts
  - vex-app/src/main/ipc/mission/restore.ts
  - vex-app/src/main/ipc/mission/renew.ts
  - vex-app/src/main/ipc/mission/accept-contract.ts
  - vex-app/src/main/ipc/mission/get-diff.ts
  - vex-app/src/main/ipc/mission/get-draft.ts
  - vex-app/src/main/ipc/mission/get-renewable-source.ts
  - vex-app/src/main/ipc/mission/update-draft.ts
  - vex-app/src/main/ipc/mission/_engine-dispatch.ts
  - vex-app/src/main/ipc/runtime.ts
  - vex-app/src/main/ipc/runtime/index.ts
  - vex-app/src/main/ipc/runtime/get-state.ts
  - vex-app/src/main/ipc/runtime/request-pause.ts
  - vex-app/src/main/ipc/runtime/request-resume.ts
  - vex-app/src/main/ipc/runtime/request-stop.ts
  - vex-app/src/main/ipc/runtime/cancel-wake.ts
  - vex-app/src/main/ipc/runtime/_errors.ts
  - vex-app/src/main/ipc/runtime/_ensure-engine-db-url.ts
  - vex-app/src/main/ipc/runtime/_emit-control-state.ts
  - vex-app/src/main/ipc/approvals.ts
  - vex-app/src/main/ipc/approvals/_errors.ts
  - vex-app/src/main/ipc/approvals/_map-outcomes.ts
  - vex-app/src/main/ipc/approvals/_sweep.ts
  - vex-app/src/main/ipc/sessions/create.ts
  - vex-app/src/main/ipc/sessions/delete.ts
  - vex-app/src/main/ipc/sessions/get.ts
  - vex-app/src/main/ipc/sessions/get-model.ts
  - vex-app/src/main/ipc/sessions/list.ts
  - vex-app/src/main/ipc/sessions/set-pinned.ts
  - vex-app/src/main/ipc/_shared/runtime-resume-dispatch.ts
  - vex-app/src/main/ipc/_shared/runtime-stop-dispatch.ts
  - vex-app/src/shared/schemas/chat.ts
  - vex-app/src/shared/schemas/mission.ts
  - vex-app/src/shared/schemas/runtime.ts
  - vex-app/src/shared/schemas/approvals.ts
  - vex-app/src/shared/schemas/sessions.ts
  - src/vex-agent/engine/index.ts
  - src/vex-agent/engine/ingress.ts
  - src/vex-agent/inference/openrouter.ts
stale_when_paths_change:
  - vex-app/src/main/ipc/**/*.ts
  - vex-app/src/shared/schemas/{chat,mission,runtime,approvals,sessions}.ts
  - src/vex-agent/engine/ingress.ts
  - src/vex-agent/engine/core/runner/mission.ts
  - src/vex-agent/engine/core/approval-runtime.ts
related:
  - module.vex-app.main-bootstrap-lifecycle
  - module.vex-app.main-agent-bridge
  - module.vex-app.preload-channels-events-errors
  - module.vex-app.shared-schemas-bridge-types
  - module.vex-agent.engine-runner
  - module.vex-agent.engine-runtime-events
  - module.vex-agent.engine-mission
  - module.vex-agent.tools-internal
  - fix-plan.F3
---

## Purpose

The main-process IPC orchestration layer bridges the untrusted Electron renderer with the canonical `@vex-agent/engine` runtime. It owns:

- **Trusted sender validation** — rejects subframes, non-packaged origins, and malformed frames before any payload parsing.
- **Request/response envelope validation** — Zod-bounded input schemas at ingress, output schemas at egress.
- **Cancellation registry** — maps `correlationId` → `AbortController`; renderer can cancel in-flight work via `vex:cancel`.
- **Engine database URL bridging** — lazy sync of `process.env.VEX_DB_URL` before engine operations.
- **Chat submission** — operator text → engine ingress, with session validation and initial goal persistence.
- **Mission lifecycle** — prepare-and-dispatch pattern for start/recover; read-only contract/draft handlers; lifecycle mutations (accept, renew, rewind, restore, continue, stop).
- **Runtime control** — pause/resume/stop/wake-cancel verbs; lease claim-and-flip; fire-and-forget continuation with audit logging and bug-report integration.
- **Approvals flow** — read-only pending/history lists; approve/reject with engine decision persistence; scheduled TTL sweep.
- **Session CRUD** — create, list, get, delete, set-pinned; wallet resolution; mission draft bootstrap.

The renderer remains untrusted: it cannot import `src/vex-agent`, Node APIs, DB, Docker, or signing authority directly. Every handler exports exactly one contract: input schema → output schema, never exceptions.

---

## Retrieval Keywords

`registerHandler` trusted-sender, cancel envelope, correlationId registry, AbortController, cancel-helpers raceWithAbort isAbortError, cancelledError, chat.submit engine import, session validation, mission.start prepareMissionStart dispatchPreparedMission, runtime control requestPause requestResume requestStop, approval resolve decision decision persistence sweepExpiredApprovals, session.create wallet-refs, runtime.getState mission-runs-db, control-state emit controlStateBus, F4 OpenRouterProvider.loadConfig per-turn API call, F6 RESOLVED (Bundle B) RuntimeRequestResult legacy alias deleted; RuntimeBridge/renderer use per-action schemas.

---

## State Owned

- **Cancel registry** (`vex-app/src/main/ipc/register-handler.ts:56`) — module-scoped `Map<correlationId, AbortController>`. In-flight requests only; completed/cancelled entries are removed in finally block to prevent stale lookups.
- **Approvals sweep interval** — 5 minutes; first fire immediately after registration so fresh app boot invalidates stale pending cards.
- **Session-engine coupling** — ephemeral per-IPC: each chat/mission/runtime request briefly holds a session read in DB, engine operates on the same Postgres URL via `process.env.VEX_DB_URL`.
- **Lease ownership** — resume/stop operations claim leases with caller-generated `ownerId` prefix (`ipc-resume-<uuid>`); release happens in the continuation's finally block, not in the IPC handler.

---

## Boundary Crossings

| Boundary | Input | Output | Validation |
|----------|-------|--------|-----------|
| Preload → Main | `RequestEnvelope<T>` with `requestId` + `payload` | `Result<U, VexError>` with `ok` bool | Zod `inputSchema` at entry, Zod `outputSchema` at exit (defense-in-depth). Sender frame validated against `app://vex` (prod) or `http://127.0.0.1:5173` (dev). |
| Main → Engine | Dynamic ESM import of `@vex-agent/engine/*`, `process.env.VEX_DB_URL` set | `Promise<EngineResult>` or thrown `Error` | `ensureEngineDbUrl` pre-flight. Caller's `AbortSignal` plumbed down if handler supports it. |
| Main → Renderer (Events) | `ControlStateEvent` via `controlStateBus`, `EV.engine.transcriptAppend` via `transcriptBus` | Broadcast to all renderer frames | Events validated by shared Zod gate (`control-bridge`); no raw engine objects cross. |
| Main → Renderer (Result) | `Result<T, VexError>` shape with error normalization | Renderer receives `{ok: true, data: T}` or `{ok: false, error: VexError}` | Error shape validated at `register-handler:145`; malformed errors wrapped as `internal.contract_violation`. Correlation IDs injected. |

**Critical invariant:** renderer never receives raw engine object shapes, DB rows, or wallet/signing authority. Every handler is a sieve.

---

## File Map

### Core Registration & Cancellation

- `vex-app/src/main/ipc/register-handler.ts:56` — `cancelRegistry` Map holding `AbortController` per request.
- `vex-app/src/main/ipc/register-handler.ts:228` — `registerHandler<I, O>()` factory: sender validation (76–95), envelope parse (237–248), abort-controller lifecycle (250–265), error normalization (272–323), output validation defense-in-depth (284–295).
- `vex-app/src/main/ipc/register-handler.ts:145` — `isValidVexErrorShape()` — closure on `VALID_ERROR_KEYS` set to reject foreign keys carrying leaked secrets.
- `vex-app/src/main/ipc/cancel-helpers.ts:25` — `AbortError` class mirroring DOM AbortError name.
- `vex-app/src/main/ipc/cancel-helpers.ts:63` — `raceWithAbort<T>(promise, signal)` — race without aborting upstream; used by compose-up joined waiters to detach from shared in-flight promise.
- `vex-app/src/main/ipc/cancel-helpers.ts:103` — `cancelledError(domain, correlationId)` — factory for canonical `internal.cancelled` VexError; retryable=true.
- `vex-app/src/main/ipc/cancel.ts:44` — `vex:cancel` handler: lookup correlationId, fire abort if not already aborted or completed.
- `vex-app/src/main/ipc/register-all.ts:47` — `registerAllIpcHandlers()` — sequential teardown registration so `globalCleanup` fires them on app quit.

### Chat Ingress

- `vex-app/src/main/ipc/chat.ts:119` — `registerChatSubmitHandler()` — validates session, persists initial mission goal, calls `ensureEngineDbUrl`, dynamic import `submitOperatorInstruction`, catches `provider.unavailable` and engine errors.
- `vex-app/src/main/ipc/chat.ts:99` — `ensureEngineDbUrl()` — builds Postgres URL from `buildPoolConfig()`, sets `process.env.VEX_DB_URL`, closes pool if URL differs.

### Mission Lifecycle (12 handlers via `mission/index.ts`)

- `vex-app/src/main/ipc/mission/start.ts:37` — `mission.start`: `prepareMissionStart` (sync atomic gate) → `dispatchPreparedMission` (background runner) → `emitControlStateAfterChange` (broadcast control event).
- `vex-app/src/main/ipc/mission/start.ts:81` — `mapRejection()` — engine prepare-outcome union → IPC result union (mission_not_found, session_mismatch, not_accepted, lease_busy, provider_unavailable, etc.).
- `vex-app/src/main/ipc/mission/continue.ts:17` — `mission.continue` delegates to shared `runResumeDispatch` (synonym for `runtime.requestResume`).
- `vex-app/src/main/ipc/mission/stop.ts` — `mission.stop` delegates to shared `runStopDispatch`.
- `vex-app/src/main/ipc/mission/recover.ts` — `prepareMissionRecover` (sync) → `dispatchPreparedMission` (background).
- `vex-app/src/main/ipc/mission/rewind.ts` — engine `rewindSession()`.
- `vex-app/src/main/ipc/mission/restore.ts` — engine `restoreLatestCheckpoint()` (LIFO).
- `vex-app/src/main/ipc/mission/renew.ts` — engine `renewMission()`.
- `vex-app/src/main/ipc/mission/accept-contract.ts` — engine `acceptContract()`.
- `vex-app/src/main/ipc/mission/get-diff.ts` — engine `getContractStatus()` (read-only).
- `vex-app/src/main/ipc/mission/get-draft.ts` — DB read from `missions` table (read-only DTO).
- `vex-app/src/main/ipc/mission/get-renewable-source.ts` — DB read of renewable mission source (read-only).
- `vex-app/src/main/ipc/mission/update-draft.ts` — fail-closed stub (lands with form in phase 7+).
- `vex-app/src/main/ipc/mission/_engine-dispatch.ts:37` — `dispatchPreparedMission(continuation, refs)` — fire background call, emit bug report on failure.

### Runtime Control (5 handlers via `runtime/index.ts`)

- `vex-app/src/main/ipc/runtime/get-state.ts:25` — `runtime.getState` — read-only DTO from `getActiveRunForSession()`.
- `vex-app/src/main/ipc/runtime/request-pause.ts:33` — `runtime.requestPause` — enqueue-only (no transition); audit row `pause_after_step`; runner observes at iteration boundary.
- `vex-app/src/main/ipc/runtime/request-stop.ts` — `runtime.requestStop` — enqueue-only (no transition); audit row `stop_terminal`.
- `vex-app/src/main/ipc/runtime/request-resume.ts:15` — `runtime.requestResume` — thin wrapper around `runResumeDispatch`.
- `vex-app/src/main/ipc/runtime/cancel-wake.ts` — `runtime.cancelWake` — audit + engine side-effect.
- `vex-app/src/main/ipc/runtime/_errors.ts` — `dbUnavailableError()`, `controlFailedError()` factories.
- `vex-app/src/main/ipc/runtime/_ensure-engine-db-url.ts:35` — `ensureEngineDbUrl()` helper (called by every runtime handler).
- `vex-app/src/main/ipc/runtime/_emit-control-state.ts:18` — `emitControlStateAfterChange()` — post-commit read + emit via `controlStateBus` (not direct broadcast; goes through Zod gate).

### Shared Resume/Stop Dispatch

- `vex-app/src/main/ipc/_shared/runtime-resume-dispatch.ts:50` — `runResumeDispatch(input, ctx)` — used by both `runtime.requestResume` AND `mission.continue` (semantic synonyms). Claims lease atomically, enqueues audit request, spawns continuation in background (fire-and-forget with handle lifetime and release-in-finally).
- `vex-app/src/main/ipc/_shared/runtime-stop-dispatch.ts` — analogous for stop verb.

### Approvals (resolve + read handlers via `approvals.ts`, sweep in `approvals/_sweep.ts`)

- `vex-app/src/main/ipc/approvals.ts:67` — `approvals.listPending` (read-only).
- `vex-app/src/main/ipc/approvals.ts:95` — `approvals.get` (read-only).
- `vex-app/src/main/ipc/approvals.ts:120` — `approvals.getHistory` (read-only).
- `vex-app/src/main/ipc/approvals.ts:150` — `approvals.approve` — engine `prepareApprove` (decision tx + post-tx side effects) → `dispatchPreparedMission(runResumeAfterDecision)`.
- `vex-app/src/main/ipc/approvals.ts:...` — `approvals.reject` — analogous.
- `vex-app/src/main/ipc/approvals/_errors.ts` — error builders.
- `vex-app/src/main/ipc/approvals/_map-outcomes.ts` — engine outcome union → IPC result union.
- `vex-app/src/main/ipc/approvals/_sweep.ts:17` — `runScheduledSweep()` — engine `sweepExpiredApprovals()` → dispatch continuations via background helper.

### Session CRUD (6 handlers via `sessions/`)

- `vex-app/src/main/ipc/sessions/create.ts:26` — `sessions.create` — resolve wallet IDs server-side, atomic session + mission draft creation.
- `vex-app/src/main/ipc/sessions/list.ts` — read-only DTO list.
- `vex-app/src/main/ipc/sessions/get.ts` — read-only DTO single.
- `vex-app/src/main/ipc/sessions/delete.ts` — DB delete (soft or hard per design).
- `vex-app/src/main/ipc/sessions/set-pinned.ts` — update `pinned` boolean.
- `vex-app/src/main/ipc/sessions/get-model.ts` — read-only session mode + model selection.

---

## Key Types & Invariants

### RequestEnvelope & Correlation

```typescript
// Preload → Main: every IPC call carries this shape
{
  requestId: string (UUID generated client-side),
  payload: T (validated against inputSchema)
}

// Main → Preload: every IPC result carries this shape
{
  ok: boolean,
  data?: T (if ok=true, validated against outputSchema),
  error?: VexError (if ok=false, shape validated at register-handler:145)
}

// VexError fields (all required after validation)
{
  code: VexErrorCode (runtime set membership check),
  domain: VexDomain (runtime set membership check),
  message: string,
  retryable: boolean,
  userActionable: boolean,
  redacted: true (literal invariant; no secrets),
  correlationId: string (injected/verified by register-handler),
  [optional] retryAfterMs?: number,
  [optional] details?: object
}
```

**Invariant 1:** Every handler MUST go through `registerHandler()`. Any IPC handler that calls `ipcMain.handle()` directly is a security bug.

**Invariant 2:** Cancellation is always envelope-wrapped. When `vex:cancel` aborts a handler:
- Handler's `ctx.signal` fires.
- Handler throws or returns `err(cancelledError(...))`.
- `registerHandler` normalizes to `{ok: false, error: {code: "internal.cancelled", ...}}`.
- Preload sees the same error shape as any other error; rendering can inspect `error.code`.

**Invariant 3:** Mission lifecycle uses prepare-then-dispatch. E.g. `mission.start`:
- `prepareMissionStart()` is sync, claims lease, creates durable `mission_runs` row, returns atomic gate outcome.
- Handler returns `{outcome: "dispatched", missionRunId, sessionId}` ONLY after durable row exists (Codex blocker #2/#3).
- Background runner (`runPreparedMissionStart`) fires async in the background; emission of control-state events and bug reports happens outside the IPC flow.

**Invariant 4:** Approval resolve invalidates (via F3 bridge) pending-approvals, approval-history(prefix), transcript, and runtime-state queries. The decision's post-tx side-effect (tool-result dispatch, lease+flip if resume-gated) is part of `prepareApprove`'s bounded transaction; continuation (`runResumeAfterDecision`) fires async.

**Invariant 5:** Runtime control verbs converge through `_shared/runtime-*-dispatch.ts`. Both `runtime.requestResume` and `mission.continue` use the same `runResumeDispatch()` to avoid lease/audit duplication (Codex phase-6 Q1). Lease claim-and-flip is atomic; continuation is fire-and-forget with handle release in finally.

**Invariant 6:** Chat handler ensures engine DB URL is set; no implicit fallback. If `buildPoolConfig()` returns null, handler returns `err(dbUnavailableError(...))` rather than trying a hardcoded URL.

---

## Capabilities (Stable IDs)

### Registration & Plumbing
- `CAP-vexapp-ipc-register-handler` — `registerHandler<I, O>` factory with sender validation, envelope parsing, output validation, cancellation lifecycle.
- `CAP-vexapp-ipc-register-all` — centralized teardown registration in `globalCleanup`.
- `CAP-vexapp-ipc-cancel-register` — `cancelRegistry` Map per `correlationId`.
- `CAP-vexapp-ipc-cancel-sweep` — abort handler removes controller in finally; late cancels return `{cancelled: false}`.

### Chat
- `CAP-vexapp-chat-submit` — `vex:chat:submit` IPC handler, session validation, engine `submitOperatorInstruction`, error classification (provider_unavailable vs internal).
- `CAP-vexapp-chat-db-url` — lazy sync of `process.env.VEX_DB_URL` before engine operations.

### Mission Lifecycle
- `CAP-vexapp-mission-start` — atomic prepare + fire-and-forget; outcome union (prepared, mission_not_found, session_mismatch, lease_busy, provider_unavailable, etc.).
- `CAP-vexapp-mission-stop` — delegates to shared stop dispatcher.
- `CAP-vexapp-mission-continue` — delegates to shared resume dispatcher (synonym for `runtime.requestResume`).
- `CAP-vexapp-mission-recover` — prepare + dispatch.
- `CAP-vexapp-mission-rewind` — engine `rewindSession()`.
- `CAP-vexapp-mission-restore` — engine `restoreLatestCheckpoint()` (LIFO).
- `CAP-vexapp-mission-renew` — engine `renewMission()`.
- `CAP-vexapp-mission-accept-contract` — engine `acceptContract()`.
- `CAP-vexapp-mission-get-diff` — engine `getContractStatus()` (read-only).
- `CAP-vexapp-mission-get-draft` — DB read from `missions` table (read-only).
- `CAP-vexapp-mission-get-renewable-source` — read-only renewable source.
- `CAP-vexapp-mission-update-draft` — fail-closed stub.

### Runtime Control
- `CAP-vexapp-runtime-get-state` — read-only DTO: active run status, lease, pending control kind.
- `CAP-vexapp-runtime-request-pause` — enqueue-only `pause_after_step` audit; runner observes at boundary.
- `CAP-vexapp-runtime-request-resume` — claims lease, enqueues audit, fires continuation (synonymous with `mission.continue`).
- `CAP-vexapp-runtime-request-stop` — enqueue-only `stop_terminal` audit; runner observes at boundary.
- `CAP-vexapp-runtime-cancel-wake` — wake cancel + audit.
- `CAP-vexapp-runtime-db-url-ensure` — pre-flight Postgres URL sync.
- `CAP-vexapp-runtime-emit-control-state` — post-commit read + emit via `controlStateBus` (shared Zod gate).

### Approvals
- `CAP-vexapp-approvals-list-pending` — read-only pending DTOs per session.
- `CAP-vexapp-approvals-get` — read-only single approval DTO.
- `CAP-vexapp-approvals-get-history` — read-only history DTOs (prefix-limited).
- `CAP-vexapp-approvals-approve` — engine decision tx + continuation.
- `CAP-vexapp-approvals-reject` — engine decision tx + continuation.
- `CAP-vexapp-approvals-sweep` — scheduled TTL sweep with continuation dispatch.

### Sessions
- `CAP-vexapp-sessions-create` — session + mission draft atomic creation; wallet ID resolution server-side.
- `CAP-vexapp-sessions-delete` — DB delete.
- `CAP-vexapp-sessions-get` — read-only DTO.
- `CAP-vexapp-sessions-list` — read-only DTO list.
- `CAP-vexapp-sessions-set-pinned` — update pinned flag.
- `CAP-vexapp-sessions-get-model` — read-only mode + model selection.

---

## Public API (Consumed By)

| Preload Bridge | Renderer Feature Area | Handler(s) |
|---|---|---|
| `preload.ipc.chat.submit()` | Chat panel message input | `CAP-vexapp-chat-submit` |
| `preload.ipc.runtime.getState()` | Mission control bar (pause/resume/stop buttons) | `CAP-vexapp-runtime-get-state` |
| `preload.ipc.runtime.requestPause()` | Pause button click | `CAP-vexapp-runtime-request-pause` |
| `preload.ipc.runtime.requestResume()` | Resume button click | `CAP-vexapp-runtime-request-resume` |
| `preload.ipc.runtime.requestStop()` | Stop button click | `CAP-vexapp-runtime-request-stop` |
| `preload.ipc.mission.start()` | Mission card "start run" button | `CAP-vexapp-mission-start` |
| `preload.ipc.mission.continue()` | Legacy "continue" button (synonym for resume) | `CAP-vexapp-mission-continue` |
| `preload.ipc.mission.stop()` | Legacy "stop" button | `CAP-vexapp-mission-stop` |
| `preload.ipc.mission.get*()` | Mission contract reader, diff viewer, draft editor | `CAP-vexapp-mission-get-{draft,diff,renewable-source,}` |
| `preload.ipc.mission.accept()` | Contract acceptance modal | `CAP-vexapp-mission-accept-contract` |
| `preload.ipc.mission.renew()` | Mission renewal button | `CAP-vexapp-mission-renew` |
| `preload.ipc.mission.rewind()` | Rewind action (if exposed) | `CAP-vexapp-mission-rewind` |
| `preload.ipc.mission.restore()` | Restore-from-checkpoint action | `CAP-vexapp-mission-restore` |
| `preload.ipc.approvals.listPending()` | Approvals region pending card list | `CAP-vexapp-approvals-list-pending` |
| `preload.ipc.approvals.get()` | Single approval detail view | `CAP-vexapp-approvals-get` |
| `preload.ipc.approvals.getHistory()` | Approvals region history tab | `CAP-vexapp-approvals-get-history` |
| `preload.ipc.approvals.approve()` | Approval card "approve" button | `CAP-vexapp-approvals-approve` |
| `preload.ipc.approvals.reject()` | Approval card "reject" button | `CAP-vexapp-approvals-reject` |
| `preload.ipc.sessions.create()` | New session wizard "confirm" button | `CAP-vexapp-sessions-create` |
| `preload.ipc.sessions.list()` | Sidebar session list; shell cache invalidation | `CAP-vexapp-sessions-list` |
| `preload.ipc.sessions.get()` | Session details view | `CAP-vexapp-sessions-get` |
| `preload.ipc.sessions.delete()` | Session delete action | `CAP-vexapp-sessions-delete` |
| `preload.ipc.sessions.setPinned()` | Sidebar pin toggle | `CAP-vexapp-sessions-set-pinned` |
| `preload.ipc.sessions.getModel()` | Session mode reader for UI branching | `CAP-vexapp-sessions-get-model` |

---

## Internal Flow

### Chat Submit (Happy Path)

```
1. Renderer calls preload.ipc.chat.submit({sessionId, message})
   ↓
2. Preload generates requestId (UUID), wraps in RequestEnvelope, invoke IPC
   ↓
3. registerHandler validates trusted sender (app://vex or dev 127.0.0.1:5173)
   ↓
4. registerHandler parses envelope via chatSubmitInputSchema (Zod)
   ↓
5. Handler calls getSessionById(sessionId)
   → If not found: return err(sessionNotFoundError(...))
   ↓
6. If session.mode === "mission" and initialGoal unset:
     → setInitialMissionGoalIfUnset(sessionId, message)
     → treatedAsInitialGoal = true
   ↓
7. Handler calls ensureEngineDbUrl(requestId)
   → buildPoolConfig() → makePostgresUrl()
   → set process.env.VEX_DB_URL if differs
   → closePool() (idempotent)
   ↓
8. Dynamic import @vex-agent/engine/index.js
   → submitOperatorInstruction(sessionId, message, ctx.signal)
   ↓
9. Engine ingress processes turn, returns {text, toolCallsMade, pendingApprovals, stopReason, missionStatus}
   ↓
10. registerHandler validates result via chatSubmitResultSchema (outputSchema defense-in-depth)
   ↓
11. Return ok({text, toolCallsMade, pendingApprovals, stopReason, missionStatus, treatedAsInitialGoal})
   ↓
12. Renderer receives {ok: true, data: {...}}
   ↓
13. (Async) Engine emits transcript events → transcriptBus → main bridges to renderer
```

**Error path:** If step 8 throws and `cause.message === "No inference provider available"` → `err(providerUnavailableError(...))`. Otherwise → `err(chatFailedError(...))`.

### Mission Start (Prepare-and-Dispatch)

```
1. Renderer calls preload.ipc.mission.start({sessionId, missionId})
   ↓
2. registerHandler validates sender, parses input
   ↓
3. ensureEngineDbUrl(requestId)
   ↓
4. Dynamic import @vex-agent/engine/core/runner/mission.js
   → prepareMissionStart({missionId, sessionId})
   (Sync: atomic gate, lease claim, mission_runs INSERT, returns outcome)
   ↓
5. If outcome !== "prepared":
     → mapRejection(outcome) → return ok({outcome: "mission_not_found" | "session_mismatch" | ...})
   ↓
6. If outcome === "prepared":
     → Extract {runId, missionId, sessionId} from prepared.prepared
     ↓
7. Call dispatchPreparedMission(() => runPreparedMissionStart(prepared.prepared), {sessionId, missionId, missionRunId: runId, correlationId, channelLabel})
     (Fire-and-forget: no await, background task logs failures + emits bug reports)
     ↓
8. emitControlStateAfterChange(sessionId, requestId) — post-commit state read + controlStateBus emit
   ↓
9. Return ok({outcome: "dispatched", missionRunId: runId, sessionId}) BEFORE background runner completes
   ↓
10. Renderer receives {ok: true, data: {outcome: "dispatched", ...}}
    ↓
11. (Async in main) runPreparedMissionStart runs turn loop, emits transcript events, finalizes on error
```

### Runtime Resume (Shared Dispatcher)

```
1. Renderer calls preload.ipc.runtime.requestResume({sessionId})
   OR preload.ipc.mission.continue({sessionId}) [synonym]
   ↓
2. registerHandler validates sender, parses input
   ↓
3. runResumeDispatch(input, {requestId, channelLabel})
   ↓
4. ensureEngineDbUrl(requestId)
   ↓
5. getActiveRunForSession(sessionId) → read mission_runs + runner_leases + pending control requests
   ↓
6. If !hasActiveRun → return ok({outcome: "no_active_run"})
   ↓
7. If status === "running" → return ok({outcome: "already_running", runId})
   ↓
8. If status === "paused_approval" → return ok({outcome: "blocked_approval", pendingApprovalId: ...})
   ↓
9. If status === "terminal" → return ok({outcome: "blocked_error", reason: status})
   ↓
10. (status is paused_user or paused_wake)
    → enqueueRequest({sessionId, missionRunId, kind: "resume", requestedBy: "user", correlationId})
    ↓
11. Dynamic import @vex-agent/engine/runtime/lease-and-status.js
    → claimRunLeaseAndFlipToRunning({sessionId, missionRunId, fromStatuses: [status], ownerId: "ipc-resume-<uuid>", ttlMs: 5min})
    ↓
12. If claim.outcome === "lease_busy":
      → markFailed(auditRequest.id, "lease_busy")
      → emitControlStateAfterChange()
      → return ok({outcome: "lease_busy", retryAfterMs})
    ↓
13. If claim.outcome === "status_mismatch":
      → markFailed(auditRequest.id, "status_changed")
      → return ok({outcome: "blocked_error", reason: "status_changed"})
    ↓
14. markObserved(auditRequest.id)
    ↓
15. createLeaseHandle(lease, ownerId, ttlMs)
    ↓
16. Fire-and-forget: resumeMissionRun(runId) in background
      → markCleared(auditRequest.id, "resumed") on success
      → markFailed(auditRequest.id, "continuation_failed") on error + bug-report emit
      → releaseLeaseAndEmitControlState(handle, sessionId) in finally
    ↓
17. emitControlStateAfterChange(sessionId, requestId) (post-enqueue state read)
    ↓
18. Return ok({outcome: "resumed", runId}) BEFORE background runner completes
```

### Approval Resolve (Approve/Reject)

```
1. Renderer calls preload.ipc.approvals.approve({id})
   OR preload.ipc.approvals.reject({id})
   ↓
2. registerHandler validates sender, parses input
   ↓
3. ensureEngineDbUrl(requestId)
   ↓
4. Dynamic import @vex-agent/engine/core/approval-runtime.js
   → prepareApprove(id) [or prepareReject(id)]
   (Sync: decision tx, post-tx side effects, optional continuation)
   ↓
5. If outcome is an error (ApprovalDispatchError, ApprovalDecisionInconsistencyError):
     → return err(approvalsDispatchFailedError(...)) or err(approvalsUnexpectedError(...))
   ↓
6. If outcome is successful with optional continuation:
     → dispatchPreparedMission(() => runResumeAfterDecision(continuation), {...})
     ↓
7. mapApproveOutcome(outcome) → return ok({...})
   ↓
8. (F3 bridge) Approval resolve invalidates pending-approvals, approval-history(prefix), transcript, runtime-state queries via reactive dependencies
```

---

## Dependencies

- **Electron IPC** — `ipcMain.handle()`, `ipcMain.removeHandler()`, `IpcMainInvokeEvent`.
- **@vex-agent/engine** — dynamic imports of `submitOperatorInstruction`, `prepareMissionStart`, `runPreparedMissionStart`, `prepareApprove`, `prepareReject`, `sweepExpiredApprovals`, `resumeMissionRun`, engine runtime helpers (lease-and-status, lease-handle, release-and-emit).
- **Shared Schemas** — Zod schemas for chat, mission, runtime, approvals, sessions, cancel, envelope.
- **Internal Registers** — `cancelRegistry` Map, `globalCleanup` (lifecycle/cleanup-registry.ts), `controlStateBus` (from engine), `transcriptBus` (from engine).
- **Internal DB Helpers** — `getSessionById`, `getActiveRunForSession`, `listPendingForSession`, `getApprovalById`, `getHistoryForSession`, `createSession`, repo operations on `runtime_control_requests`.
- **Logging** — main logger with structured correlation IDs.

---

## Cross-References

**Round 1 IPC Architecture (ADR-0001):** Preload trusted boundary; main-process monopoly on engine import; renderer untrusted UI.

**Fix Plan F3 (Approval Invalidation):** Approval resolve changes trigger reactive invalidations (pending-approvals, history with prefix filter, transcript, runtime-state).

**Fix Plan F4 (OpenRouter Provider Availability — OPEN):** `OpenRouterProvider.loadConfig()` (src/vex-agent/inference/openrouter.ts:98) calls `this.client.models.list({})` EVERY TURN in runners (mission.ts:41, agent.ts:..., etc.). Transient OpenRouter API failure → returns `null` → engine throws "No inference provider available" → chat handler classifies as `provider.unavailable`. Evidence: openrouter.ts:105 dynamic API call per `loadConfig()` invocation; no caching or fallback fallback.

**Fix Plan F6 (Runtime Result Schema Variance — RESOLVED (Bundle B)):** 
- The legacy generic `runtimeRequestResultSchema` / `RuntimeRequestResult` alias (formerly a "status/message/missionRunId" shape from puzzle 01) was DELETED from `vex-app/src/shared/schemas/runtime.ts` (along with its legacy test). The type no longer exists; the schema file now ends with `ControlStateEvent` (~runtime.ts:171).
- Per-action schemas (runtimeRequestPauseResultSchema, runtimeRequestResumeResultSchema, runtimeRequestStopResultSchema, runtimeCancelWakeResultSchema) are discriminated unions (puzzle 03) and are now the sole result contract.
- `RuntimeBridge` (`vex-app/src/shared/types/bridge/agent/runtime.ts`) + the 4 renderer mutation hooks now use the per-action discriminated unions (`RuntimeRequestPauseResult`, `RuntimeRequestStopResult`, `RuntimeRequestResumeResult`, `RuntimeCancelWakeResult`). Preload `runtime.ts` is unchanged — `satisfies RuntimeBridge` re-infers the per-action `T`; `tsc --noEmit` is clean.
- **No mismatch in live code:** each handler explicitly declares its per-action output schema, and the bridge/renderer types match.

---

## Open Questions

### F4: OpenRouter Load Config Per-Turn
**Status:** Confirmed OPEN.

**Evidence:** `src/vex-agent/inference/openrouter.ts:98–144` — `loadConfig()` method calls `this.client.models.list({})` unconditionally (line 105). Every engine runner that calls `provider.loadConfig()` triggers this API call:
- `compact-jobs/chunker-call.ts:` dynamic chunker inference
- `core/runner/mission.ts:` mission turn loop
- `core/runner/agent.ts:` agent turn loop (setup + runtime)
- `core/runner/recover-prepare.ts:` recovery prepare
- `core/runner/mission-prepare.ts:` mission setup turn
- `core/runner/setup-turn.ts:` initial setup turn
- `subagents/runner.ts:` subagent inference

**Question:** Is caching of the model list response (`found` match + pricing) expected, or is the per-turn API call intentional? If transient OpenRouter outage occurs:
- `loadConfig()` catches, logs, returns `null` (line 143).
- Chat handler sees "No inference provider available" → `err(providerUnavailableError(...))`.
- User sees "No inference provider is available. Unlock Vex or complete provider setup, then retry."
- This is not a Vex bug; it is correct error classification for a provider outage.

**Recommendation:** Document expected behavior in provider-loader or inference/types.ts so future maintainers know this is not a leak or optimization miss.

---

### F6: RuntimeRequestResult Legacy vs Per-Action Schemas
**Status:** RESOLVED (Bundle B) — legacy alias deleted; bridge/renderer now use per-action schemas.

**Resolution:** The legacy generic `runtimeRequestResultSchema` / `RuntimeRequestResult` alias was DELETED from `vex-app/src/shared/schemas/runtime.ts` (along with its legacy test). The type no longer exists; the schema file now ends with `ControlStateEvent` (~runtime.ts:171). `RuntimeBridge` (`vex-app/src/shared/types/bridge/agent/runtime.ts`) + the 4 renderer mutation hooks were migrated to the per-action discriminated unions. Preload `runtime.ts` is unchanged — `satisfies RuntimeBridge` re-infers the per-action `T`; `tsc --noEmit` is clean.

**Evidence (historical analysis, retained):** 
- `shared/schemas/runtime.ts:70–107` — Per-action discriminated unions (pauseResult, stopResult, resumeResult, wakeResult) — now the sole result contract.
- Live handlers (puzzle 03+):
  - `runtime/get-state.ts:24` declares `outputSchema: runtimeStateDtoSchema`
  - `runtime/request-pause.ts:32` declares `outputSchema: runtimeRequestPauseResultSchema`
  - `runtime/request-resume.ts:20` declares `outputSchema: runtimeRequestResumeResultSchema`
  - `runtime/request-stop.ts` declares `outputSchema: runtimeRequestStopResultSchema`
  - `runtime/cancel-wake.ts` declares `outputSchema: runtimeCancelWakeResultSchema`
- Formerly a puzzle-01 placeholder (`runtimeRequestResultSchema`, ~runtime.ts:180) was retained only for an old `getState` stub test scaffold; both the schema and that scaffold have now been removed.

**Conclusion:** No variance in live handlers, and the bridge/renderer types now match the per-action schemas. The backwards-compat placeholder has been removed.

---

### Mission Lifecycle: Unrewired Handlers?
**Status:** Confirmed all handlers are wired.

Evidence from `mission/index.ts:24–38`:
- `registerMissionStartHandler()` ✓
- `registerMissionContinueHandler()` ✓
- `registerMissionRecoverHandler()` ✓
- `registerMissionRewindHandler()` ✓
- `registerMissionRestoreHandler()` ✓
- `registerMissionRenewHandler()` ✓
- `registerMissionStopHandler()` ✓
- `registerMissionGetDraftHandler()` ✓
- `registerMissionGetDiffHandler()` ✓
- `registerMissionAcceptContractHandler()` ✓
- `registerMissionUpdateDraftHandler()` ✓
- `registerMissionGetRenewableSourceHandler()` ✓

No `abortMissionRun`, `retryActiveMissionRun`, or `stopActiveMissionForEdit` handlers found in codebase (Round-1 flag confirmed resolved).

---

### Handlers Bypassing registerHandler?
**Status:** Confirmed none.

Evidence from `grep -r "ipcMain.handle\|ipcMain.on" vex-app/src/main/ipc`:
- Only `register-handler.ts:360` calls `ipcMain.handle()`.
- All 40+ IPC handlers in the tree call `registerHandler()` as their registration mechanism.

---

## Refresh Triggers

- Changes to `vex-app/src/main/ipc/**/*.ts` (all handlers + shared dispatchers).
- Changes to `vex-app/src/shared/schemas/{chat,mission,runtime,approvals,sessions,cancel}.ts` (contract boundaries).
- Changes to `src/vex-agent/engine/ingress.ts` or `core/runner/mission.ts` (engine entry points / turn loop).
- Changes to `src/vex-agent/engine/core/approval-runtime.ts` (approval decision semantics).
- Changes to `globalCleanup` lifecycle (app quit handler ordering).

---

## Final Notes

This orchestration layer is the critical trust boundary between untrusted renderer UI and the canonical engine runtime. Every handler must validate input at the boundary, output at the boundary, and never expose raw engine shapes or secrets. Cancellation is always respectable via `AbortSignal`; fire-and-forget continuations always include audit trails and bug-report sinks. The renderer sees only DTOs, control-state events, and error codes—never internal IDs, lease owners, or raw Postgres rows.

