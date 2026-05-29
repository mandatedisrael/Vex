---
id: boundary.process-boundaries
kind: boundary
paths:
  - vex-app/src/main/**
  - vex-app/src/preload/**
  - vex-app/src/renderer/**
  - vex-app/src/shared/**
  - vex-app/scripts/check-process-boundaries.mjs
  - src/vex-agent/**
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change:
  - vex-app/src/main/**
  - vex-app/src/preload/**
  - vex-app/src/renderer/**
  - vex-app/src/shared/**
  - vex-app/scripts/check-process-boundaries.mjs
  - .claude/CLAUDE.md
  - .claude/skills/vex-process-boundaries/**
related:
  - module.vex-app.main-bootstrap-lifecycle
  - module.vex-app.main-ipc-engine-orchestration
  - module.vex-app.preload-channels-events-errors
  - module.vex-app.shared-schemas-bridge-types
  - module.vex-app.renderer-appshell-runtime
  - module.vex-app.renderer-onboarding-bootstrap-secrets
  - module.vex-agent.engine-runtime-events
---

# boundary.process-boundaries — Renderer ↔ Preload ↔ Main + Engine

## Who owns what

| Process | Trust | Owns | Cannot |
|---|---|---|---|
| `vex-app/src/main` | privileged | Electron app, OS access, filesystem, Postgres pool, Docker CLI, vault, keystore, signing authority, dynamic-import of `@vex-agent` engine | Direct DOM/UI; renderer never sees raw IPC handles |
| `vex-app/src/preload` | bridge (sandbox + contextIsolation) | `window.vex` typed surface; zod validation of renderer inputs and event payloads; dispatch helpers; AbortController per correlationId | Never expose raw `ipcRenderer`, `electron`, `node:*`, DB, Docker, wallet, or `src/vex-agent` |
| `vex-app/src/shared` | pure (no IO) | Zod schemas, bridge types, channel constants, error codes, embedding defaults | No imports from `vex-app/src/{main,preload,renderer}`, `src/vex-agent`, or Node IO modules |
| `vex-app/src/renderer` | untrusted UI | React UI, TanStack Query cache, Zustand stores, slash dispatch, form state | Never import `electron`, `node:*`, DB, Docker, wallet, `src/vex-agent`, or any `@vex-lib` module that pulls those |
| `src/vex-agent` | canonical engine runtime | Run lifecycle, tools, repos, mission/wake/compact, inference, prompts | Loaded via dynamic import from main; never imported by preload, shared, or renderer |
| `src/lib`, `src/tools`, `src/providers`, `src/utils`, `src/config`, `src/constants` | root MCP/CLI library | Crypto, wallet, vault, dotenv, http, diagnostics, protocol clients | Only PURE subsets are aliased into renderer via `@vex-lib/agent-config`, `@vex-lib/embedding-constants`, `@vex-lib/diagnostics/bug-report-schema` |

## Forbidden imports (renderer)

`vex-app/scripts/check-process-boundaries.mjs` enforces:
- No `electron`, `node:*`, `fs`, `path`, `pg`, `dockerode`, `child_process` imports.
- No `src/vex-agent` import.
- No `@vex-lib/wallet`, `@vex-lib/local-secret-vault`, `@vex-lib/db`, `@vex-lib/runtime-env`, `@vex-lib/embedding`, `@vex-lib/openrouter-client` imports.
- Allowed `@vex-lib/*` modules are pure metadata/schemas only — confirmed list lives in this check script.

## Crossing rules

| From | To | Form | Why |
|---|---|---|---|
| Renderer → Preload | `window.vex.<domain>.<method>(input)` | typed bridge | hides IPC; preload validates input |
| Preload → Main | `ipcRenderer.invoke(CH.<domain>.<method>, envelope)` | channel + envelope | trusted-sender check happens main-side |
| Preload → Renderer (events) | `ipcRenderer.on(EV.<domain>.<event>, ...)` + zod re-validate → callback | event allowlist | renderer untrusted; defense-in-depth |
| Main → Engine | dynamic `await import("@vex-agent/...")` from privileged handler | dynamic import seam | keeps engine off renderer; preserves boundary at link time |
| Main → Preload (events) | `BrowserWindow.webContents.send(EV.*, payload)` | broadcast | renderer subscribes via preload `_dispatch.subscribe` |
| Main → Renderer (direct) | NOT ALLOWED — always go via preload + zod allowlist | n/a | n/a |
| Engine → Bridge subscribers | engine buses (`controlBus`, `transcriptBus`, `streamBus`) → main `agent/*-bridge.ts` → `BrowserWindow.send` | bus subscriptions in main only | engine knows nothing about Electron |

## Key invariants

- `BrowserWindow` config: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`. Devtools only when unpackaged. Verified by `vex-app/src/main/windows/main-window.ts:139-150`.
- `app://vex` protocol with host/path containment; no production `file://` loading (`vex-app/src/main/protocol/app-protocol.ts:20-58`).
- Deny-all permission handlers for permission checks, requests, device, display media (`vex-app/src/main/permissions.ts:11-27`).
- Navigation policy in `windows/main-window.ts:171-187` blocks `window.open` and external navigation outside allowed URLs; only allowlisted external URLs forwarded to `shell.openExternal`.
- Every IPC handler MUST go through `registerHandler` (no direct `ipcMain.handle` calls anywhere).
- Engine bridges (transcript / stream / control) re-validate engine payloads via shared schemas BEFORE broadcast.
- Preload event subscribers re-validate event payloads BEFORE forwarding to renderer callback.
- Fuses applied at packaging time via `afterPack.mjs`.

## What's currently leaking or fragile

- **F5 — control-state. RESOLVED (Bundle B).** Preload now exposes `onControlState` (`preload/agent/engine.ts`), re-validating each payload via `controlStateEventSchema` before forwarding (third validation layer). Renderer `useControlStateLiveSync` consumes it. The publisher is no longer one-sided.
- **Round-2 finding (renderer-clean spot-check).** Current renderer imports are pure metadata/schemas only. Any future `@vex-lib/*` import in renderer must be re-checked against `check-process-boundaries.mjs`.
- **Runtime bridge types (F6). RESOLVED (Bundle B).** `RuntimeBridge` + renderer hooks now declare the per-action discriminated unions; the legacy `RuntimeRequestResult` alias was deleted. Type and runtime shape are back in sync.

## Refresh triggers

Any change to: BrowserWindow config, app-protocol, permissions, `check-process-boundaries.mjs`, preload `_dispatch`, `registerHandler`, `register-all`, agent bridges, or the renderer's import surface for `@vex-lib/*`.
