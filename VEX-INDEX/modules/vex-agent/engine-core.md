---
id: module.vex-agent.engine-core
kind: module
paths:
  - "src/vex-agent/engine/core/turn.ts"
  - "src/vex-agent/engine/core/turn-loop.ts"
  - "src/vex-agent/engine/core/turn-loop-*.ts"
  - "src/vex-agent/engine/core/hydrate.ts"
  - "src/vex-agent/engine/core/context-band.ts"
  - "src/vex-agent/engine/core/stop-conditions.ts"
  - "src/vex-agent/engine/core/transcript-integrity.ts"
  - "src/vex-agent/engine/core/recall-seed.ts"
  - "src/vex-agent/engine/core/run-tool.ts"
  - "src/vex-agent/engine/core/tool-output-overflow.ts"
  - "src/vex-agent/engine/core/operator-instructions.ts"
source_commit: dee0d08
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/vex-agent/engine/core/turn.ts"
  - "src/vex-agent/engine/core/turn-loop.ts"
  - "src/vex-agent/engine/core/turn-loop-*.ts"
  - "src/vex-agent/engine/core/hydrate.ts"
  - "src/vex-agent/engine/core/context-band.ts"
  - "src/vex-agent/engine/core/stop-conditions.ts"
  - "src/vex-agent/engine/core/transcript-integrity.ts"
  - "src/vex-agent/engine/core/recall-seed.ts"
  - "src/vex-agent/engine/core/run-tool.ts"
  - "src/vex-agent/engine/core/tool-output-overflow.ts"
  - "src/vex-agent/engine/core/operator-instructions.ts"
  - "src/vex-agent/engine/types.ts"
  - "src/vex-agent/engine/ingress.ts"
related:
  - module.vex-agent.engine-runner
  - module.vex-agent.engine-runtime-events
  - module.vex-agent.engine-mission
---

# module.vex-agent.engine-core

## Purpose

Implements the fundamental turn-execution kernel of the Vex agent engine: a single
inference round-trip (`executeTurn`), the iterating turn loop (`runTurnLoop`), session
hydration (`hydrateEngineSession`), context-pressure band classification, stop-condition
taxonomy, in-flight transcript repair, operator-interrupt injection, tool-output overflow
handling, recall seed resolution, and a direct privileged tool invocation path (`runTool`).
All higher-level runners (agent, mission, subagent) compose these primitives; vex-app
main drives them via dynamic `import("@vex-agent/engine/index.js")`.

## Retrieval keywords

- turn loop, turn execution, inference round-trip, executeTurn, runTurnLoop
- session hydration, hydrateEngineSession, EngineContext, HydratedSession
- context band, pressure band, computeBand, barrier, critical, ContextUsageBand
- stop conditions, StopReason, BusinessStopReason, RuntimeStopReason, isResumablePause
- transcript repair, orphaned tool calls, repairOrphanedToolCalls
- operator interrupt, operator_interrupt, addOperatorInstruction, appendPendingOperatorInstructions
- tool output overflow, persistToolResultWithOverflow, tool_output_blobs, blob stub
- recall seed, effectiveRecallSeed, wake recall, post-compact recall
- run tool, direct tool invoke, runTool, privileged tool
- deferred assistant message save, saveAssistantMessage, canonical batch prefix
- compact forced fallback, critical band, tryCriticalBandFallback
- approval break, paused_approval, processTurnToolBatch
- wallet policy, resolveWalletPolicy, buildSessionWalletResolution
- turn-loop helpers, turn-loop-tool-batch, turn-loop-critical-fallback
- inferenceAborted, chat_stopped, stop generating, abort signal

## State owned

- No DB tables owned directly. All DB writes are delegated to repos and the events layer.
- In-memory per-`runTurnLoop` call: `liveMessages` array, `currentTokenCount`, `currentSummary`,
  `lastSeenOperatorMessageId`, `postCompactBridgeRemaining`, `criticalNoopCounter`,
  `skipCriticalCheckNextIter`.
- `tool_output_blobs` table: written by `persistToolResultWithOverflow` on overflow paths;
  TTL-expired by the blobs repo. Blob content is never re-read by this module — the stub
  stub that reaches the LLM references the key for downstream `tool_output_read` calls.
- `approval_queue` + `approval_intents` rows: written atomically by `processTurnToolBatch`
  on approval break (single transaction: queue + intent + mission-status flip).

