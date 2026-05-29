---
id: module.vex-app.preload-shared-contracts
kind: module
paths:
  - "vex-app/src/preload/**"
  - "vex-app/src/shared/ipc/**"
  - "vex-app/src/shared/schemas/**"
  - "vex-app/src/shared/types/bridge/**"
  - "vex-app/src/shared/types/bridge.ts"
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change:
  - "vex-app/src/preload/**"
  - "vex-app/src/shared/ipc/**"
  - "vex-app/src/shared/schemas/**"
  - "vex-app/src/shared/types/bridge/**"
  - "vex-app/src/shared/types/bridge.ts"
  - "vex-app/src/renderer/vex.d.ts"
  - "vex-app/src/main/ipc/register-handler.ts"
  - "vex-app/src/main/ipc/register-all.ts"
  - "vex-app/src/main/ipc/cancel*.ts"
  - "vex-app/src/main/agent/*-bridge.ts"
  - "vex-app/scripts/check-process-boundaries.mjs"
related:
  - module.vex-app.main-process
  - module.vex-app.renderer-appshell
  - module.vex-agent.engine-runtime-events
---

# vex-app Preload + Shared Contracts

## Purpose

Owns the renderer trust boundary: typed `window.vex` bridge, channel constants, Zod schemas,
Result/Error contracts, cancellation envelopes, and event subscriptions.

## Current inventory

- `preload/index.ts:34` exposes exactly one bridge object with `satisfies VexBridge`.
- Preload surface: 10 shell domains + 13 agent domains.
- `CH`: 93 request constants across 24 request domains, including unbridged/reserved updater constants.
- `EV`: 10 event constants across system/docker/database/updater/engine.
- `VEX_DOMAINS`: 29. `VEX_ERROR_CODES`: 54.
- Preload validates request inputs and subscribed events. Main validates success outputs and malformed error envelopes.

## Important gaps

- F5 RESOLVED (Bundle B): `EV.engine.controlState` is now bridged. `preload/agent/engine.ts` exposes `onControlState` (re-validates with `controlStateEventSchema` at the preload layer), `EngineEventsBridge` declares it, and renderer `useControlStateLiveSync(sessionId)` (mounted in `SessionPanel.tsx`) invalidates runtime-state + pending-approvals queries on each event. `ApprovalsRegion` RETAINS its 5s `refetchInterval` as a fast FALLBACK (the controlState emit is post-commit on lease release, not part of the approval transaction, so the event can be dropped at the preload Zod gate or fire pre-subscription); push is primary, the 5s poll is the safety net.
- F6 RESOLVED (Bundle B): runtime bridge methods now use the per-action discriminated unions (`RuntimeRequestPauseResult` / `RuntimeRequestStopResult` / `RuntimeRequestResumeResult` / `RuntimeCancelWakeResult`) matching the handlers. The legacy `RuntimeRequestResult` alias / `runtimeRequestResultSchema` was REMOVED from `shared/schemas/runtime.ts`.
- Constants without live bridge/handler: `CH.onboarding.providerListModels`, `CH.onboarding.providerTest`, `CH.updater.check`.
- Events not bridged to renderer: `EV.system.*`, `EV.docker.daemonChanged`, `EV.updater.available`. (`EV.engine.controlState` is now bridged — see F5 RESOLVED above.)
- Some legacy bridge barrels omit newer domain types; narrow imports currently avoid the issue.

## Refresh triggers

Any change to preload domain files, shared IPC channels/result/schemas/types, main handler registration,
engine bridge publishers, or process-boundary script.
