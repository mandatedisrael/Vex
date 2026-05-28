---
id: module.vex-app.main-bootstrap-lifecycle
kind: module
paths:
  - "vex-app/src/main/index.ts"
  - "vex-app/src/main/permissions.ts"
  - "vex-app/src/main/menu.ts"
  - "vex-app/src/main/menu-template.ts"
  - "vex-app/src/main/windows/main-window.ts"
  - "vex-app/src/main/windows/bounds.ts"
  - "vex-app/src/main/windows/visibility.ts"
  - "vex-app/src/main/protocol/app-protocol.ts"
  - "vex-app/src/main/lifecycle/before-quit.ts"
  - "vex-app/src/main/lifecycle/broadcast.ts"
  - "vex-app/src/main/lifecycle/cleanup-registry.ts"
  - "vex-app/src/main/lifecycle/ordered-quit-cleanup.ts"
  - "vex-app/src/main/lifecycle/secret-cleanup.ts"
  - "vex-app/src/main/lifecycle/single-instance.ts"
  - "vex-app/src/main/lifecycle/window-all-closed.ts"
  - "vex-app/src/main/paths/config-dir.ts"
  - "vex-app/src/main/preferences/store.ts"
  - "vex-app/src/main/security/url.ts"
  - "vex-app/src/main/logger/index.ts"
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - "vex-app/src/main/index.ts"
  - "vex-app/src/main/permissions.ts"
  - "vex-app/src/main/menu*.ts"
  - "vex-app/src/main/windows/**"
  - "vex-app/src/main/protocol/app-protocol.ts"
  - "vex-app/src/main/lifecycle/**"
  - "vex-app/src/main/paths/**"
  - "vex-app/src/main/preferences/**"
  - "vex-app/src/main/security/url.ts"
  - "vex-app/src/main/logger/index.ts"
  - "src/lib/runtime-env.ts"
  - "src/providers/env-resolution.ts"
related:
  - module.vex-app.main-process
  - module.src-root.lib-env-config
  - module.vex-agent.engine-wake-subagents-prompts
  - module.vex-agent.engine-compact
  - fix-plan.F1
  - fix-plan.F2
  - ADR-0001-global-model-session-wallet
---

# vex-app Main Bootstrap & Lifecycle

## Purpose

Electron main-process bootstrap sequence and orderly shutdown. Covers entrypoint initialization (single-instance lock, privilege registration, lifecycle hooks), app-readiness setup (env loading, permissions, protocol, IPC, workers), window creation with hardened security, and multi-phase quit sequencing with worker drain → secret cleanup → Compose teardown.

## Retrieval keywords

- boot sequence, app.whenReady, single-instance lock, WSL2 GPU mitigation
- registerAppProtocolPrivileges, installAppProtocolHandler, app://vex/ scheme
- installPermissionHandlers, deny-all default, BrowserWindow webPreferences
- loadProviderDotenv, provider config, AGENT_MODEL, OPENROUTER_API_KEY
- registerAllIpcHandlers, setupCompactWorker, setupWakeWorker
- globalCleanup, ordered-quit-cleanup, drain-before-compose
- main window creation, window state persistence, external URL allowlist
- CONFIG_DIR resolver, preferences store, redacted logging
- lifecycle hooks: window-all-closed, before-quit (mission gate), will-quit

## State owned

- **Lifecycle flags**: `confirmedQuit`, `stopped`, `started` (per supervisor; compact + wake workers)
- **Cleanup registry**: `globalCleanup.tasks` — async cleanup funcs called on will-quit, idempotent and failure-isolated
- **Worker handles**: `CompactJobsExecutorHandle` and `WakeExecutorHandle` — started once schema/DB ready, stopped before compose down
- **Supervisor state**: `timer`, `inFlightTick`, `warnedWaiting` (per worker) — ensures single startup
- **Preferences cache**: `PreferencesStore.cache` — window bounds, maximized state, telemetry consent
- **Window state**: persisted x, y, width, height, maximized flag; normalized on boot against current display config
- **App protocol root**: `rendererRoot` resolved based on `app.isPackaged`; used by URL security resolver
- **Telemetry consent**: stored in `preferences.json`; Sentry only initializes if consent + DSN both present
- **Logger transport state**: `configured` flag; transports initialized once per process

