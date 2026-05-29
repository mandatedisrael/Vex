---
id: boundary.ipc-contracts
kind: boundary
paths:
  - vex-app/src/shared/ipc/**
  - vex-app/src/shared/schemas/**
  - vex-app/src/shared/types/bridge/**
  - vex-app/src/preload/**
  - vex-app/src/main/ipc/register-handler.ts
  - vex-app/src/main/ipc/register-all.ts
  - vex-app/src/main/ipc/cancel.ts
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change:
  - vex-app/src/shared/ipc/**
  - vex-app/src/shared/schemas/**
  - vex-app/src/shared/types/bridge/**
  - vex-app/src/preload/**
  - vex-app/src/main/ipc/register-handler.ts
  - vex-app/src/main/ipc/register-all.ts
  - vex-app/src/main/ipc/cancel.ts
  - vex-app/src/main/ipc/cancel-helpers.ts
related:
  - module.vex-app.preload-channels-events-errors
  - module.vex-app.shared-schemas-bridge-types
  - module.vex-app.main-ipc-engine-orchestration
  - module.vex-app.main-bootstrap-lifecycle
  - boundary.process-boundaries
---

# boundary.ipc-contracts — Channel + Event + Result + Cancellation

## What this boundary defines

The wire contract between renderer (via preload bridge) and Electron main. All shapes are Zod schemas in `vex-app/src/shared/schemas/**`; constants in `vex-app/src/shared/ipc/{channels,result,envelope}.ts`. Types derived via `z.infer<typeof Schema>` and exposed in `vex-app/src/shared/types/bridge/**`.

## Inventory (verified at `cf05003`)

- **Channels (`CH`)**: 92–93 request constants across 24 request domains. (Reported as 92 by P1 agent; 93 by Round-2 verification — minor counting drift on whether `vex:cancel` counts; either way the contract is the same.)
- **Events (`EV`)**: 10 event constants across system / docker / database / updater / engine.
- **VEX_DOMAINS**: 29.
- **VEX_ERROR_CODES**: 54.
- **Preload surface**: 10 shell domains + 13 agent domains.

## Crossing semantics

| Hop | Validation | Where it lives |
|---|---|---|
| Renderer → Preload | renderer-side input prep; preload zod input schema | `preload/{shell,agent}/*.ts` |
| Preload → Main (request) | envelope shape (`shared/ipc/envelope.ts`) + per-channel input schema | `main/ipc/register-handler.ts` |
| Main → Engine | dynamic import seam; engine input is engine's own contract | `main/ipc/<domain>/_engine-dispatch.ts` and per-handler files |
| Main → Preload (response) | output schema (`outputSchema` arg to `registerHandler`); `isValidVexErrorShape` rejects malformed error envelopes | `register-handler.ts` |
| Preload → Renderer (response) | preload returns `Result<T, VexError>`; renderer hooks consume typed bridge | `preload/_dispatch.ts` |
| Main → Preload (event) | broadcast via `BrowserWindow.webContents.send(EV.*, payload)` | `main/agent/*-bridge.ts`, control/database/docker/system publishers |
| Preload → Renderer (event) | event allowlist + zod re-validate before forwarding | `preload/_dispatch.ts subscribe` |

## Reserved / unbridged constants (confirmed)

- `CH.onboarding.providerListModels` — channel defined, no preload method, no main handler today.
- `CH.onboarding.providerTest` — same.
- `CH.updater.check` — same (F12: updater is placeholder-only).
- `EV.system.*` (logLine, resume) — published-side may exist, no preload subscriber method.
- `EV.docker.daemonChanged` — published by docker layer, no preload subscriber.
- `EV.updater.available` — defined, no live publisher (F12).

(F5 RESOLVED, Bundle B: `EV.engine.controlState` is now bridged — preload exposes `onControlState` via `subscribe(EV.engine.controlState, controlStateEventSchema, cb)`, consumed by renderer `useControlStateLiveSync`. No longer an unbridged constant.)

These constants stay in the inventory intentionally (don't delete) but must be flagged on every audit until either bridged or removed.

## Error model

`shared/ipc/result.ts` defines:
- `VexError` with `{ domain: VexDomain, code: VexErrorCode, message: string, correlationId?: string, redacted?: boolean }`.
- `Result<T, E = VexError>` is the canonical successful/failed envelope.
- 54 closed-set `VEX_ERROR_CODES` (e.g. `provider.unavailable`, `approvals.expired`, `internal.cancelled`, `feature_unavailable`).
- 29 closed-set `VEX_DOMAINS` (e.g. `chat`, `mission`, `approvals`, `runtime`, `sessions`, `secrets`, `wallets`, `provider`).
- Compile-time exhaustiveness assertions (`result.ts:318-324`) — adding a code/domain to the union without the array breaks the build. Intentional.

## Cancellation

- Uniform envelope: every request carries a `correlationId`.
- Preload registers an `AbortController` per `correlationId`; renderer calls `window.vex.cancel(correlationId)` to abort.
- Main's `register-handler` exposes the AbortSignal to handlers; handlers MUST honor it (chat, mission, runtime do; verify in module doc for any new domain).
- Normalized cancel error: `internal.cancelled` code in canonical `Result` shape.
- Cleanup in `finally` of `register-handler` prevents stale entries in the cancel registry.

## Invariants

- EVERY handler goes through `register-handler.ts`. No bare `ipcMain.handle()` calls anywhere — boundary check.
- EVERY preload bridge method goes through `invokeWithSchema()` or `subscribe()` (no raw `ipcRenderer.invoke`/`on` exposure).
- Renderer NEVER references `CH.*` / `EV.*` constants directly; renderer talks to `window.vex.<domain>.<method>`.
- Adding a new error code or domain requires updating both the type union and the runtime array — exhaustiveness assertions enforce.
- Output schemas MUST be declared for handlers that return data; output validation is the only thing preventing main from accidentally leaking sensitive shapes to renderer.
- All preload event subscribers re-validate payloads — defense-in-depth.

## Refresh triggers

Any change to `channels.ts`, `result.ts`, `envelope.ts`, `preload/**`, `register-handler.ts`, `register-all.ts`, `cancel.ts`, `shared/schemas/**`, or `shared/types/bridge/**`.

## Cross-references

- `module.vex-app.preload-channels-events-errors` — full per-channel/event/error inventory tables.
- `module.vex-app.shared-schemas-bridge-types` — schema-by-schema map.
- `module.vex-app.main-ipc-engine-orchestration` — handler-side `registerHandler` invariants, cancel registry implementation.
- `boundary.process-boundaries` — what's allowed to cross at all.