## Boundary crossings

- **DB (read + write)**: repos from `@vex-agent/db/repos/*` — messages, sessions, session-memories,
  mission-runs, knowledge, usage, approvals, approval-intents, tool-output-blobs,
  runner-leases (read-only for control-emit lease check). Transaction via `withTransaction`
  from `@vex-agent/db/client.js`.
- **Inference (provider call)**: `runStreamingInference` from `@vex-agent/inference/stream-consumer.js`
  called once per `executeTurn`. Provider/config passed in; no resolution in this module.
- **Tool dispatch**: `dispatchTool` from `@vex-agent/tools/dispatcher.js` called per tool call
  in `processTurnToolBatch` and `runTool`.
- **Event buses** (`@vex-agent/engine/events/index.js`): `streamDeltaBus` (ephemeral token stream),
  `appendMessage`/`appendEngineMessage` (transcript bus write + post-COMMIT notify). Also
  `controlStateBus` from `../runtime/control-bus.js` (lazy dynamic import in
  `turn-loop-control-emit.ts`).
- **Compact jobs**: `maybeRunForcedCompactFallback` from
  `@vex-agent/engine/compact-jobs/forced-fallback.js` (called at critical band and before wake).
- **Prompt stack**: `buildPromptStack` + per-turn helpers (`buildContextPressureBanner`,
  `buildResumePacket`, `buildToolCatalogPrompt`) from `../prompts/*`.
- **Memory policy**: threshold constants and `classifyPressure` re-exported from
  `@vex-agent/memory/policy.js` via `context-band.ts`.
- **Bug reporting**: `getBugReportSink` + `emitBugReportSafe` (dynamic import in
  `turn-loop-bug-emit.ts`) for critical-band escalation.
- **Control observe**: `observeAndApplyControl` from `../runtime/lease-and-status.js`
  (dynamic import in `turn-loop-observe.ts`).

## File map

