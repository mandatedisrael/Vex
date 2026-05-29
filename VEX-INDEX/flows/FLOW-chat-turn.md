---
id: FLOW-chat-turn
kind: flow
paths:
  - vex-app/src/renderer/features/appShell/SessionComposer.tsx
  - vex-app/src/renderer/lib/api/chat.ts
  - vex-app/src/preload/agent/chat.ts
  - vex-app/src/main/ipc/chat.ts
  - vex-app/src/main/agent/stream-bridge.ts
  - vex-app/src/main/agent/transcript-bridge.ts
  - src/vex-agent/engine/ingress.ts
  - src/vex-agent/engine/core/turn.ts
  - src/vex-agent/engine/core/turn-loop.ts
source_commit: 85ed941
indexed_at: 2026-05-29
stale_when_paths_change:
  - vex-app/src/renderer/features/appShell/SessionComposer.tsx
  - vex-app/src/renderer/lib/api/chat.ts
  - vex-app/src/renderer/lib/api/streams.ts
  - vex-app/src/renderer/stores/streamStore.ts
  - vex-app/src/preload/agent/chat.ts
  - vex-app/src/preload/agent/engine.ts
  - vex-app/src/main/ipc/chat.ts
  - vex-app/src/main/agent/stream-bridge.ts
  - vex-app/src/main/agent/transcript-bridge.ts
  - vex-app/src/shared/schemas/chat.ts
  - vex-app/src/shared/schemas/stream.ts
  - src/vex-agent/engine/ingress.ts
  - src/vex-agent/engine/core/turn.ts
  - src/vex-agent/engine/core/turn-loop.ts
related:
  - module.vex-app.renderer-appshell-runtime
  - module.vex-app.preload-channels-events-errors
  - module.vex-app.main-ipc-engine-orchestration
  - module.vex-app.main-agent-bridge
  - module.vex-agent.engine-runtime-events
  - module.vex-agent.engine-core
  - module.vex-agent.inference
  - ADR-0001-global-model-session-wallet
  - fix-plan.F1
---

# FLOW-chat-turn: User chat submit → engine turn → stream → transcript

## Trigger
User types in `SessionComposer` and presses Enter (or hits Submit). Active session must exist; vault must be unlocked (otherwise provider gate trips inside engine).

## Preconditions
- `setup-complete` marker present; renderer routed past `splash/systemCheck/docker/compose/migrations/wizard/unlock`.
- Vault unlocked, so `OPENROUTER_API_KEY` is in `process.env` (F1 boot-load + post-onboarding overwrite handles `.env`-side keys).
- `inference/registry.ts resolveProvider()` returns non-null. F4 caveat: `OpenRouterProvider.loadConfig()` calls models API every turn; transient API failure can still surface as `provider.unavailable`.
- ADR-0001: model is GLOBAL — handler reads `process.env.AGENT_MODEL`, not `sessions.model_id`.

## Steps

