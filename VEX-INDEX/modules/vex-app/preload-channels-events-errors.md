---
id: module.vex-app.preload-channels-events-errors
kind: module
title: Preload IPC Channels, Events, Error Codes, and Contracts
paths:
  - vex-app/src/preload/**/*.ts
  - vex-app/src/shared/ipc/channels.ts
  - vex-app/src/shared/ipc/result.ts
  - vex-app/src/shared/ipc/envelope.ts
  - vex-app/src/renderer/vex.d.ts
  - vex-app/src/main/ipc/register-handler.ts
  - vex-app/src/main/ipc/register-all.ts
  - vex-app/src/shared/types/bridge/**/*.ts
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change:
  - vex-app/src/shared/ipc/channels.ts
  - vex-app/src/shared/ipc/result.ts
  - vex-app/src/shared/ipc/envelope.ts
  - vex-app/src/preload/**/*.ts
  - vex-app/src/renderer/vex.d.ts
  - vex-app/src/main/ipc/register-handler.ts
  - vex-app/src/main/ipc/register-all.ts
  - vex-app/src/shared/types/bridge/**/*.ts
related:
  - module.vex-app.shared-schemas-bridge-types
  - module.vex-app.main-bootstrap-lifecycle
  - module.vex-app.main-ipc-engine-orchestration
  - module.vex-app.renderer-appshell-runtime
  - module.vex-app.renderer-onboarding-bootstrap-secrets
  - module.vex-agent.engine-runtime-events
---

## Purpose

Deep inventory of the Vex Electron preload bridge: every IPC channel (request/response), event (push), error code, and validation contract. Documents the three-layer validation boundary (preload Zod schema, main register-handler Zod schema, output/error envelope validation) that protects the untrusted renderer from receiving malformed or secret-leaking data. This module is the authoritative source for:

- **Channel constants (CH):** all 92 request/response channels across 24 domains
- **Event constants (EV):** all 10 push events across 6 domains  
- **Error codes:** 54 domain-specific codes + 5 reserved domains for `feature_unavailable`
- **Domain registry:** 29 `VexDomain` values partitioned into shell (vex-app integration) and agent (vex-agent runtime integration)
- **Reserved/unbridged channels:** channels defined in the constant list but not yet bridged to the renderer (e.g., `CH.onboarding.providerListModels`). Note: `EV.engine.controlState` is now bridged as of Bundle B (F5 RESOLVED).
- **Validation guarantees:** Zod schema enforcement at boundaries, malformed error shape rejection, correlation ID tracking

---

## Retrieval Keywords

- `window.vex`, `contextBridge`, `exposeInMainWorld`
- Request channel: `vex:domain:action` (CH constants)
- Event channel: `vex:event:domain:topic` (EV constants)
- Cancel channel: `vex:cancel`
- `VEX_DOMAINS` (29 values), `VEX_ERROR_CODES` (54 values)
- Preload validation: `invokeWithSchema`, `abortableInvoke`, `subscribe`
- Main validation: `registerHandler`, `requestEnvelopeSchema`
- Error contract: `VexError`, `Result<T, E>`, `correlationId`
- Unbridged/reserved channels: `CH.onboarding.providerListModels`, `CH.onboarding.providerTest`, `CH.updater.check`, `EV.system.*`, `EV.docker.daemonChanged`, `EV.updater.available` (`EV.engine.controlState` is now bridged — F5 RESOLVED, Bundle B)

---

## State Owned

None. Preload is a pure bridge module: stateless composition of typed methods that forward calls to main via IPC. No caching, no local state, no subscriptions beyond event forwarding.

---

## Boundary Crossings

```
Renderer (untrusted)
  ↓
window.vex.* (type-safe method surface)
  ↓
Preload (trusted, validates input)
  → ipcRenderer.invoke(CH.*, RequestEnvelope)
  → ipcRenderer.on(EV.*, payload)
  ↓
Main process (trusted, re-validates + normalizes)
  → registerHandler: Zod parse + AbortController + output/error validation
  → IPC event broadcast: broadcastToAllWindows(EV.*, schema-validated payload)
  ↓
Preload (re-validates event payload via subscribe() schema)
  ↓
Renderer (receives only Zod-validated shapes)
```

**Trust model:**
- Renderer input is `unknown` until preload Zod schema succeeds.
- Main-side Zod schema re-validates as defense-in-depth (catches preload bugs or compromised preload).
- Error shapes are runtime-guarded by `isValidVexErrorShape()` before serialization to renderer.
- No secrets, stack traces, or PII may appear in error messages or correlation IDs.

---

## File Map

### Preload bridge composition

- `vex-app/src/preload/index.ts:34` — Root composer: exposes `api` (shellBridge + agentBridge) on `window.vex`
- `vex-app/src/preload/_dispatch.ts:44–117` — Internal dispatch helpers:
  - `invokeWithSchema(channel, payload, inputSchema)` — Zod-validated invoke with requestId + correlationId
  - `abortableInvoke(channel, payload, inputSchema)` — Same, returns cancellable promise
  - `subscribe(channel, schema, cb)` — Event subscription with payload re-validation
  - `newRequestId()` — UUID generator (line 28)
  - `preloadValidationError()` — Error factory for preload-side schema failures (line 32)

### Shell bridge domains (vex-app integration)

- `vex-app/src/preload/shell/index.ts:29–40` — Composer: combines all shell domains
- `vex-app/src/preload/shell/capabilities.ts:5–9` — `capabilities.get()`
- `vex-app/src/preload/shell/system.ts:5–15` — `system.health()`, `.osInfo()`, `.network()`
- `vex-app/src/preload/shell/docker.ts:16–50` — `docker.detect()`, `.install()`, `.start()`, `.composeUp()`, `.composeUpAbortable()`, `.composeDown()`, `.onInstallProgress()`, `.onComposeLog()`
- `vex-app/src/preload/shell/database.ts:6–13` — `database.migrate()`, `.onProgress()`
- `vex-app/src/preload/shell/secrets.ts:10–20` — `secrets.status()`, `.unlock()`, `.lock()`
- `vex-app/src/preload/shell/wallet.ts` — `wallet.exportPrivateKey()`
- `vex-app/src/preload/shell/onboarding.ts:48–130+` — Onboarding wizard surface (24 methods)
- `vex-app/src/preload/shell/settings.ts:10–21` — `settings.getPreferences()`, `.setTelemetryConsent()`
- `vex-app/src/preload/shell/telemetry.ts` — `telemetry.reportRendererError()`
- `vex-app/src/preload/shell/support.ts` — `support.createBugReport()`

### Agent bridge domains (vex-agent runtime integration)