## Boundary crossings

**Imports from outside main process** (allowed):
- `@vex-lib/runtime-env.js:loadProviderDotenv()` — loads non-secret .env into process.env
- `@vex-lib/runtime-env.ts` (root lib) — provides env-loading primitives
- `@vex-agent/engine/compact-jobs/executor.js:startCompactJobsExecutor()` — dynamic import in compact worker supervisor
- `@vex-agent/engine/wake/executor.js:startWakeExecutor()` — dynamic import in wake worker supervisor
- `electron` package — BrowserWindow, app, session, menu, protocol, shell, dialog, net, screen

**Never imports**:
- Renderer code (`vex-app/src/renderer/`)
- `src/vex-agent/` engine core (only the two executor entry points via dynamic import in workers)
- Untrusted DOM/web code

**Called by**:
- IPC handlers (preload) → main process bridges to engine runtime
- Renderer window lifecycle hooks (created, destroyed, focused)
- Electron app events (window-all-closed, before-quit, will-quit, second-instance)

## File map

| Path & Symbol | Purpose |
|---|---|
| `vex-app/src/main/index.ts:1–193` | **Entrypoint + boot sequence.** Lines 45–89: pre-ready setup (WSL2 GPU, userData remap, single-instance, privilege register, lifecycle hooks). Lines 109–184: app.whenReady handler (env load, permissions, protocol install, IPC register, workers start, cleanup chain, Sentry, menu, window create). |
| `vex-app/src/main/lifecycle/single-instance.ts:18` | `acquireSingleInstanceLock()` — claims single-instance lock or quits if duplicate found. Critical for vault/keystore/DB race prevention. |
| `vex-app/src/main/lifecycle/window-all-closed.ts:8` | `installWindowAllClosedHook()` — macOS keep-alive vs Windows/Linux quit-on-last-window-close. |
| `vex-app/src/main/lifecycle/before-quit.ts:34,62` | `registerActiveMissionCheck()` and `installBeforeQuitHook()` — prevents quit if mission active (per product mandate); mission-safe confirmation dialog before forcing quit. |
| `vex-app/src/main/lifecycle/ordered-quit-cleanup.ts:15` | `makeOrderedQuitCleanup(stopWorker, quitCleanup)` — sequences worker drain → compose/secret teardown atomically so DB stays live while workers finish in-flight work. |
| `vex-app/src/main/lifecycle/cleanup-registry.ts:11,37` | `CleanupRegistry` class and `globalCleanup` singleton — concurrent-safe cleanup task collector. `runAll()` invoked on will-quit; tasks isolated by `Promise.allSettled`. |
| `vex-app/src/main/lifecycle/secret-cleanup.ts:52,80` | `cleanupOnBoot()` and `cleanupOnQuit()` — sweeps transient secrets, stops compose project on quit, recovers orphans from prior crashes. |
| `vex-app/src/main/lifecycle/broadcast.ts:16` | `broadcastToAllWindows(channel, payload)` — sends IPC event to all live windows; guards against destroyed windows. |
| `vex-app/src/main/permissions.ts:11` | `installPermissionHandlers()` — deny-all default for camera, mic, geolocation, USB, etc. No allowlist yet. |
| `vex-app/src/main/protocol/app-protocol.ts:20,36` | `registerAppProtocolPrivileges()` and `installAppProtocolHandler(rendererRoot)` — registers `app://vex/` scheme as privileged (must run before app.ready); handler uses `resolveAppUrl()` for traversal/containment checks. |
| `vex-app/src/main/windows/main-window.ts:84,128` | `createMainWindow()` — BrowserWindow factory with hardened webPreferences (sandbox, contextIsolation, no nodeIntegration, webSecurity). Loads renderer via app:// or dev server. Window state persisted + normalized. |
| `vex-app/src/main/windows/bounds.ts` | `isFirstRun()`, `computeFirstRunBounds()`, `computeMinConstraints()` — window bounds logic. |
| `vex-app/src/main/windows/visibility.ts` | `clampToVisibleArea()` — normalizes saved bounds against current display config. |
| `vex-app/src/main/menu.ts:21` | `installMinimalMenu()` — removes default menu on Windows/Linux, installs minimal macOS template (app + edit + view in dev). |
| `vex-app/src/main/menu-template.ts` | `buildMacMenuTemplate()` — macOS menu template builder. |
| `vex-app/src/main/paths/config-dir.ts:23,56` | `resolveConfigDir(deps)` and exported `CONFIG_DIR` — pure platform resolver for ~/.config/vex (Linux) / ~/Library/.../vex (macOS) / %APPDATA%/vex (Windows). Honors VEX_CONFIG_DIR override. Mirrors src/config/paths.ts. |
| `vex-app/src/main/preferences/store.ts:26,68` | `PreferencesStore` class, `load()` and `update()` methods — atomic read-modify-write to ${userData}/preferences.json via promise-chain serialization. Validated by Zod. |
| `vex-app/src/main/security/url.ts:24,43,67,100` | `containsTraversal()`, `pathStartsWithBoundary()`, `isAllowedExternalUrl()`, `resolveAppUrl()` — URL safety checks for app:// protocol and external links (https: only, allowlist, path boundary). |
| `vex-app/src/main/logger/index.ts:21,69` | `configureLogger()` and exported `log` wrapper — electron-log with redaction; files rotated at 5 MB under ${userData}/logs/. Scrubs secrets before transport. |
| `vex-app/src/main/agent/compact-worker.ts:62,140` | `setupCompactWorker()` and returned `stop()` function — supervisor that starts Track-2 executor once `compact_jobs` schema is ready. Idle until vault injects OPENROUTER_API_KEY. |
| `vex-app/src/main/agent/wake-worker.ts:62,138` | `setupWakeWorker()` and returned `stop()` function — supervisor that starts wake executor once `loop_wake_requests` schema is ready. Idle until vault injects provider config (mirrors compact worker). |