- `src/vex-agent/engine/core/turn.ts:66 executeTurn` — single inference round-trip: build prompt, run streaming inference, log usage/token-count, emit stream deltas. Does NOT save assistant message — deferred to caller. Key exports: `executeTurn`, `saveAssistantMessage` (:258), `SingleTurnResult` (:35).
- `src/vex-agent/engine/core/turn-loop.ts:77 runTurnLoop` — outer iteration loop: entry guards → critical-band check → prompt stack → executeTurn → tool batch or text response → post-compact bookkeeping. Key exports: `runTurnLoop`, `TurnLoopConfig` (:56), `TurnLoopResult` (:63).
- `src/vex-agent/engine/core/turn-loop-tool-batch.ts:111 processTurnToolBatch` — dispatch batch: calls dispatchTool per toolCall, handles approval break (atomic tx: queue+intent+paused_approval), engine signals (stop_mission, complete_subagent, defer_until, compact_committed), deferred assistant-message save, overflow-aware tool-result persist. Key exports: `processTurnToolBatch`, `ToolBatchOutcome`, `StopPayload`.
- `src/vex-agent/engine/core/turn-loop-critical-fallback.ts:47 tryCriticalBandFallback` — proactive forced compact at critical band, noop counter + skip-one-shot state machine, escalation to paused_error + bug-emit. Key exports: `tryCriticalBandFallback`, `CriticalBandOutcome`, `COMPACT_MAX_CONSECUTIVE_NOOPS`.
- `src/vex-agent/engine/core/turn-loop-iteration-entry.ts:36 runIterationEntryGuards` — ordered guards: abort signal → pending control request (observe-and-apply) → runtime stop conditions. Key exports: `runIterationEntryGuards`, `IterationEntryOutcome`.
- `src/vex-agent/engine/core/turn-loop-text-response.ts:32 handleTextResponse` — text-only turn result: deferred save, mission-run continue marker vs chat break. Key exports: `handleTextResponse`, `TextResponseOutcome`.
- `src/vex-agent/engine/core/turn-loop-post-compact.ts:43 applyPostCompactBookkeeping` — after any compact commit: reload live messages, merge operator interrupts, set last-checkpoint, refresh summary, reset token-count and bridge counter. Key exports: `applyPostCompactBookkeeping`, `PostCompactStateUpdates`.
- `src/vex-agent/engine/core/turn-loop-waiting-for-wake.ts:26 applyWaitingForWakePostBatch` — pre-wake forced compact if critical, flip mission run to paused_wake. Key exports: `applyWaitingForWakePostBatch`.
- `src/vex-agent/engine/core/turn-loop-control-emit.ts:19 emitTurnLoopControlState` — emits a `controlStateBus` event after observe-and-apply applies a paused_user / stopped transition at the loop boundary. Key exports: `emitTurnLoopControlState`.
- `src/vex-agent/engine/core/turn-loop-state-init.ts:35 armPostCompactBridge` — one-shot init: arms post-compact bridge counter from `sessions.checkpoint_generation`, builds per-loop band-transition observer. Key exports: `armPostCompactBridge`, `createBandObserverWithLog`, `BandObserver`.
- `src/vex-agent/engine/core/turn-loop-observe.ts:28 observePendingControlRequest` — puzzle-03 iteration-boundary observe; dynamic-imports `observeAndApplyControl` from runtime. Key exports: `observePendingControlRequest`, `ObserveControlOutcome`.
- `src/vex-agent/engine/core/turn-loop-prompt-stack.ts:32 buildTurnPromptStack` — per-turn prompt assembly: pressure banner, resume packet (bridge counter), tool catalog, memory routing. Key exports: `buildTurnPromptStack`, `TurnPromptStackResult`.
- `src/vex-agent/engine/core/turn-loop-bug-emit.ts:18 emitCompactUnableAtCriticalBug` — critical-band escalation bug report via dynamic import of sink. Key exports: `emitCompactUnableAtCriticalBug`.
- `src/vex-agent/engine/core/hydrate.ts:79 hydrateEngineSession` — reconstruct EngineContext + messages + summary + tokenCount from DB. Resolves sessionKind (mission > session.mode), sessionPermission, wallet selection, wallet policy. Key exports: `hydrateEngineSession`, `HydratedSession` (:18), `resolveWalletPolicy` (:49), `buildSessionWalletResolution` (:72).
- `src/vex-agent/engine/core/context-band.ts:40 computeBand` — classify token-count fraction into pressure band; re-exports policy thresholds; `createBandObserver` closure for per-loop transition tracking. Key exports: `ContextUsageBand`, `computeBand`, `isPressureBarrier` (:55), `isPressureCritical` (:63), `pressureFraction` (:112), `createBandObserver` (:93), `bandRank` (:69).
- `src/vex-agent/engine/core/stop-conditions.ts:54 isBusinessStop` — pure classification of StopReason into business stops / runtime pauses / resumable pauses; `evaluateRuntimeStopConditions` checks iteration + timeout guards. Key exports: `isBusinessStop`, `isRuntimePause`, `isResumablePause`, `shouldTerminateRun`, `evaluateRuntimeStopConditions`.
- `src/vex-agent/engine/core/transcript-integrity.ts:48 repairOrphanedToolCalls` — pure in-flight repair of orphaned tool_calls in the provider message array (no DB writes). Key exports: `repairOrphanedToolCalls`, `RepairOutcome` (:33), `TOOL_RESULT_PLACEHOLDER_CONTENT` (:30).
- `src/vex-agent/engine/core/recall-seed.ts:63 effectiveRecallSeed` — pure priority resolver for semantic recall seed: post-wake > mission-run history > empty-mission themes > chat fallback. Key exports: `effectiveRecallSeed`, `EffectiveRecallSeedInput` (:26), `LastEngineMessageHint` (:48), `findLastUserInput` (:124).
- `src/vex-agent/engine/core/run-tool.ts:34 runTool` — direct tool invocation bypassing the LLM; builds a minimal `InternalToolContext` with `approved:true`, calls `dispatchTool`. Key export: `runTool`.
- `src/vex-agent/engine/core/tool-output-overflow.ts:38 persistToolResultWithOverflow` — inline tool-result persist when small, blob externalization when over `TOOL_OUTPUT_OVERFLOW_BYTES`; fallback to inline on blob write failure. Key exports: `persistToolResultWithOverflow`.
- `src/vex-agent/engine/core/operator-instructions.ts:37 addOperatorInstruction` — write a user message with `operator_interrupt` metadata; `addOperatorCue` writes the engine cue; `appendPendingOperatorInstructions` merges new interrupt rows into liveMessages between iterations. Key exports: `addOperatorInstruction`, `addOperatorCue`, `appendPendingOperatorInstructions`, `maxOperatorInstructionId`, `OPERATOR_INTERRUPT_MESSAGE_TYPE`.