- `vex-app/src/preload/agent/index.ts:32–46` — Composer: combines all agent domains
- `vex-app/src/preload/agent/sessions.ts` — `sessions.create()`, `.list()`, `.get()`, `.setPinned()`, `.delete()`, `.getModel()`
- `vex-app/src/preload/agent/chat.ts` — `chat.submit()` (abortable)
- `vex-app/src/preload/agent/messages.ts` — `messages.list()`, `.getTail()`, `.getAround()`
- `vex-app/src/preload/agent/runtime.ts` — `runtime.getState()`, `.requestPause()`, `.requestStop()`, `.requestResume()`, `.cancelWake()`
- `vex-app/src/preload/agent/mission.ts` — `mission.getDraft()`, `.updateDraft()`, `.getDiff()`, `.acceptContract()`, `.start()`, `.continue()`, `.recover()`, `.rewind()`, `.restore()`, `.renew()`, `.stop()`, `.getRenewableSource()`
- `vex-app/src/preload/agent/approvals.ts` — `approvals.listPending()`, `.get()`, `.approve()`, `.reject()`, `.getHistory()`
- `vex-app/src/preload/agent/wallets.ts` — `wallets.listAvailable()`, `.listSessionWallets()`, `.setSessionWalletScope()`, `.getPreparedIntent()`, `.cancelPreparedIntent()`
- `vex-app/src/preload/agent/models.ts` — `models.listAvailable()`
- `vex-app/src/preload/agent/usage.ts` — `usage.getSessionTotals()`, `.getLastTurn()`, `.getContextWindow()`
- `vex-app/src/preload/agent/compaction.ts` — `compaction.getStatus()`, `.listHistory()`, `.retry()`
- `vex-app/src/preload/agent/knowledge.ts` — `knowledge.list()`, `.updateStatus()`
- `vex-app/src/preload/agent/memory.ts` — `memory.listSession()`, `.getStats()`
- `vex-app/src/preload/agent/engine.ts:16–21` — `engine.onTranscriptAppend()`, `.onStreamDelta()`, `.onControlState()` (F5 RESOLVED, Bundle B — `onControlState` subscribes to `EV.engine.controlState` and re-validates via `controlStateEventSchema`)

### IPC contract definitions

- `vex-app/src/shared/ipc/channels.ts:12–240` — Constants:
  - **CH constant object** (lines 12–239): 92 channel name strings organized by domain
  - **EV constant object** (lines 243–284): 10 event name strings organized by domain
  - Domain coverage: capabilities, system, docker, database, secrets, wallet, onboarding (24 methods), sessions, chat, messages, runtime, mission, approvals, wallets, models, usage, compaction, knowledge, memory, settings, updater, telemetry, support

- `vex-app/src/shared/ipc/result.ts:8–325` — Error + domain contracts:
  - **VexDomain union** (lines 16–76): 29 domain values (type alias)
  - **VexErrorCode union** (lines 78–171): 54 error code values (type alias)
  - **VEX_ERROR_CODES array** (lines 207–262): Runtime mirror of error code union (54 entries)
  - **VEX_DOMAINS array** (lines 265–295): Runtime mirror of domain union (29 entries)
  - **VexError interface** (lines 173–197): error shape with code, domain, message, retryable, userActionable, redacted, details, correlationId, retryAfterMs
  - **Result<T, E>** (lines 297–299): Discriminated union of `{ ok: true, data: T }` and `{ ok: false, error: E }`
  - **assertNever()** (line 309): exhaustiveness helper for switches
  - Type-level exhaustiveness checks (lines 318–324) ensure VEX_ERROR_CODES/VEX_DOMAINS arrays stay in sync with unions

- `vex-app/src/shared/ipc/envelope.ts:1–19` — Request envelope:
  - **requestEnvelopeSchema<T>** (lines 8–14): Zod schema factory for `{ requestId: string, payload: T }`
  - **RequestEnvelope<T>** (lines 16–19): TypeScript type

### Type contracts

- `vex-app/src/renderer/vex.d.ts:1–23` — Global window typing:
  - `declare global { interface Window { readonly vex: VexBridge } }`
  - `const __VEX_APP_VERSION__: string` injected at build time

- `vex-app/src/shared/types/bridge.ts:1–47` — Legacy barrel re-export of VexBridge

- `vex-app/src/shared/types/bridge/index.ts:1–52` — VexBridge root interface:
  - Composes `VexShellBridge` + `VexAgentBridge` with `extends` for compile-time collision guard

- `vex-app/src/shared/types/bridge/shell/index.ts` — VexShellBridge composer
- `vex-app/src/shared/types/bridge/agent/index.ts` — VexAgentBridge composer

- `vex-app/src/shared/types/bridge/shell/*.ts` — Per-domain shell bridge interfaces:
  - capabilities, system, docker, database, secrets, wallet, onboarding, settings, telemetry, support

- `vex-app/src/shared/types/bridge/agent/*.ts` — Per-domain agent bridge interfaces:
  - sessions, chat, messages, runtime, mission, approvals, wallets, models, usage, compaction, knowledge, memory, engine

- `vex-app/src/shared/types/bridge/agent/engine.ts:19–44` — EngineEventsBridge:
  - `onTranscriptAppend()` method exists
  - `onStreamDelta()` method exists
  - `onControlState()` method exists (F5 RESOLVED, Bundle B — declared on `EngineEventsBridge` and implemented in preload)

- `vex-app/src/shared/types/bridge/common.ts` — Shared types:
  - `AbortableInvocation<T>` interface (promise + cancel function)

### Main-side handlers

- `vex-app/src/main/ipc/register-handler.ts:73–95` — Trusted sender assertion
- `vex-app/src/main/ipc/register-handler.ts:97–123` — Structural summary helpers for error logging (never logs raw objects)
- `vex-app/src/main/ipc/register-handler.ts:125–179` — VexError shape runtime guard: `isValidVexErrorShape()`
- `vex-app/src/main/ipc/register-handler.ts:181–195` — Contract violation error factory
- `vex-app/src/main/ipc/register-handler.ts:197–213` — `HandlerContext` interface (requestId, event, signal: AbortSignal)
- `vex-app/src/main/ipc/register-handler.ts:215–226` — `HandlerArgs<I, O>` interface (channel, domain, inputSchema, outputSchema, handle callback)
- `vex-app/src/main/ipc/register-handler.ts:228–377` — `registerHandler(args)` main function:
  - Line 229: Envelope schema factory
  - Line 231–358: IPC handler async function
  - Line 250–264: Cancel controller registration + cleanup
  - Line 284–295: Output validation (optional)
  - Line 299–323: Error shape validation (defense-in-depth)
  - Line 325–357: Thrown error normalization (AbortError → cancelled, other → contract_violation/validation.invalid_sender)
  - Line 360: `ipcMain.handle(args.channel, fn)` registration
  - Line 362–376: Teardown function + globalCleanup integration

- `vex-app/src/main/ipc/register-all.ts:47–100+` — Centralised handler registration:
  - Calls 40+ individual `registerXxxHandlers()` functions
  - Pushes teardowns into globalCleanup
  - Bridges agent trunk (line 96): `setupAgentBridges()` subscribes engine events to IPC broadcast

### Bridge test pinning

- `vex-app/src/preload/__tests__/bridge-surface.test.ts` — Validates preload surface composition:
  - Scans all `.ts` files in preload directory recursively
  - Asserts each domain from `VexBridge` appears exactly once in `window.vex`
  - Validates no stray module-level exports leak into bridge namespace

---

## Key Types & Invariants