| # | caller (file:line symbol) | callee | state change | persistence / event | failure mode |
|---|---------------------------|--------|--------------|---------------------|---------------|
| 1 | `vex-app/src/renderer/features/appShell/SessionComposer.tsx onSubmit` | `useSubmitChat()` hook (lib/api/chat.ts) | local form `pending=true` | none | form validation rejects empty |
| 2 | `vex-app/src/renderer/lib/api/chat.ts useSubmitChat` | `window.vex.chat.submit({sessionId, content, correlationId})` | `streamStore.start(correlationId)` | none | preload zod validation errors |
| 3 | `vex-app/src/preload/agent/chat.ts submit` | `invokeWithSchema(CH.chat.submit, env, chatSubmitOutputSchema)` | preload allocates correlationId AbortController | request envelope | invalid envelope shape |
| 4 | `vex-app/src/main/ipc/chat.ts` (handler) registered by `registerHandler(CH.chat.submit, ...)` | trusted-sender check, input zod, `_ensure-engine-db-url`, dynamic import `@vex-agent/engine` | binds AbortController to correlationId | none | `feature_unavailable` if engine not bootable; `provider.unavailable` if registry returns null |
| 5 | engine dynamic import → `routeUserMessage` | `src/vex-agent/engine/ingress.ts routeUserMessage` | engine creates run claim (lease) | row update `runs.status='running'`, transcript append `user` message | lease conflict → 409-style error |
| 6 | `engine/ingress.ts` | `engine/core/turn.ts executeTurn` | runs `runTurnLoop` (`engine/core/turn-loop.ts:77`) | per-tick stream deltas → `streamBus.publish`; transcript-append on completion | provider call rejects → `appendMessage(error)` + emit |
| 7 | engine streamBus | `vex-app/src/main/agent/stream-bridge.ts` listener | sanitizes payload via shared schema (`shared/schemas/stream.ts`) | `BrowserWindow.send(EV.engine.stream, payload)` | malformed engine payload dropped (silent — see Open Q) |
| 8 | `preload/agent/engine.ts onStreamDelta` | renderer callback in `lib/api/streams.ts useStreamPreviewSync` | `streamStore.append(delta)` | renderer state | event drop if zod rejects |
| 9 | engine transcriptBus | `vex-app/src/main/agent/transcript-bridge.ts` | re-validates via shared schema | `BrowserWindow.send(EV.engine.transcript)` | malformed → drop |
| 10 | `preload/agent/engine.ts onTranscriptAppend` | renderer `useTranscriptLiveSync` | invalidate `messagesKeys.forSession(sessionId)` | TanStack Query refetch | none |
| 11 | turn completes | engine releases lease; final transcript event emitted | `streamStore.clear(correlationId)` (idle timeout 60s); transcript refetch shows assistant turn | row `runs.status='completed'` | provider failure → run status `paused_error` |
| 12 | post-turn (if context pressure) | Track 1 atomic compaction enqueues Track 2 (see FLOW-compaction-tracks) | n/a | `compact_jobs` row enqueued | Track 1 never blocks Track 2 |

## Invariants
- Chat handler MUST go through `registerHandler` for trusted-sender + zod input + output validation.
- Engine is dynamically imported from Electron main; renderer never imports `@vex-agent`.
- Stream events are sanitized BOTH on publish (engine → main bridge) AND on receive (preload zod) — defense-in-depth.
- Provider/model resolution is GLOBAL: `resolveProvider()` reads `process.env.AGENT_MODEL`/`AGENT_PROVIDER`/`OPENROUTER_API_KEY` only; no `sessions.model_id` lookup.
- `correlationId` flows: renderer → preload → main → engine; `vex:cancel` invocation triggers the matching AbortController.
- Transcript append is the authoritative event; stream preview is ephemeral and cleared on receive.

## Related modules / capabilities
- `module.vex-app.renderer-appshell-runtime` — `CAP-vexapp-ui-session-compose-submit`, `CAP-vexapp-ui-session-stream-preview`, `CAP-vexapp-ui-session-transcript-render`
- `module.vex-app.main-ipc-engine-orchestration` — `CAP-vexapp-chat-submit`, `CAP-vexapp-chat-cancel`, `CAP-vexapp-ipc-cancel-register`
- `module.vex-app.main-agent-bridge` — `CAP-vexapp-bridge-publish-stream`, `CAP-vexapp-bridge-publish-transcript`
- `module.vex-agent.engine-core` — `CAP-engine-execute-turn`, `CAP-engine-run-turn-loop`
- `module.vex-agent.inference` — F1 evidence (resolveProvider gates by env), F4 caveat (loadConfig per turn)

## Known failure modes
- **Provider unavailable.** Vault locked OR `.env` missing `AGENT_MODEL` OR OpenRouter models API transiently down → chat handler returns `provider.unavailable`. Renderer surfaces composer red banner ("No inference provider is available. Unlock Vex or complete provider setup, then retry.").
- **Cancellation.** User triggers cancel → `vex:cancel` invocation aborts the AbortController → engine receives signal → turn loop breaks at next yield → `appendMessage("cancelled")` → transcript refresh.
- **Sender mismatch.** Trusted-sender check in `registerHandler` rejects renderer that didn't originate from the privileged window.
- **F5 RESOLVED (Bundle B).** `EV.engine.controlState` now reaches the renderer via preload `onControlState` + `useControlStateLiveSync` (mounted in `SessionPanel`), which invalidates `runtimeKeys.state` on each event (30s fallback for missed events). Runtime status changes (pause/resume/stop) are pushed instead of poll-only. Chat itself was always unaffected.