## Key types & invariants

- `EngineContext` (`src/vex-agent/engine/types.ts:239`) — immutable context for the duration of a turn loop; carries `sessionPermission`, `sessionKind`, `missionRunId`, wallet selection and `walletPolicy`. **No model field** — model is global per ADR-0001.
- `WalletPolicy` (`src/vex-agent/engine/types.ts:233`) — discriminated union `none | mission_allowed | invalid`; resolved once at hydration from the active run's frozen contract snapshot. Fail-closed on missing/malformed/empty snapshot.
- `HydratedSession` (`src/vex-agent/engine/core/hydrate.ts:18`) — snapshot of DB session state at engine entry; `loadedDocuments` is always an empty Map (caller populates).
- `TurnLoopConfig` (`src/vex-agent/engine/core/turn-loop.ts:56`) — `maxIterations`, `timeoutMs`, `contextLimit`, optional `buildToolsForBand` for band-driven tool catalog.
- `TurnLoopResult` (`src/vex-agent/engine/core/turn-loop.ts:63`) — text, toolCallsMade, pendingApprovals, stopReason, optional stopPayload.
- `SingleTurnResult` (`src/vex-agent/engine/core/turn.ts:35`) — content, toolCalls, promptTokens, `inferenceAborted` (captured race-free at stream exit), `usageObserved`.
- `ContextUsageBand` (`src/vex-agent/engine/core/context-band.ts:32`) — `"normal" | "warning" | "barrier" | "critical"`. Derived from one-turn-lagging `sessions.token_count`.
- `StopReason` (`src/vex-agent/engine/types.ts:150`) — union of `BusinessStopReason` (7 terminals) + `RuntimeStopReason` (9 resumable-or-transient). Business stops → permanent termination; runtime pauses → resumable by ingress, wake, or approval path.
- **Deferred-save invariant** (`turn-loop-tool-batch.ts:8–15`): `saveAssistantMessage` is called with the canonical batch prefix — only tool calls that entered dispatch. On `compact_committed`, remaining calls are drained with synthetic `batch_aborted_by_compact` results so provider tool_call/tool_result pairing stays balanced on reload.
- **Operator-interrupt idempotency**: `appendPendingOperatorInstructions` deduplicates by checking `existingIds` before pushing into liveMessages; always pushes an `[Engine: operator_interrupt cue]` system message after merging.
- **Token-count reset invariant**: after any committed compact, `currentTokenCount` is explicitly reset to 0 (`PostCompactStateUpdates.nextCurrentTokenCount: 0`) so tool-catalog pressure and banner revert to normal band on the next turn.
- **Approval transaction atomicity** (`turn-loop-tool-batch.ts:201`): queue row + intent row + mission-run status flip to `paused_approval` happen in a single `withTransaction` call.

## Capabilities (stable IDs)

- **CAP-engine-core-execute-turn**: single inference round-trip — build prompt, stream inference, log usage, emit deltas. Entry: `turn.ts:66 executeTurn`.
- **CAP-engine-core-run-turn-loop**: iterating multi-turn execution loop with entry guards, critical-band safety, tool dispatch, text response, post-compact bookkeeping, operator-interrupt merge. Entry: `turn-loop.ts:77 runTurnLoop`.
- **CAP-engine-core-hydrate-session**: reconstruct `EngineContext` + messages + summary + tokenCount from DB; resolve wallet policy from frozen contract snapshot. Entry: `hydrate.ts:79 hydrateEngineSession`.
- **CAP-engine-core-classify-pressure-band**: classify token fraction into `ContextUsageBand`; track per-loop transitions; gate tool catalog and dispatcher; trigger forced compact. Entry: `context-band.ts:40 computeBand`.
- **CAP-engine-core-forced-compact-critical**: runtime safety net at critical band — noop counter + skip-one-shot state machine → escalate to `paused_error` + bug-emit after `COMPACT_MAX_CONSECUTIVE_NOOPS`. Entry: `turn-loop-critical-fallback.ts:47 tryCriticalBandFallback`.
- **CAP-engine-core-classify-stop-reason**: classify `StopReason` as business-terminal vs runtime-resumable; evaluate iteration/timeout guards. Entry: `stop-conditions.ts:54 isBusinessStop`.
- **CAP-engine-core-repair-transcript**: in-flight idempotent repair of orphaned tool_calls in provider message array; no DB write. Entry: `transcript-integrity.ts:48 repairOrphanedToolCalls`.
- **CAP-engine-core-persist-tool-result-overflow**: inline persist vs blob externalization for tool results; fallback on blob write failure; preview stub with shape classifier. Entry: `tool-output-overflow.ts:38 persistToolResultWithOverflow`.
- **CAP-engine-core-operator-interrupt**: write operator_interrupt transcript rows; merge pending interrupts into liveMessages between loop iterations; add engine cue message. Entry: `operator-instructions.ts:37 addOperatorInstruction`.
- **CAP-engine-core-recall-seed**: pure priority resolver for semantic recall query seed across post-wake, mission-run, empty-mission, and chat contexts. Entry: `recall-seed.ts:63 effectiveRecallSeed`.
- **CAP-engine-core-run-tool-direct**: privileged direct tool invocation bypassing LLM; `approved:true` set on context; caller decides whether to persist result. Entry: `run-tool.ts:34 runTool`.