### Bridge exposure guarantees

1. **Preload exposes EXACTLY ONE bridge object:** `satisfies VexBridge` type guard on `api` in `preload/index.ts:34` enforces it.
2. **Every preload method validates input:** All shell/agent domain methods call either:
   - `invokeWithSchema(channel, payload, schema)` for simple requests
   - `abortableInvoke(channel, payload, schema)` for cancellable requests
   - `subscribe(channel, schema, callback)` for event subscriptions
3. **Every preload event re-validates:** Each `subscribe()` call in agent/engine or shell/docker/database passes a Zod schema that re-validates the event payload before calling the renderer callback.
4. **Main re-validates all inputs:** `registerHandler` wraps every handler with:
   - Envelope parsing via `requestEnvelopeSchema(args.inputSchema)`
   - Caller identity check via `assertTrustedSender(event)`
   - Output schema validation if provided
   - Error shape validation via `isValidVexErrorShape()`
5. **Error codes are closed-set enums:** Both `VexErrorCode` (type union) and `VEX_ERROR_CODES` (runtime array) are exhaustiveness-checked via type-level assertions at compile time.
6. **Error domains are closed-set enums:** Same pattern for `VexDomain` and `VEX_DOMAINS`.
7. **Correlation IDs never leak:** Each request generates a fresh UUID at the preload boundary; main normalizes error responses to include the original requestId even if handler returned a mismatched or missing correlationId.
8. **Cancellation is uniform:** `vex:cancel` envelope carries `correlationId` only; main-side cancel handler looks it up in the registry and calls `.abort()` on the controller if found.

### Malformed error rejection

Main-side `registerHandler` has three error-safety gates:

1. **Handler throws unguarded exception:**
   - Catch clause treats it as `unknown`
   - If it's an `AbortError`, normalize to `internal.cancelled` (user cancel) at info log level
   - Else log structural summary (type + key names, never raw object) at error level
   - Return `{ code: "validation.invalid_sender" (if untrusted frame) or "internal.contract_violation", domain: args.domain, ... }`

2. **Handler returns malformed error shape:**
   - `isValidVexErrorShape()` validates: code ∈ VEX_ERROR_CODES, domain ∈ VEX_DOMAINS, required fields present, extra fields rejected, correlationId non-empty string if present
   - Failure logs structural summary (never raw object) and returns contract_violation

3. **Handler returns invalid output data:**
   - If `args.outputSchema` provided, validate via `schema.safeParse(result.data)`
   - Failure logs Zod validation details and returns contract_violation

**Never logged:** raw error objects, handler objects, secret-bearing values, full stack traces, secrets from error.message.

### Correlation ID tracking

Every error returned to the renderer carries a `correlationId: string` that:
- Is generated at the preload boundary when input validation fails
- Is passed through the envelope to main
- Is overwritten by main if handler returned a mismatched one (logged as warn)
- Is used in all IPC handler logs: `[ipc:${args.channel}] correlationId=${requestId}`
- Is returned in every `VexError` result so renderer + main logs can be correlated

### Cancellation contract

When renderer calls `.cancel()` on an `AbortableInvocation`:
1. Renderer fires `vex:cancel` with `{ requestId, payload: { correlationId } }`
2. Cancel handler looks up `correlationId` in main's `cancelRegistry` and calls `.abort()` on the controller
3. Handler's in-flight `spawn()` / `fetch()` / custom logic observes `ctx.signal.aborted` and throws/returns
4. `registerHandler` catches `AbortError` or detects `signal.aborted` and normalizes to `internal.cancelled`
5. Renderer receives `{ ok: false, error: { code: "internal.cancelled", ... } }`

**For non-cancellable requests (e.g., simple `invokeWithSchema`):** no `cancel()` function is returned; the promise resolves once the handler completes.

---

## Capabilities (Stable IDs)

### Channel inventory: requests (CH constants)

**Total: 92 request channels across 24 domains**