## Key types & invariants

**Lifecycle sequencing**
- Boot order is strict: single-instance → privilege register → lifecycle hooks → `app.whenReady()` → permissions install → protocol install → IPC register → workers start → cleanup chain → menu → window create.
- Env loading (`loadProviderDotenv()`) MUST run before IPC handlers and workers read provider/model config. Non-secret .env only (vault secrets loaded on unlock).
- App-readiness handler is `async`; all awaits are sequenced. No concurrent startups.

**Worker supervision**
- Compact + wake workers start at most ONCE (idempotent `started` flag prevents restarts).
- Each supervisor ticks every 30 seconds until schema probe succeeds; then starts the executor EXACTLY ONCE and clears the interval.
- Both `stop()` functions are idempotent and safe to call multiple times or race with startup tick. A tick that loses the race to `stop()` cleans up the executor it created.
- Worker `stop()` is sequenced BEFORE `cleanupOnQuit()` via `makeOrderedQuitCleanup()` so in-flight jobs have a live DB.

**Cleanup registry**
- `globalCleanup.runAll()` invokes all registered tasks via `Promise.allSettled()`; failures are logged but don't block other tasks.
- Tasks are idempotent by design (e.g., `lockSecretSession()` called twice is safe; `composDown()` with no project running is a no-op).
- Registry is called on `will-quit` event. `before-quit` may prevent quit if mission active, but `will-quit` always drains cleanup.

**Quit gate (before-quit)**
- Mission-active check has TWO paths: fast sync check (cached state) and optional slow async check (DB verification).
- If sync check returns true, quit is PREVENTED SYNCHRONOUSLY (before any await). Async check + dialog run deferred.
- A stuck mission gate logs errors but ultimately allows quit (fail-open on quit).
- `confirmedQuit` flag prevents re-gating after user confirms on the dialog.

**Window state**
- Bounds saved on `win.on('close')` AFTER checking `isDestroyed()` — safe concurrent saves are serialized via async PreferencesStore chain.
- First-run bounds computed as 85% of primary display work area (avoids off-screen launch).
- Saved bounds are clamped to visible area on load (normalizes for display config changes).
- Maximized state is separate from bounds; restored via `win.maximize()`.