## Public API (consumed by)

- `engine/ingress.ts` (`routeUserMessage` / `submitOperatorInstruction`) → `addOperatorInstruction`, `addOperatorCue`, `appendPendingOperatorInstructions` from `operator-instructions.ts`.
- `engine/core/runner/agent.ts:75` → `hydrateEngineSession`, `runTurnLoop`, `computeBand`, `ContextUsageBand` from `hydrate.ts` / `turn-loop.ts` / `context-band.ts`.
- `engine/core/runner/mission-run.ts:114 runPreparedMissionStart`, `:217 resumePreparedMissionRun` → `hydrateEngineSession`, `runTurnLoop`, `computeBand`, `ContextUsageBand`.
- `engine/core/runner/setup-turn.ts:78` → `hydrateEngineSession`, `computeBand`.
- `engine/core/approval-runtime/post-tx.ts:122` → `hydrateEngineSession`, `buildSessionWalletResolution`.
- `engine/core/runner/mission-finalize.ts:79` → `shouldTerminateRun` (dynamic import of `stop-conditions.ts`).
- `engine/subagents/runner.ts:17` → `hydrateEngineSession`, `runTurnLoop`, `computeBand`.
- `engine/prompts/wallet-state.ts:19` → `buildSessionWalletResolution`.
- `engine/tools/dispatcher.ts:22` (type import) → `ContextUsageBand`.
- `engine/tools/registry.ts:20` (type import) → `ContextUsageBand`.
- `engine/tools/protocols/runtime.ts:18` (type import) → `ContextUsageBand`.
- **vex-app consumers (via `engine/index.js`)** — all vex-app IPC handlers access this module through the public barrel only; they do NOT import engine/core paths directly:
  - `vex-app/src/main/ipc/chat.ts:148` → dynamic `import("@vex-agent/engine/index.js")` → `submitOperatorInstruction` (which calls `processAgentTurn` in `runner/agent.ts`).
  - `vex-app/src/main/ipc/mission/start.ts:42` → dynamic import of `@vex-agent/engine/core/runner/mission.js` (out-of-scope runner; uses hydrate/turn-loop internally).
  - `vex-app/src/main/ipc/_shared/runtime-resume-dispatch.ts:135` → `engine/index.js` `resumeMissionRun`.
  - `runTool` is re-exported at `engine/index.ts:18` but has NO vex-app consumer as of this snapshot — no IPC handler calls it.

## Internal flow

**Single agent chat turn** (end-to-end within this module):