| Domain | Method | CH Constant | Input Type | Return Type | Preload Bridge |
|--------|--------|------------|-----------|------------|---|
| capabilities | get | `CH.capabilities.get` | empty | `CapabilitiesState` | `capabilities.get()` |
| system | health | `CH.system.health` | empty | `SystemHealth` | `system.health()` |
| system | osInfo | `CH.system.osInfo` | empty | `OsInfo` | `system.osInfo()` |
| system | network | `CH.system.network` | empty | `NetworkStatus` | `system.network()` |
| docker | detect | `CH.docker.detect` | empty | `DockerDetectResult` | `docker.detect()` |
| docker | install | `CH.docker.install` | `{ method }` | `void` | `docker.install(input)` |
| docker | start | `CH.docker.start` | empty | `void` | `docker.start()` |
| docker | composeUp | `CH.docker.composeUp` | `{ pgPort?: number }` | `void` | `docker.composeUp()` or `docker.composeUpAbortable()` |
| docker | composeDown | `CH.docker.composeDown` | empty | `void` | `docker.composeDown()` |
| database | migrate | `CH.database.migrate` | empty | `void` | `database.migrate()` |
| database | status | `CH.database.status` | empty | `DatabaseStatus` | N/A (reserved) |
| secrets | status | `CH.secrets.status` | empty | `SecretsStatus` | `secrets.status()` |
| secrets | unlock | `CH.secrets.unlock` | `{ password }` | `void` | `secrets.unlock(input)` |
| secrets | lock | `CH.secrets.lock` | empty | `void` | `secrets.lock()` |
| wallet | exportPrivateKey | `CH.wallet.exportPrivateKey` | `{ address, password }` | `{ privateKey }` | `wallet.exportPrivateKey(input)` |
| onboarding | getEnvState | `CH.onboarding.getEnvState` | empty | `EnvState` | `onboarding.getEnvState()` |
| onboarding | getWizardState | `CH.onboarding.getWizardState` | empty | `WizardState` | `onboarding.getWizardState()` |
| onboarding | setWizardState | `CH.onboarding.setWizardState` | `{ step }` | `void` | `onboarding.setWizardState(input)` |
| onboarding | keystoreSet | `CH.onboarding.keystoreSet` | `{ password }` | `void` | `onboarding.keystoreSet(input)` |
| onboarding | walletGenerateEvm | `CH.onboarding.walletGenerateEvm` | empty | `{ address, publicKey }` | `onboarding.walletGenerateEvm()` |
| onboarding | walletImportEvm | `CH.onboarding.walletImportEvm` | `{ privateKey }` | `{ address, publicKey }` | `onboarding.walletImportEvm(input)` |
| onboarding | walletGenerateSolana | `CH.onboarding.walletGenerateSolana` | empty | `{ address, publicKey }` | `onboarding.walletGenerateSolana()` |
| onboarding | walletImportSolana | `CH.onboarding.walletImportSolana` | `{ secretKey }` | `{ address, publicKey }` | `onboarding.walletImportSolana(input)` |
| onboarding | walletRestoreFromBackup | `CH.onboarding.walletRestoreFromBackup` | `{ backupPath }` | `{ keystores }` | `onboarding.walletRestoreFromBackup(input)` |
| onboarding | walletOpenBackupFolder | `CH.onboarding.walletOpenBackupFolder` | empty | `void` | `onboarding.walletOpenBackupFolder()` |
| onboarding | walletAddEvm | `CH.onboarding.walletAddEvm` | empty | `{ address, publicKey }` | `onboarding.walletAddEvm()` |
| onboarding | walletAddSolana | `CH.onboarding.walletAddSolana` | empty | `{ address, publicKey }` | `onboarding.walletAddSolana()` |
| onboarding | walletImportAddEvm | `CH.onboarding.walletImportAddEvm` | `{ privateKey }` | `{ address, publicKey }` | `onboarding.walletImportAddEvm(input)` |
| onboarding | walletImportAddSolana | `CH.onboarding.walletImportAddSolana` | `{ secretKey }` | `{ address, publicKey }` | `onboarding.walletImportAddSolana(input)` |
| onboarding | walletExportAll | `CH.onboarding.walletExportAll` | empty | `{ keystores }` | `onboarding.walletExportAll()` |
| onboarding | apiKeysSet | `CH.onboarding.apiKeysSet` | `{ keys: { provider, apiKey }[] }` | `void` | `onboarding.apiKeysSet(input)` |
| onboarding | polymarketAutoSetup | `CH.onboarding.polymarketAutoSetup` | `{ apiKey }` | `{ status }` | `onboarding.polymarketAutoSetup(input)` |
| onboarding | polymarketConfiguredAddresses | `CH.onboarding.polymarketConfiguredAddresses` | empty | `{ addresses: string[] }` | `onboarding.polymarketConfiguredAddresses()` |
| onboarding | embeddingConfigure | `CH.onboarding.embeddingConfigure` | `{ dimension }` | `void` | `onboarding.embeddingConfigure(input)` |
| onboarding | agentCoreConfigure | `CH.onboarding.agentCoreConfigure` | `{ env: Record<string, string> }` | `void` | `onboarding.agentCoreConfigure(input)` |
| onboarding | providerListModels | `CH.onboarding.providerListModels` | `{ provider }` | `{ models: string[] }` | N/A (**reserved**) |
| onboarding | providerTest | `CH.onboarding.providerTest` | `{ provider, apiKey }` | `{ working }` | N/A (**reserved**) |
| onboarding | providerPersist | `CH.onboarding.providerPersist` | `{ provider, apiKey, model }` | `void` | `onboarding.providerPersist(input)` |
| onboarding | completeSetup | `CH.onboarding.completeSetup` | empty | `void` | `onboarding.completeSetup()` |
| sessions | create | `CH.sessions.create` | `{ label }` | `{ sessionId }` | `sessions.create(input)` |
| sessions | list | `CH.sessions.list` | empty | `{ sessions: SessionDTO[] }` | `sessions.list()` |
| sessions | get | `CH.sessions.get` | `{ sessionId }` | `{ session: SessionDTO }` | `sessions.get(input)` |
| sessions | setPinned | `CH.sessions.setPinned` | `{ sessionId, pinned }` | `void` | `sessions.setPinned(input)` |
| sessions | delete | `CH.sessions.delete` | `{ sessionId }` | `void` | `sessions.delete(input)` |
| sessions | getModel | `CH.sessions.getModel` | `{ sessionId }` | `{ model, provider }` | `sessions.getModel(input)` |
| chat | submit | `CH.chat.submit` | `{ sessionId, input }` | `{ messageId, stopReason }` | `chat.submit(input)` (abortable) |
| messages | list | `CH.messages.list` | `{ sessionId, skip, take }` | `{ messages: MessageDTO[], total }` | `messages.list(input)` |
| messages | getTail | `CH.messages.getTail` | `{ sessionId, limit }` | `{ messages: MessageDTO[] }` | `messages.getTail(input)` |
| messages | getAround | `CH.messages.getAround` | `{ sessionId, messageId, limit }` | `{ messages: MessageDTO[] }` | `messages.getAround(input)` |
| runtime | getState | `CH.runtime.getState` | `{ sessionId }` | `{ run: RuntimeState }` | `runtime.getState(input)` |
| runtime | requestPause | `CH.runtime.requestPause` | `{ sessionId }` | `void` | `runtime.requestPause(input)` |
| runtime | requestStop | `CH.runtime.requestStop` | `{ sessionId }` | `void` | `runtime.requestStop(input)` |
| runtime | requestResume | `CH.runtime.requestResume` | `{ sessionId }` | `void` | `runtime.requestResume(input)` |
| runtime | cancelWake | `CH.runtime.cancelWake` | `{ sessionId }` | `void` | `runtime.cancelWake(input)` |
| mission | getDraft | `CH.mission.getDraft` | `{ sessionId }` | `{ draft: MissionDraft }` | `mission.getDraft(input)` |
| mission | updateDraft | `CH.mission.updateDraft` | `{ sessionId, draft }` | `void` | `mission.updateDraft(input)` |
| mission | getDiff | `CH.mission.getDiff` | `{ sessionId }` | `{ diff: MissionDiff }` | `mission.getDiff(input)` |
| mission | acceptContract | `CH.mission.acceptContract` | `{ sessionId, command }` | `void` | `mission.acceptContract(input)` |
| mission | start | `CH.mission.start` | `{ sessionId }` | `{ runId }` | `mission.start(input)` |
| mission | continue | `CH.mission.continue` | `{ sessionId }` | `{ runId }` | `mission.continue(input)` |
| mission | recover | `CH.mission.recover` | `{ sessionId }` | `{ runId }` | `mission.recover(input)` |
| mission | rewind | `CH.mission.rewind` | `{ sessionId, index }` | `void` | `mission.rewind(input)` |
| mission | restore | `CH.mission.restore` | `{ sessionId, archived }` | `void` | `mission.restore(input)` |
| mission | renew | `CH.mission.renew` | `{ sessionId }` | `{ runId }` | `mission.renew(input)` |
| mission | stop | `CH.mission.stop` | `{ sessionId }` | `void` | `mission.stop(input)` |
| mission | getRenewableSource | `CH.mission.getRenewableSource` | `{ sessionId, runId }` | `{ source }` | `mission.getRenewableSource(input)` |
| approvals | listPending | `CH.approvals.listPending` | `{ sessionId }` | `{ approvals: ApprovalDTO[] }` | `approvals.listPending(input)` |
| approvals | get | `CH.approvals.get` | `{ sessionId, approvalId }` | `{ approval: ApprovalDTO }` | `approvals.get(input)` |
| approvals | approve | `CH.approvals.approve` | `{ sessionId, approvalId }` | `void` | `approvals.approve(input)` |
| approvals | reject | `CH.approvals.reject` | `{ sessionId, approvalId, reason }` | `void` | `approvals.reject(input)` |
| approvals | getHistory | `CH.approvals.getHistory` | `{ sessionId, skip, take }` | `{ approvals: ApprovalDTO[], total }` | `approvals.getHistory(input)` |
| wallets | listAvailable | `CH.wallets.listAvailable` | empty | `{ wallets: WalletDTO[] }` | `wallets.listAvailable()` |
| wallets | listSessionWallets | `CH.wallets.listSessionWallets` | `{ sessionId }` | `{ wallets: WalletDTO[] }` | `wallets.listSessionWallets(input)` |
| wallets | setSessionWalletScope | `CH.wallets.setSessionWalletScope` | `{ sessionId, walletIds }` | `void` | `wallets.setSessionWalletScope(input)` |
| wallets | getPreparedIntent | `CH.wallets.getPreparedIntent` | `{ sessionId, walletId, action }` | `{ intent: PreparedIntent }` | `wallets.getPreparedIntent(input)` |
| wallets | cancelPreparedIntent | `CH.wallets.cancelPreparedIntent` | `{ sessionId, intentId }` | `void` | `wallets.cancelPreparedIntent(input)` |
| models | listAvailable | `CH.models.listAvailable` | `{ appScoped? }` | `{ models: ModelDTO[] }` | `models.listAvailable(input)` |
| usage | getSessionTotals | `CH.usage.getSessionTotals` | `{ sessionId }` | `{ totals: UsageDTO }` | `usage.getSessionTotals(input)` |
| usage | getLastTurn | `CH.usage.getLastTurn` | `{ sessionId, messageId }` | `{ usage: UsageDTO }` | `usage.getLastTurn(input)` |
| usage | getContextWindow | `CH.usage.getContextWindow` | `{ sessionId }` | `{ contextWindow: ContextWindowDTO }` | `usage.getContextWindow(input)` |
| compaction | getStatus | `CH.compaction.getStatus` | `{ sessionId }` | `{ status: CompactionStatus }` | `compaction.getStatus(input)` |
| compaction | listHistory | `CH.compaction.listHistory` | `{ sessionId, skip?, take? }` | `{ jobs: CompactionJob[], total }` | `compaction.listHistory(input)` |
| compaction | retry | `CH.compaction.retry` | `{ sessionId, generationId }` | `void` | `compaction.retry(input)` |
| knowledge | list | `CH.knowledge.list` | `{ skip?, take? }` | `{ knowledge: KnowledgeDTO[], total }` | `knowledge.list(input)` |
| knowledge | updateStatus | `CH.knowledge.updateStatus` | `{ knowledgeId, status }` | `void` | `knowledge.updateStatus(input)` |
| memory | listSession | `CH.memory.listSession` | `{ sessionId, skip?, take? }` | `{ memories: MemoryDTO[], total }` | `memory.listSession(input)` |
| memory | getStats | `CH.memory.getStats` | `{ sessionId }` | `{ stats: MemoryStats }` | `memory.getStats(input)` |
| settings | getPreferences | `CH.settings.getPreferences` | empty | `{ preferences: PreferencesDTO }` | `settings.getPreferences()` |
| settings | setTelemetryConsent | `CH.settings.setTelemetryConsent` | `{ enabled }` | `void` | `settings.setTelemetryConsent(input)` |
| updater | check | `CH.updater.check` | empty | `{ available, version }` | N/A (**reserved**) |
| telemetry | reportRendererError | `CH.telemetry.reportRendererError` | `{ error, context }` | `void` | `telemetry.reportRendererError(input)` |
| support | createBugReport | `CH.support.createBugReport` | `{ title, description, logs }` | `{ reportId }` | `support.createBugReport(input)` |
| (cancel) | (cancel) | `CH.cancel` | `{ correlationId }` | `{ cancelled }` | N/A (internal) |