**Preferences store**
- Operations (load, update, write) are serialized via a single promise chain; no race conditions on concurrent updates.
- Corruption in preferences.json triggers automatic reset to defaults (parse error or Zod validation failure).
- Writes use unique temp suffix (PID + counter + random) to prevent collision on crash.
- Cache is in-memory; invalidation on update clears cache so next load reads fresh file.

**Security hardened**
- Sandbox: true; contextIsolation: true; nodeIntegration: false; webSecurity: true.
- Preload is CommonJS (not ESM) to guarantee single-load and avoid double-execution.
- Navigation policy: only allow app:// URLs and (dev only) http://127.0.0.1:5173/. External URLs with shell.openExternal go through allowlist only.
- External allowlist: https: only, exact host match or path-boundary match (prevents `/releases-malicious` from matching `/releases`).
- App protocol handler: resolves URLs through `resolveAppUrl()` which rejects traversal (raw + post-decode), host mismatch, and out-of-root paths.

**Logger redaction**
- All main-process logging goes through the `log` wrapper (never raw electron-log).
- Variadic args are recursively scrubbed for secrets before any transport sees them (console, file, error handler).
- File rotation: 5 MB max, archive on rollover. Files under ${userData}/logs/{main,renderer}-YYYY-MM-DD.log.

## Capabilities (stable IDs)

| Capability | Description | Location |
|---|---|---|
| `CAP-vexapp-boot-acquire-single-instance` | Claim single-instance lock; quit if duplicate app already running. Critical for vault/keystore safety. | `vex-app/src/main/lifecycle/single-instance.ts:18` |
| `CAP-vexapp-boot-register-privilege-scheme` | Register `app://vex/` scheme as privileged before app.ready (required by Electron). | `vex-app/src/main/protocol/app-protocol.ts:20` |
| `CAP-vexapp-boot-install-lifecycle-hooks` | Install window-all-closed, before-quit, will-quit hooks. Ordered before app.ready. | `vex-app/src/main/index.ts:95–96` |
| `CAP-vexapp-boot-load-provider-env` | Load non-secret `.env` into process.env; gate for inference provider initialization. | `vex-app/src/main/index.ts:116` |
| `CAP-vexapp-boot-install-permissions` | Install deny-all permission handlers (camera, mic, geolocation, USB, etc.). | `vex-app/src/main/permissions.ts:11` |
| `CAP-vexapp-boot-install-protocol-handler` | Route app://vex/ requests through URL security resolver. | `vex-app/src/main/protocol/app-protocol.ts:36` |
| `CAP-vexapp-boot-register-ipc-handlers` | Centralised IPC handler registration for all Z6 channels. | `vex-app/src/main/ipc/register-all.ts:47` |
| `CAP-vexapp-boot-start-compact-worker` | Start supervised Track-2 executor once compact_jobs schema ready; idle until vault unlocks. | `vex-app/src/main/agent/compact-worker.ts:62` |
| `CAP-vexapp-boot-start-wake-worker` | Start supervised wake executor once loop_wake_requests schema ready; idle until provider configured. | `vex-app/src/main/agent/wake-worker.ts:62` |
| `CAP-vexapp-boot-install-menu` | Install minimal menu (stripped on Windows/Linux, template on macOS). | `vex-app/src/main/menu.ts:21` |
| `CAP-vexapp-boot-create-main-window` | Create and show main BrowserWindow with hardened security, persisted bounds, and protocol URL. | `vex-app/src/main/windows/main-window.ts:84` |
| `CAP-vexapp-quit-prevent-on-active-mission` | Prevent quit if any mission is active; show user confirmation before forcing quit. | `vex-app/src/main/lifecycle/before-quit.ts:62` |
| `CAP-vexapp-quit-drain-compact-worker` | Stop Track-2 executor gracefully; drain in-flight jobs before cleanup. | `vex-app/src/main/agent/compact-worker.ts:140` |
| `CAP-vexapp-quit-drain-wake-worker` | Stop wake executor gracefully; drain in-flight resumes before cleanup. | `vex-app/src/main/agent/wake-worker.ts:138` |
| `CAP-vexapp-quit-order-worker-then-compose` | Sequence worker drains before Compose/Postgres teardown atomically. | `vex-app/src/main/lifecycle/ordered-quit-cleanup.ts:15` |
| `CAP-vexapp-quit-cleanup-secrets` | Sweep transient secrets and stop Compose project on quit. | `vex-app/src/main/lifecycle/secret-cleanup.ts:80` |
| `CAP-vexapp-quit-cleanup-orphan-transients` | Boot-time recovery of transient secrets left by prior crash. | `vex-app/src/main/lifecycle/secret-cleanup.ts:52` |
| `CAP-vexapp-quit-lock-vault` | Scrub master password from memory on before-quit / will-quit. | `vex-app/src/main/index.ts:102–106` |
| `CAP-vexapp-lifecycle-broadcast-event` | Send IPC event to all live windows (guards against destroyed windows). | `vex-app/src/main/lifecycle/broadcast.ts:16` |
| `CAP-vexapp-security-allow-external-url` | Validate external URLs: https: only, allowlist host + path-boundary match. | `vex-app/src/main/windows/main-window.ts:172–187` |
| `CAP-vexapp-security-resolve-app-protocol` | Resolve app://vex/ paths safely: traversal rejection, host check, containment. | `vex-app/src/main/protocol/app-protocol.ts:39–58` |
| `CAP-vexapp-window-persist-state` | Save and restore window bounds, maximized state, normalized against display config. | `vex-app/src/main/windows/main-window.ts:84–110` |
| `CAP-vexapp-preferences-load-atomic` | Atomically load preferences.json with Zod validation; auto-reset on corruption. | `vex-app/src/main/preferences/store.ts:68` |
| `CAP-vexapp-preferences-update-serialized` | Atomically update preferences via serialized chain; no lost updates. | `vex-app/src/main/preferences/store.ts:100` |
| `CAP-vexapp-logger-redact-secrets` | Log all main-process output through redaction wrapper; scrub before any transport. | `vex-app/src/main/logger/index.ts:69` |
| `CAP-vexapp-config-resolve-platform-paths` | Resolve CONFIG_DIR for platform; honor VEX_CONFIG_DIR override for test isolation. | `vex-app/src/main/paths/config-dir.ts:23` |