1. `hydrateEngineSession(sessionId)` — load session + messages + summary + tokenCount; build `EngineContext` (includes per-session wallet; no model field).
2. Caller (runner) resolves `provider` + `config` (global model via `resolveProvider` + `loadConfig` — **outside** this module).
3. `runTurnLoop(context, messages, summary, tokenCount, provider, config, tools, loopConfig, promptOptions, abortSignal?, inferenceAbortSignal?)`:
   a. `armPostCompactBridge` — set bridge counter from `checkpointGeneration`.
   b. `createBandObserverWithLog` — per-loop band-transition closure.
   c. **Iteration** (0 → maxIterations):
      - `runIterationEntryGuards` — abort? → `user_stopped`; control request (`observeAndApplyControl`) → `paused_user`/`stopped`; iteration/timeout → runtime stop.
      - `missionRunsRepo.incrementIterations` (mission runs only).
      - `tryCriticalBandFallback` — if band === "critical": try `maybeRunForcedCompactFallback`; committed → `applyPostCompactBookkeeping`; escalated → `compact_unable_at_critical`.
      - `buildTurnPromptStack` — pressure banner, resume packet (bridge), tool catalog, memory routing.
      - `executeTurn` — `buildPromptStack` + `repairOrphanedToolCalls` + `runStreamingInference` + `streamDeltaBus.emit` per chunk + `usageRepo.logUsage` + `sessionsRepo.updateTokenCount`.
      - If `inferenceAborted` and content: `saveAssistantMessage(..., { stopped:true })` → `chat_stopped` row; break with `user_stopped`.
      - If tool calls: `processTurnToolBatch` → `dispatchTool` per call → handle approval break (atomic tx) / engine signals / compact_committed / normal_complete.
      - If text only: `handleTextResponse` → deferred save + mission-run continue marker OR break on text.
   d. If exhausted without stop or text: `stopReason = "iteration_limit"`.

**Tool approval break** (`processTurnToolBatch`):
- On `result.pendingApproval`: assert `result.actionKind` set (fail-fast otherwise) → atomic tx: `approvalsRepo.enqueueWith` + `approvalIntentsRepo.createWith` (with TTL) + `missionRunsRepo.updateStatus("paused_approval")` → return `approval_break`.

**Post-compact bookkeeping** (`applyPostCompactBookkeeping`):
- Clear + reload `liveMessages` from DB → merge operator interrupts → set `last_checkpoint_at` (mission runs) → refresh `currentSummary` from DB → reset `currentTokenCount = 0` → arm bridge counter → reset noop counter → set skip-one-shot flag → write `compaction_committed` display marker.

## Dependencies

**Imports FROM:**
- `module.vex-agent.engine-runtime-events` — `appendMessage`, `appendEngineMessage`, `streamDeltaBus`, `toStreamDeltaEvent`, `controlStateBus` (lazy dynamic import in control-emit).
- `module.vex-agent.engine-mission` (Z2) — `buildPromptStack`, context-pressure, resume-packet, tool-catalog, memory-routing prompt builders; `maybeRunForcedCompactFallback` (compact-jobs/forced-fallback); `POST_COMPACT_BRIDGE_CYCLES` from memory/policy.
- `module.vex-agent.inference` (Z3) — `runStreamingInference`; `InferenceProvider`, `InferenceConfig`, `ProviderMessage`, `ParsedToolCall`, `ToolDefinition` types.
- `module.vex-agent.tools` (Z3) — `dispatchTool`, `riskLevelFromActionKind`, `ContextUsageBand` (type); `getOpenAITools` is called by runners via `registry` not this module directly.
- `module.vex-agent.db` (Z4) — repos: `messages`, `sessions`, `session-memories`, `mission-runs`, `usage`, `knowledge`, `approvals`, `approval-intents`, `tool-output-blobs`, `session-links`, `missions`, `runner-leases` (read-only); `withTransaction`; `client.js` pool.
- `module.vex-agent.engine-runner` (sibling, out-of-scope) — `observeAndApplyControl` from `runtime/lease-and-status.js` (lazy dynamic import in turn-loop-observe); `getLease` from `db/repos/runner-leases` (lazy in control-emit).
- Z5 root — `@utils/logger` (winston); `getBugReportSink` / `emitBugReportSafe` from `lib/diagnostics`.
- `buildIntentPreview` / `buildPolicySnapshot` from `./approval-intent-preview.ts` (out-of-scope sibling — not covered by this audit agent).

**Consumed BY:**
- `engine/ingress.ts` — `addOperatorInstruction`, `addOperatorCue`, `appendPendingOperatorInstructions`.
- `engine/core/runner/*` (module.vex-agent.engine-runner, out-of-scope) — `hydrateEngineSession`, `runTurnLoop`, `computeBand`, `shouldTerminateRun`, `buildSessionWalletResolution`.
- `engine/core/approval-runtime/*` (out-of-scope) — `hydrateEngineSession`, `buildSessionWalletResolution`.
- `engine/subagents/runner.ts` — `hydrateEngineSession`, `runTurnLoop`, `computeBand`.
- `engine/prompts/wallet-state.ts` — `buildSessionWalletResolution`.
- `engine/tools/dispatcher.ts` + `registry.ts` + `protocols/runtime.ts` — `ContextUsageBand` (type).
- `engine/index.ts` — re-exports `runTool` to vex-app layer.
- `vex-app/src/main/ipc/chat.ts:148` — `submitOperatorInstruction` via `engine/index.js` dynamic import.