### Event inventory: push notifications (EV constants)

**Total: 10 events across 6 domains**

| Domain | Event | EV Constant | Payload Type | Preload Subscription | Status |
|--------|-------|-----------|-------------|---|---|
| system | logLine | `EV.system.logLine` | `{ line, level, timestamp }` | N/A | **unbridged** |
| system | resume | `EV.system.resume` | `{ timestamp }` | N/A | **unbridged** |
| docker | installProgress | `EV.docker.installProgress` | `{ progress, stage }` | `docker.onInstallProgress()` | ✓ bridged |
| docker | daemonChanged | `EV.docker.daemonChanged` | `{ running }` | N/A | **unbridged** |
| docker | composeLogs | `EV.docker.composeLogs` | `{ line, service }` | `docker.onComposeLog()` | ✓ bridged |
| database | migrateProgress | `EV.database.migrateProgress` | `{ progress, stage }` | `database.onProgress()` | ✓ bridged |
| updater | available | `EV.updater.available` | `{ version, releaseNotes }` | N/A | **unbridged** |
| engine | transcriptAppend | `EV.engine.transcriptAppend` | `{ sessionId, messageId }` | `engine.onTranscriptAppend()` | ✓ bridged |
| engine | streamDelta | `EV.engine.streamDelta` | `{ sessionId, delta, done }` | `engine.onStreamDelta()` | ✓ bridged |
| engine | controlState | `EV.engine.controlState` | `{ sessionId, state, leaseActive, leaseExpiresAt }` | `engine.onControlState()` | ✓ bridged (F5 RESOLVED, Bundle B) |

### Error code inventory (54 codes)

Grouped by domain and category:

#### Validation (2 codes)
- `validation.invalid_input` — Preload or main Zod schema failed; handler never invoked
- `validation.invalid_sender` — Renderer in untrusted iframe or URL

#### Permissions (1 code)
- `permissions.denied` — User lacks capability for the operation

#### Wallet (16 codes)
- `wallet.insufficient_funds` — Account balance too low
- `wallet.user_rejected` — User declined signing/approval dialog
- `wallet.risk_confirmation_required` — User must confirm high-risk action
- `wallet.policy_blocked` — Server-side policy prevents transaction
- `wallet.export_throttled` — Private key export rate-limited; includes `retryAfterMs`
- `wallet.keystore_locked` — Keystore requires password unlock
- `wallet.keystore_corrupt` — Keystore file corrupted
- `wallet.keystore_missing` — Keystore not found on disk
- `wallet.password_invalid` — Wrong password supplied
- `wallet.vault_not_configured` — Secrets vault not initialized
- `wallet.cap_reached` — Maximum wallets/addresses for session
- `wallet.address_exists` — Address already imported in keystore
- `wallet.not_found` — Requested wallet/address does not exist

#### Secrets (1 code)
- `secrets.unlock_throttled` — Too many failed unlock attempts; includes `retryAfterMs`

#### Services (4 codes)
- `services.docker_unavailable` — Docker daemon not running or unreachable
- `services.port_in_use` — Port already bound (usually PostgreSQL)
- `services.healthcheck_failed` — Service failed readiness check
- `services.compose_failed` — docker compose command failed

#### Data (1 code)
- `data.search_unavailable` — Search/pgvector unavailable (DB down)
- `data.migration_failed` — Database migration script failed

#### Update (3 codes)
- `update.check_failed` — Update check HTTP failed
- `update.download_failed` — Update binary download failed
- `update.apply_failed` — Update application failed (already running?)

#### Onboarding (2 codes)
- `onboarding.step_failed` — Step-specific failure (variant per step)
- `onboarding.env_persist_failed` — Failed to write env file

