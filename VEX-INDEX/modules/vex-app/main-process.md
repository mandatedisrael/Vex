---
id: module.vex-app.main-process
kind: module
paths:
  - "vex-app/src/main/**"
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change:
  - "vex-app/src/main/**"
  - "vex-app/src/shared/ipc/**"
  - "vex-app/src/shared/schemas/**"
  - "vex-app/src/preload/**"
  - "src/providers/env-resolution.ts"
  - "src/lib/runtime-env.ts"
related:
  - module.vex-app.preload-shared-contracts
  - module.vex-agent.engine-runtime-events
  - module.vex-agent.engine-wake-subagents-prompts
  - module.vex-agent.engine-compact
  - fix-plan.F1
  - fix-plan.F2
---

# vex-app Main Process

## Purpose

Privileged Electron process for local authority: window/protocol security, IPC handlers,
secrets, wallet access, DB connection state, Docker/Compose lifecycle, engine bridge, and
background workers.

## Retrieval keywords

- Electron main, BrowserWindow, app protocol, CSP, permissions, fuses
- registerAllIpcHandlers, registerHandler, result envelope, cancel registry
- loadProviderDotenv, resetProvider, secrets unlock, provider persist
- setupCompactWorker, setupWakeWorker, control bridge, transcript bridge, stream bridge
- Docker compose, endpoint policy, migrations, DB connection state

## File map

- `vex-app/src/main/index.ts:109` boot sequence; loads `.env`, registers IPC, starts compact+wake, orders cleanup.
- `vex-app/src/main/windows/main-window.ts:139` BrowserWindow hardening and navigation/external URL policy.
- `vex-app/src/main/protocol/app-protocol.ts:20` privileged `app://vex` registration + path containment handler.
- `vex-app/src/main/permissions.ts:11` deny-all permission handlers.
- `vex-app/src/main/ipc/register-handler.ts:228` trusted sender, request parsing, output validation, error normalization.
- `vex-app/src/main/agent/control-bridge.ts:23` publishes `EV.engine.controlState` to windows; preload does not expose it yet.
- `vex-app/src/main/agent/compact-worker.ts` and `wake-worker.ts` own worker supervisors.
- `vex-app/src/main/ipc/onboarding/provider.ts` persists provider config, reloads `.env` with overwrite, calls `resetProvider()`.

## Key invariants

- Renderer is untrusted. Main owns local privilege and does all privileged IO.
- `loadProviderDotenv()` must run before IPC handlers and workers read model/provider config.
- Compact and wake workers must drain before Compose/Postgres cleanup.
- IPC handlers must go through `registerHandler`; otherwise preload will not catch malformed outputs.
- Navigation, external open, protocol and permission policies fail closed.

## Known gaps

- F5: control-state event reaches main broadcast but not preload/renderer.
- Sync executor wired in `index.ts` via `setupSyncWorker()` (Bundle A / F11); compact + wake + sync all drain on quit.
- Updater channels exist, but no updater main handler/autoUpdater implementation was found.

## Refresh triggers

Any change under `vex-app/src/main/**`, shared IPC schemas/channels, preload bridge methods,
`src/providers/env-resolution.ts`, or `src/lib/runtime-env.ts`.