## Cross-references

- ADR compliance: `audits/current/coverage-gaps.md#CAP-engine-core-execute-turn`
- ADR compliance: `audits/current/coverage-gaps.md#CAP-engine-core-run-turn-loop`
- ADR compliance: `audits/current/coverage-gaps.md#CAP-engine-core-hydrate-session`
- ADR compliance: `audits/current/coverage-gaps.md#CAP-engine-core-classify-pressure-band`
- ADR compliance: `audits/current/coverage-gaps.md#CAP-engine-core-forced-compact-critical`
- ADR compliance: `audits/current/coverage-gaps.md#CAP-engine-core-classify-stop-reason`
- ADR compliance: `audits/current/coverage-gaps.md#CAP-engine-core-repair-transcript`
- ADR compliance: `audits/current/coverage-gaps.md#CAP-engine-core-persist-tool-result-overflow`
- ADR compliance: `audits/current/coverage-gaps.md#CAP-engine-core-operator-interrupt`
- ADR compliance: `audits/current/coverage-gaps.md#CAP-engine-core-recall-seed`
- ADR compliance: `audits/current/coverage-gaps.md#CAP-engine-core-run-tool-direct`
- Related decisions: `decisions/ADR-0001-global-model-session-wallet.md`
- Related module: `module.vex-agent.engine-runner` (runners use hydrate + runTurnLoop)
- Related module: `module.vex-agent.engine-runtime-events` (event buses written by executeTurn + appendMessage)
- Related module: `module.vex-agent.engine-mission` (compact-jobs forced-fallback, prompt builders)

## Refresh triggers

- Any file matching `stale_when_paths_change` above changes since commit `dee0d08`.
- `src/vex-agent/engine/types.ts` changes (EngineContext, StopReason, WalletPolicy, MessageType).
- `src/vex-agent/engine/ingress.ts` changes (operator-instructions call sites).
- `src/vex-agent/memory/policy.js` changes (pressure thresholds, POST_COMPACT_BRIDGE_CYCLES).
- `src/vex-agent/db/migrations/*` changes that add new columns to `sessions` or `mission_runs`
  relevant to hydration (e.g. wallet columns).

## Open questions

1. **`runTool` has zero vex-app IPC consumers** at this snapshot — the shell settings panel
   referenced in its doc comment has no wired IPC handler. Is this intentional (unbuilt feature),
   or was the IPC handler removed? `engine/index.ts:18` re-exports it, suggesting intent.

2. **`effectiveRecallSeed` has no production caller** — the legacy `fetchSessionEpisodeRecallBlock`
   caller was deleted and the doc comment notes this survives as "future consumer (PR3/PR4)". Should
   this be considered dead weight or is PR3/PR4 planned soon?

3. **`recall-seed.ts` does not feed into `executeTurn` directly** — the tool-catalog
   `memory_recall` mechanism and any future prefetch are the intended consumers, but neither
   calls this function in the current snapshot. Confirm integration point.

4. **`turn-loop-tool-batch.ts` approval TTL is hardcoded** at 1h (`APPROVAL_TTL_MS = 60 * 60 * 1000`,
   line 66), with a comment "phase 7 will introduce per-kind TTLs". Is phase 7 still planned?
   This is a single constant easy to miss in policy reviews.

5. **`runTool` uses `DEFAULT_CONTEXT_LIMIT = 128_000`** (hardcoded, line 25) when building
   the `contextUsageBand`. If `AGENT_CONTEXT_LIMIT` env is larger, the band classification
   for direct invocations will be pessimistic (over-restricting tool access at pressure).
   Should this read from parsed env config?

6. **`BATCH_ABORTED_BY_COMPACT_OUTPUT`** is written to `liveMessages` and persisted as a tool
   result but does NOT go through `persistToolResultWithOverflow`. Oversized compact-aborted
   results are therefore always inline. Is this intentional given these are synthetic outputs?