#### Embedding (3 codes)
- `embedding.dim_locked` — Dimension mismatch with existing DB embeddings
- `embedding.db_unavailable` — pgvector unavailable
- `embedding.defaults_unavailable` — Default embedding model unreachable

#### Provider (5 codes)
- `provider.invalid_api_key` — API key rejected by provider
- `provider.insufficient_credits` — Account balance too low at provider
- `provider.model_unsupported` — Model ID not recognized
- `provider.polymarket_setup_failed` — Polymarket-specific setup failed
- `provider.unavailable` — Provider service unreachable
- `provider.test_failed` — Provider test request failed

#### Support (1 code)
- `support.persist_failed` — Bug report file write failed

#### Runtime (1 code)
- `runtime.feature_unavailable` — Control method (pause/stop/resume) not yet available (fail-closed puzzle 3)

#### Mission (1 code)
- `mission.feature_unavailable` — Mission command/mutation not yet available (fail-closed puzzle 4)

#### Approvals (5 codes)
- `approvals.feature_unavailable` — Approval approval/rejection not yet available (fail-closed puzzle 5)
- `approvals.expired` — Approval window closed; auto-rejected
- `approvals.already_resolved` — Concurrent decision already made
- `approvals.run_terminated` — Mission run ended before approval was resolved
- `approvals.dispatch_failed` — Approved tool threw unhandled exception

#### Wallets (2 codes)
- `wallets.feature_unavailable` — Wallet scope/intents not yet available (fail-closed puzzle 5)
- `wallets.invalid_selection` — Selected wallet not scoped for this session

#### Knowledge (2 codes)
- `knowledge.not_found` — Knowledge entry deleted by another operator
- `knowledge.invalid_state` — Knowledge entry no longer active/disabled

#### Compaction (2 codes)
- `compaction.not_found` — Compaction job not found for (session, generation)
- `compaction.invalid_state` — Job not in permanently_failed state; cannot retry

#### Internal (3 codes)
- `internal.contract_violation` — Handler returned malformed Result<T>
- `internal.cancelled` — User cancelled in-flight request
- `internal.unexpected` — Unknown internal error (fallback)

### Domain inventory (29 values)

#### Desktop Integration (vex-app shell)
1. **wallet** — Keystore + export operations
2. **agents** — Agent orchestration (future)
3. **chat** — Chat input/transcript
4. **services** — Docker + local services
5. **data** — Database + search
6. **settings** — User preferences
7. **updater** — In-app update checks
8. **telemetry** — Error reporting (Sentry, opt-in)
9. **support** — Bug report persistence
10. **permissions** — Future authorization
11. **system** — OS info, health, network
12. **docker** — Docker detection + lifecycle
13. **database** — Migrations + status
14. **onboarding** — Wizard flows
15. **embedding** — Embedding model configuration
16. **capabilities** — Phase + feature flags

#### Runtime Integration (vex-agent)
17. **messages** — Transcript read-only
18. **runtime** — Active run control (pause/stop/resume)
19. **mission** — Draft + contract surface
20. **approvals** — Tool approval queue
21. **wallets** — Per-session wallet scope
22. **models** — Global model resolution
23. **usage** — Token usage tracking
24. **compaction** — Track-2 status + history
25. **knowledge** — Global knowledge store (read + archive)
26. **memory** — Per-session memory stats

#### Infrastructure
27. **sessions** — Multi-session management
28. **preload** — Input validation boundary errors
29. **internal** — Unexpected/contract violations

---

## Public API (Consumed By)

### Renderer-side hooks (React, TanStack Query)

All these hooks call methods on `window.vex.*`:

- `useCapabilities()` → `vex.capabilities.get()`
- `useSystemHealth()` → `vex.system.health()`
- `useDockerDetect()` → `vex.docker.detect()`
- `useDockerInstall()` → `vex.docker.install()`
- `useDockerCompose()` → `vex.docker.composeUp()` or `vex.docker.composeUpAbortable()`
- `useDatabaseMigrate()` → `vex.database.migrate()`
- `useSecretsUnlock()` → `vex.secrets.unlock()`
- `useOnboarding*()` → 24 onboarding methods
- `useSessions()` → `vex.sessions.list()`, `.get()`, etc.
- `useChat()` → `vex.chat.submit()`
- `useMessages()` → `vex.messages.list()`, `.getTail()`, etc.
- `useRuntime()` → `vex.runtime.getState()`, `.requestPause()`, etc.
- `useMission()` → `vex.mission.getDraft()`, `.start()`, etc.
- `useApprovals()` → `vex.approvals.listPending()`, `.approve()`, etc.
- `useWallets()` → `vex.wallets.listAvailable()`, `.listSessionWallets()`, etc.
- `useUsage()` → `vex.usage.getSessionTotals()`, etc.
- `useEngine()` → `vex.engine.onTranscriptAppend()`, `.onStreamDelta()` (subscription hooks)

### Main handler registration (register-all.ts)

40+ handler registration functions in `vex-app/src/main/ipc/`:

- `registerCapabilitiesHandler()` → `CH.capabilities.get`
- `registerSystemHandlers()` → 3 system channels
- `registerDockerHandlers()` → 5 docker channels + event broadcast
- `registerDatabaseHandlers()` → 2 database channels + event broadcast
- `registerSecretsHandlers()` → 3 secret channels
- `registerOnboardingHandlers()` + `registerWalletHandlers()` + `registerApiKeysHandler()` + etc. → 24 onboarding channels
- `registerSessionsCreateHandler()` + `registerSessionsListHandler()` + etc. → 6 session channels
- `registerChatSubmitHandler()` → `CH.chat.submit` (abortable)
- `registerMessagesHandlers()` → 3 message channels
- `registerRuntimeHandlers()` → 5 runtime channels
- `registerMissionHandlers()` → 12 mission channels
- `registerApprovalsHandlers()` → 5 approval channels
- `registerWalletsSessionHandlers()` → 5 wallet scope channels
- `registerModelsHandlers()` → 1 model channel
- `registerUsageHandlers()` → 3 usage channels
- `registerCompactionHandlers()` → 3 compaction channels
- `registerKnowledgeHandlers()` → 2 knowledge channels
- `registerMemoryHandlers()` → 2 memory channels
- `registerSettingsHandlers()` → 2 settings channels
- `registerTelemetryHandler()` → 1 telemetry channel
- `registerSupportHandler()` → 1 support channel
- `registerCancelHandler()` → `CH.cancel` (special)

### Event publishers (main → preload → renderer)

- `broadcastToAllWindows(EV.docker.installProgress, payload)` → `docker.onInstallProgress()` hook
- `broadcastToAllWindows(EV.docker.composeLogs, payload)` → `docker.onComposeLog()` hook
- `broadcastToAllWindows(EV.database.migrateProgress, payload)` → `database.onProgress()` hook
- `broadcastToAllWindows(EV.engine.transcriptAppend, payload)` → `engine.onTranscriptAppend()` hook
- `broadcastToAllWindows(EV.engine.streamDelta, payload)` → `engine.onStreamDelta()` hook
- `broadcastToAllWindows(EV.engine.controlState, payload)` → `engine.onControlState()` hook (F5 RESOLVED, Bundle B). Note: this emit is post-commit (on lease release via `releaseLeaseAndEmitControlState`), NOT part of the approval/transition transaction, so renderer `useControlStateLiveSync` treats it as primary push while `ApprovalsRegion` keeps its 5s poll as a fast fallback.