## Public API (consumed by)

**IPC handlers and bridges** (at runtime):
- All IPC handlers register via `registerHandler()`, which validates request shape, handles auth checks, and normalizes output through the preload envelope.
- Handlers access engine runtime via dynamic imports (compact/wake executors) and via synchronous engine DB repos (sessions, missions, messages, approvals, etc.).
- Control-state events published by `control-bridge.ts` fan out to renderer via `broadcastToAllWindows()` (though preload does not yet expose them per F5).

**Renderer (untrusted)**:
- Renderer calls IPC channels via `vex.invoke()` (preload bridge).
- Renderer receives async responses and broadcast events.
- Main enforces all input validation and auth; renderer has no direct DB/Docker/wallet/signing access.

**Desktop app startup** (external to this module):
- Electron framework calls main-process entry file (`index.ts`) via `--main` flag in `package.json`.
- No exports from this module; all module patterns are private to Electron's startup flow.

## Internal flow

**Boot sequence** (lines 45–184 in `index.ts`):

1. **Pre-ready (synchronous)**
   - `index.ts:51–52` — Remap userData to CONFIG_DIR/.electron-state before any path query caches.
   - `index.ts:54` — Configure logger (once).
   - `index.ts:62–81` — WSL2 GPU mitigation: detect and disable hardware acceleration + use SwiftShader fallback.
   - `index.ts:86–89` — Acquire single-instance lock via `acquireSingleInstanceLock()` or quit.
   - `index.ts:92` — Register app:// scheme as privileged (must precede app.ready).
   - `index.ts:95–96` — Install lifecycle hooks: window-all-closed, before-quit.
   - `index.ts:102–107` — Attach secret-vault lock handlers to before-quit + will-quit events.