Unbridged publishers (main only, no renderer subscription):
- `broadcastToAllWindows(EV.system.logLine, payload)`
- `broadcastToAllWindows(EV.system.resume, payload)`
- `broadcastToAllWindows(EV.docker.daemonChanged, payload)`
- `broadcastToAllWindows(EV.updater.available, payload)`

---

## Internal Flow

### Request flow: window.vex.X.Y(input)

```
1. Renderer calls window.vex.domain.method(input)
   → Preload bridge method invokes _dispatch.invokeWithSchema()

2. Preload _dispatch.invokeWithSchema(channel, payload, inputSchema):
   → Generate requestId = crypto.randomUUID()
   → inputSchema.safeParse(payload)
     → If fail: return err(validation.invalid_input, correlationId=requestId)
   → ipcRenderer.invoke(channel, { requestId, payload })

3. Main process receives IPC event:
   → registerHandler wrapper called (all handlers registered with registerHandler)
   → assertTrustedSender(event) — reject if subframe or untrusted URL
   → Generate fallback requestId = randomUUID()
   → requestEnvelopeSchema(args.inputSchema).safeParse(raw)
     → If fail: return err(validation.invalid_input, domain, correlationId=requestId)
   → requestId = parsed.data.requestId
   → Create AbortController, store in cancelRegistry[requestId]

4. Handler execution:
   → args.handle(payload, ctx) — ctx.signal = controller.signal
   → Handler business logic, may spawn/fetch/poll
   → If ctx.signal aborts (user cancel): handler observes and throws/returns AbortError
   → Handler returns Result<O>

5. Main-side normalization:
   → If controller.signal.aborted && !result.ok && result.error.code !== "internal.cancelled":
       Replace error.code with "internal.cancelled"
   → If result.ok && args.outputSchema:
       outputSchema.safeParse(result.data) — reject if invalid
   → If !result.ok && !isValidVexErrorShape(result.error):
       Return err(internal.contract_violation)
   → Ensure result.error.correlationId === requestId
   → Return result to renderer

6. Preload receives result (via Promise resolution from ipcRenderer.invoke):
   → Result<O, VexError> returned as-is (already validated)

7. Renderer receives result:
   → if (result.ok) { /* use result.data */ }
   → else { /* use result.error with correlationId, code, message, etc. */ }
```

### Event flow: main publish → preload → renderer

```
1. Main publishes event:
   → broadcastToAllWindows(EV.docker.installProgress, payload)
   → webContents.send(EV.docker.installProgress, payload) to all windows

2. Preload event listener (registered by subscribe()):
   → ipcRenderer.on(EV.docker.installProgress, (event, raw) => {
       const parsed = schema.safeParse(raw)
       if (parsed.success) cb(parsed.data)
     })
   → If Zod fails: payload silently dropped (never calls callback)
   → If succeeds: call cb(validated_payload)

3. Renderer callback triggered:
   → Hook (e.g., useDockerInstall) receives validated payload
   → Updates TanStack Query cache / local state
   → Component re-renders
```

### Cancellation flow: renderer cancel() → main abort → handler respects signal

```
1. Renderer calls abortable.cancel():
   → ipcRenderer.invoke(CH.cancel, {
       requestId: newRequestId(),
       payload: { correlationId: originalRequestId }
     })

2. Main cancel handler:
   → registerCancelHandler() hooks CH.cancel
   → Looks up correlationId in cancelRegistry
   → If found: controller.abort()
   → Returns { cancelled: true } or { cancelled: false }

3. Main handler observes signal.aborted:
   → await fetch(url, { signal: ctx.signal }) throws AbortError
   → Or custom: if (ctx.signal.aborted) throw new AbortError()
   → registerHandler catches AbortError:
       log.info("[ipc:...] handler aborted (user cancel)")
       return err(cancelledError(args.domain, requestId))

4. Renderer promise resolves:
   → { ok: false, error: { code: "internal.cancelled", ... } }
   → abortable.cancel() side effect completes
```

---

## Dependencies

### Preload-side internal

- `electron.contextBridge` — Expose API on window object
- `electron.ipcRenderer` — Invoke + on/removeListener
- `zod` — Runtime schema validation
- `crypto.randomUUID` — Correlation ID generation (built-in Node)

### Shared types + contracts

- `vex-app/src/shared/ipc/channels.ts` — CH, EV constants
- `vex-app/src/shared/ipc/result.ts` — VexError, Result<T>, VEX_ERROR_CODES, VEX_DOMAINS
- `vex-app/src/shared/ipc/envelope.ts` — requestEnvelopeSchema, RequestEnvelope
- `vex-app/src/shared/types/bridge/**/*.ts` — Interface contracts for each domain
- `vex-app/src/shared/schemas/**/*.ts` — Per-domain Zod input/output schemas

### Main-side validation + lifecycle

- `vex-app/src/main/ipc/register-handler.ts` — Core handler registration + validation
- `vex-app/src/main/ipc/register-all.ts` — Centralised handler setup at app bootstrap
- `vex-app/src/main/lifecycle/cleanup-registry.ts` — Handler teardown on app quit
- `vex-app/src/main/logger/index.ts` — Structured logging (never logs raw objects)

### Renderer-side typing

- `vex-app/src/renderer/vex.d.ts` — Global window.vex type augmentation

---

## Cross-References

### Related modules
- **main-ipc-engine-orchestration** — How `setupAgentBridges()` publishes `EV.engine.*` events
- **renderer-appshell-runtime** — How hooks consume `window.vex` methods
- **shared-schemas-bridge-types** — Zod schemas + interfaces for each domain

### Forward dependencies (modules that import from here)
- `vex-app/src/renderer/**/*.tsx` — All hooks and components call `window.vex`
- `vex-app/src/main/ipc/**/*.ts` — Handler implementations call `registerHandler()`

---

## Refresh Triggers

This document is stale when any of these paths change:

- `vex-app/src/shared/ipc/channels.ts` — New/removed channel constant
- `vex-app/src/shared/ipc/result.ts` — New error code, domain, or VexError field
- `vex-app/src/shared/ipc/envelope.ts` — Envelope shape change
- `vex-app/src/preload/**/*.ts` — New domain bridge, new method, input/output schema change
- `vex-app/src/renderer/vex.d.ts` — Type augmentation change
- `vex-app/src/main/ipc/register-handler.ts` — Validation logic, error handling, or signature change
- `vex-app/src/main/ipc/register-all.ts` — Handler registration list change
- `vex-app/src/shared/types/bridge/**/*.ts` — Interface contracts change

**Stale signals:**
- New CH or EV constant added but preload bridge not wired
- New preload method but no main handler registered
- New error code defined but not in VEX_ERROR_CODES array
- New domain in interface but not in VEX_DOMAINS array
- Handler signature changed but preload bridge not updated
- New domain bridge file without `satisfies` type guard on composer