2. **Post-ready (async in `app.whenReady()` handler)**
   - `index.ts:116` — Load non-secret `.env` into process.env via `loadProviderDotenv()` (gates provider config reads downstream).
   - `index.ts:120` — Install deny-all permission handlers via `installPermissionHandlers()`.
   - `index.ts:123–126` — Resolve renderer root path (packaged vs dev).
   - `index.ts:126` — Install app:// protocol handler with URL security via `installAppProtocolHandler()`.
   - `index.ts:129` — Register all IPC handlers (centralised via `registerAllIpcHandlers()`).
   - `index.ts:136` — Start compact-worker supervisor; returns async `stop()` for cleanup.
   - `index.ts:143` — Start wake-worker supervisor; returns async `stop()` for cleanup.
   - `index.ts:151–163` — Compose ordered-quit cleanup: drain both workers → cleanupOnQuit.
   - `index.ts:164–166` — Boot-time secret cleanup (sweep orphans from prior crashes).
   - `index.ts:171–176` — Initialize Sentry (if consent + DSN); add teardown to cleanup.
   - `index.ts:180` — Install minimal menu via `installMinimalMenu()`.
   - `index.ts:183` — Create main window via `createMainWindow()` (awaits; blocks on window ready or 5-second timeout).

3. **Window creation** (`main-window.ts:84–200`)
   - Load preferences from store (atomic read + Zod validate).
   - Compute window bounds: first-run (85% of primary) vs saved (normalized for display config changes).
   - Create BrowserWindow with hardened security: sandbox, contextIsolation, no nodeIntegration, webSecurity.
   - Register navigation policy: deny except app:// + (dev) http://127.0.0.1:5173/.
   - Register external-link allowlist: https:, exact host or path-boundary match.
   - Load renderer via `createMainWindow()`:
     - Packaged: `app://vex/` protocol (routed through app-protocol handler).
     - Dev: `http://127.0.0.1:5173/` (Vite dev server).
   - Set up window-close listener to persist bounds (serialized via PreferencesStore chain).
   - Set 5-second safety timeout on ready-to-show (WSL2/Electron copy-mode can stall).
   - Show window if not maximized; otherwise maximize first.

4. **MacOS activate** (lines 186–192)
   - On dock icon click + no windows: re-create window via `createMainWindow()`.

**Quit sequence** (lifecycle hooks + cleanup):

1. **Before-quit** (`before-quit.ts:62–116`)
   - Fast sync mission check via registered `SyncMissionCheck` callbacks.
   - If mission active: prevent quit synchronously, defer dialog + deep check to next tick.
   - Dialog shows "Mission active — persist and quit?" with Cancel / Quit buttons.
   - If user cancels: quit blocked; if confirms: `confirmedQuit = true` and `app.quit()` retries.
   - If no mission: quit proceeds to next phase.

2. **Will-quit** (`index.ts` + `before-quit.ts:118–130`)
   - Prevent exit immediately: await `globalCleanup.runAll()`.
   - Cleanup runs all registered tasks concurrently via `Promise.allSettled()`:
     - Ordered cleanup wrapper: drains compact worker → drains wake worker → calls `cleanupOnQuit()`.
     - `cleanupOnQuit()` tasks: stops Compose, sweeps transient secrets.
     - Sentry teardown: closes transport + offline queue.
   - After all tasks complete (or timeout), call `app.exit(0)` hard exit.

3. **Secret cleanup** (`secret-cleanup.ts:80–110`)
   - Read install ID from `.install-id`.
   - Run `docker ps --filter label=com.docker.compose.project=vex-${installId}` to check if project is alive.
   - Best-effort `compose down` (not with `--volumes`; skill §10).
   - Sweep SECRETS_DIR for `*.transient` files; remove each (best-effort, silent on error).

4. **Ordered worker drain** (`ordered-quit-cleanup.ts:15–26`)
   - Await `stopCompactWorker()` (clears timer, awaits in-flight tick, stops executor if started).
   - Await `stopWakeWorker()` (same pattern).
   - Then await `cleanupOnQuit()` (compose + transients).
   - `finally` ensures compose cleanup runs even if workers fail; stuck workers never block secret cleanup.

## Dependencies

**Electron**
- `electron` — app, BrowserWindow, session, menu, protocol, shell, dialog, net, screen

**Root library** (src/lib, src/providers, src/config)
- `@vex-lib/runtime-env.js:loadProviderDotenv()` — loads non-secret .env
- `@vex-lib/runtime-env.ts` — env-loading primitives
- `src/config/paths.ts` — mirrors config-dir logic (both stay in sync)

**Engine** (dynamic import in workers only)
- `@vex-agent/engine/compact-jobs/executor.js:startCompactJobsExecutor()` — narrow import, not full engine barrel
- `@vex-agent/engine/wake/executor.js:startWakeExecutor()` — narrow import
- `@vex-agent/db` repos — accessed by IPC handlers; not directly by boot

**Node built-ins**
- `node:fs` (promises API) — file I/O for preferences, env, secrets, install ID
- `node:os` — homedir() for config-dir resolution
- `node:path` — path resolution and manipulation
- `node:url` — fileURLToPath, pathToFileURL for ESM compat
- `node:crypto` — randomUUID for correlation IDs

**Other**
- `electron-log/main.js` — structured logging with file rotation and redaction
- Zod — preferences.json validation + error recovery

## Cross-references

- **module.vex-app.main-process** — parent seed doc; covers IPC + bridges at a higher level
- **module.src-root.lib-env-config** — shares env-loading logic (loadProviderDotenv origin)
- **module.vex-agent.engine-wake-subagents-prompts** — wake executor consumed by this zone
- **module.vex-agent.engine-compact** — compact executor consumed by this zone
- **fix-plan.F1** (shipped) — "Model not configured" fixed by loading .env on boot
- **fix-plan.F2** (shipped) — wake executor wired into boot sequence
- **ADR-0001-global-model-session-wallet** — model is global (env-driven); used to justify loadProviderDotenv gate

## Refresh triggers

This doc becomes stale if any path below changes:

```
vex-app/src/main/index.ts                          # boot sequence, worker setup, cleanup order
vex-app/src/main/permissions.ts                    # permission policy changes
vex-app/src/main/menu*.ts                          # menu install policy
vex-app/src/main/windows/**                        # window creation, bounds, security
vex-app/src/main/protocol/app-protocol.ts          # privilege registration, handler logic
vex-app/src/main/lifecycle/**                      # quit gate, cleanup, single-instance
vex-app/src/main/paths/**                          # config-dir resolver
vex-app/src/main/preferences/**                    # prefs store implementation
vex-app/src/main/security/url.ts                   # URL safety rules
vex-app/src/main/logger/index.ts                   # logger config, redaction
src/lib/runtime-env.ts                             # env-loading primitives (shared)
src/providers/env-resolution.ts                    # provider resolution (shared)
```

## Open questions

- **F5 unresolved**: Control-state events are published by `control-bridge.ts` and fan out to windows via `broadcastToAllWindows()`, but preload does not yet expose a receiver interface. Renderer cannot consume live control state. Blocking renderer runtime bar visibility.

- ~~**Sync executor wiring unclear**~~ RESOLVED (Bundle A / F11): main now owns a sync supervisor — `setupSyncWorker()` is started in `index.ts` after the wake worker and drained in the quit `Promise.allSettled([...])`, mirroring the compact/wake pattern (`agent/sync-worker.ts` + `database/sync-db.ts`).

- **Telemetry consent DSN mismatch**: Sentry initialization gates on both consent (true) + DSN (non-empty). If one is missing, Sentry stays disabled. Unclear if this is a feature or a correctness gap — what happens if the user consents but DSN is not set? Should we warn?

- **Preferences cache invalidation timing**: PreferencesStore invalidates in-memory cache on successful write, but a file-write error leaves cache stale. Subsequent `load()` calls will bypass the corrupted file. This is safe but may mask persistent corruption. Unclear if that's intentional.

- **Mission gate async depth**: The before-quit handler has a two-tier mission check (sync + optional async). Unclear what the intended async check should verify beyond the sync cache. Current code shows the async checks set exists but no callers were found registering them. Is the async tier unused / for future mission state deepening?

- **WSL2 GPU fallback polished?**: The code detects WSL and disables GPU + uses SwiftShader, but no E2E tests confirm this works on actual WSL2 with Electron 42. Recommend confirming in CI or a WSL2 lab before shipping to users.