---

## Open Questions

### F5: `EV.engine.controlState` event unbridged — RESOLVED (Bundle B)

**Resolution:** The control-state bridge is now complete. `engine.onControlState(cb)` is declared on `EngineEventsBridge` and implemented in preload (`engine.ts`) as `subscribe(EV.engine.controlState, controlStateEventSchema, cb)` (third-layer re-validation). Renderer `useControlStateLiveSync(sessionId)` (mounted in `SessionPanel.tsx` alongside the other live-sync hooks) invalidates `runtimeKeys.state(sessionId)` + `approvalsKeys.pending(sessionId)` on each matching event, with a 30s runtime-state fallback interval. `ApprovalsRegion` retains its 5s `refetchInterval` as a FAST FALLBACK (not a workaround): the controlState emit is post-commit (on lease release via `releaseLeaseAndEmitControlState`), NOT part of the approval/transition transaction, and an event can be dropped at the preload Zod gate or fire before the renderer subscribes — so push is primary, the 5s poll is the safety net.

**Original finding (historical, now addressed):** `EV.engine.controlState` constant exists in `channels.ts:281` and is published by main (`src/main/agent/control-bridge.ts`); at the time of the original index it had no preload subscription method.

**Evidence at time of finding:**
- Channel defined: `EV.engine.controlState = "vex:event:engine:controlState"`
- Publisher exists: `broadcastToAllWindows(EV.engine.controlState, parsed.data)`
- Preload bridge (`engine.ts`) exported `onTranscriptAppend` and `onStreamDelta` only — now also exports `onControlState`
- No `onControlState` method in `EngineEventsBridge` interface — now declared

**Original questions (resolved):**
1. Was the preload method intentionally deferred, or a gap? → Now bridged in Bundle B.
2. Should the main-side publisher be gated by a feature flag? → Not needed; the renderer subscribes and re-validates.
3. Which renderer components subscribe to `controlState`? → `useControlStateLiveSync` (mounted in `SessionPanel.tsx`), invalidating runtime-state + pending-approvals queries.

---

### F6: Legacy `RuntimeRequestResult` vs per-action schemas — RESOLVED (Bundle B)

**Resolution:** `RuntimeBridge` (`vex-app/src/shared/types/bridge/agent/runtime.ts`) and the 4 renderer mutation hooks now use the per-action discriminated unions: `RuntimeRequestPauseResult`, `RuntimeRequestStopResult`, `RuntimeRequestResumeResult`, `RuntimeCancelWakeResult`. The legacy `runtimeRequestResultSchema` / `RuntimeRequestResult` alias was DELETED from `vex-app/src/shared/schemas/runtime.ts` (along with its legacy test) — the type no longer exists; `shared/schemas/runtime.ts` now ends with `ControlStateEvent` (~line 171). Preload `runtime.ts` is unchanged — `satisfies RuntimeBridge` re-infers the per-action `T`, and `tsc --noEmit` is clean.

**Original finding (historical, now addressed):** Some runtime handlers were suspected of returning a legacy `RuntimeRequestResult` union instead of per-action shapes (e.g., `getState` vs `requestPause` vs `requestStop`).

**Evidence at time of finding:**
- `runtime.getState()` returns a complex `RuntimeState` DTO
- `runtime.requestPause()`, `.requestStop()`, `.requestResume()`, `.cancelWake()` now return per-action discriminated-union results
- Main handler implementations confirmed consistent with the per-action `RuntimeBridge` interface

**Original recommendation (resolved):** Runtime handlers (`vex-app/src/main/ipc/runtime.ts`) were audited:
1. Each passes an explicit `outputSchema` to `registerHandler`
2. Return types match the per-action `RuntimeBridge` interface
3. The catch-all `RuntimeRequestResult` alias was removed entirely

---

### Reserved/unbridged channels: Full list

Channels defined in constants but NOT bridged to preload (may be future, unused, or internal):

#### Onboarding (2)
- `CH.onboarding.providerListModels` — Fetch available models from provider (future: puzzle TBD)
- `CH.onboarding.providerTest` — Test provider API key (future: puzzle TBD)

#### Updater (1)
- `CH.updater.check` — Manual update check (reserved, may be unused)

#### Database (1)
- `CH.database.status` — Database health (read-only, may not need renderer exposure)

#### Events (4)
- `EV.system.logLine` — System log events (internal, no renderer subscription)
- `EV.system.resume` — Resume-from-suspend signal (internal, no renderer subscription)
- `EV.docker.daemonChanged` — Docker daemon status toggle (published but unbridged; renderer may poll `docker.detect()` instead)
- `EV.updater.available` — New version available (published but unbridged; future updater UI in puzzle TBD)

(`EV.engine.controlState` was formerly listed here; it is now bridged via `engine.onControlState()` — F5 RESOLVED, Bundle B.)

**Maintenance note:** When adding new handler or event, explicitly decide:
1. Is it renderer-facing? If yes, bridge it.
2. Is it internal-only? Document in `_dispatch.ts` or handler file comments.
3. Is it future? Leave a comment referencing the puzzle/phase number.

---

## Handoff to Main Claude

### Recommended next action

If the task is to **inventory the preload channels/events/errors**, this document is complete. The inventory is 92 CH constants, 10 EV constants, 54 error codes, 29 domains, with exact file locations and per-domain method signatures.

`EV.engine.controlState` is already bridged (F5 RESOLVED, Bundle B) — see the F5 section above for the push/poll model. No further bridging work is required for it.

### Files the main Claude must read next

- `vex-app/src/shared/types/bridge/agent/engine.ts` — `EngineEventsBridge` now declares `onControlState()`
- `vex-app/src/preload/agent/engine.ts` — preload subscription implemented (`subscribe(EV.engine.controlState, controlStateEventSchema, cb)`)
- `vex-app/src/shared/schemas/runtime.ts` — `controlStateEventSchema` / `ControlStateEvent` (file ends ~line 171; legacy `runtimeRequestResultSchema` removed)
- `vex-app/src/renderer/lib/api/runtime.ts` — `useControlStateLiveSync(sessionId)` consumer hook
- `vex-app/src/main/agent/control-bridge.ts` — Publisher location + schema

### What the main Claude must not assume

1. **Not all error codes are used equally.** Some (`feature_unavailable` codes, `approvals.expired`, `compaction.invalid_state`) are puzzle-specific and may not appear until late phases.
2. **Not all events are bridged.** `EV.system.logLine`, `EV.system.resume`, `EV.docker.daemonChanged`, `EV.updater.available` are defined but not exposed to the renderer. (`EV.engine.controlState` IS now bridged — F5 RESOLVED, Bundle B.)
3. **Onboarding channels are not all implemented.** `CH.onboarding.providerListModels` and `CH.onboarding.providerTest` are reserved in the constants but no preload methods exist.
4. **Preload does not cache or manage state.** It is a pure bridge; all state lives in main or renderer.
5. **Cancel registry is per-request, not per-handler.** A single handler can have multiple in-flight requests with different correlationIds, and only the matching one is aborted.

