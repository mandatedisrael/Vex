---
id: module.vex-agent.engine-wake-subagents-prompts
kind: module
paths:
  - "src/vex-agent/engine/wake/**"
  - "src/vex-agent/engine/subagents/**"
  - "src/vex-agent/engine/prompts/**"
source_commit: c138af8
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/vex-agent/engine/wake/**"
  - "src/vex-agent/engine/subagents/**"
  - "src/vex-agent/engine/prompts/**"
  - "src/vex-agent/engine/core/turn.ts"
  - "vex-app/src/main/agent/wake-worker.ts"
  - "vex-app/src/main/index.ts"
  - "src/vex-agent/tools/dispatcher.ts"
  - "src/vex-agent/tools/internal/subagent/lifecycle.ts"
related:
  - module.vex-agent.engine-runner
  - module.vex-agent.engine-mission
  - module.vex-agent.engine-compact
  - module.vex-agent.tools-internal
  - ADR-0001-global-model-session-wallet
---

# Engine — Wake, Subagents, and Prompts

## Purpose

Three sub-areas in Z2 that share the engine's turn-loop and inference stack, indexed together
because they all compose the same `EngineContext` and ultimately run through or inject into
`executeTurn`:

1. **Wake** (`wake/`): drives the `loop_defer` → `paused_wake` → resume cycle. A
   process-local polling executor claims due `loop_wake_requests` rows, injects a
   `wake_due` banner, and calls `resumeMissionRun`. A companion `blob-refresh.ts`
   bumps tool-output blob TTLs before any resume path runs.

2. **Subagents** (`subagents/`): fully implemented child-session runner with structured
   message relay (to_parent / to_child / report_complete / request_parent). Deliberately
   disabled for new sessions at the dispatcher level (`subagent_spawn` commented out).
   Legacy DB rows with `is_subagent=true` can still be hydrated; those sessions will see
   the subagent prompt but reference disabled tool names — see Open questions.

3. **Prompts** (`prompts/`): sync layered builder `buildPromptStack` that assembles the
   full system prompt from 15+ files across constant, variable, contextual, and subagent
   layers. All LLM/DB-derived strings pass through `sanitizeForSystemPrompt` before
   injection to neutralize prompt-injection vectors.

## Retrieval keywords

- wake executor, loop_defer, paused_wake, defer/sleep, loop_wake_requests, blob TTL refresh
- subagent runner, child session, runSubagentEngine, relay, relayToParent, subagent_spawn
- prompt stack, buildPromptStack, system prompt, permission prompt, mission setup prompt
- mission run prompt, context pressure, resume packet, memory state, knowledge state
- tool catalog, tool map, sanitize, sanitizeForSystemPrompt, protocols prompt
- wallet state banner, memory routing, active knowledge block

## State owned

- `loop_wake_requests` — rows written by `handleLoopDefer` (tools); claimed (pending→consumed)
  by wake executor. One-pending-per-session partial unique index (mig 011).
- `tool_output_blobs` — TTL bumped by `refreshBlobTtlForRecentMessages` at every resume path.
- `subagent_messages` table — structured message rows (to_parent / to_child directions +
  message type: `report_complete`, `request_parent`). Written by relay functions; read by
  lifecycle handler.
- `session_links` — canonical parent↔child session graph; subagent runner reads
  `getSubagentSession` + `getParentSession` to locate the child session and hydrate parent
  context.
- `subagents` table — subagent config rows including `allowTrades`, `maxIterations`, `task`.
- No Zustand, event buses, or IPC owned by this module. Prompt builder is pure / stateless
  except `protocols.ts` which keeps a process-scoped `cached: string | null` for the
  constant protocols section (reset by `resetProtocolsPromptCache` in tests).

## Boundary crossings

- **DB (Z4)**: `loopWakeRepo.claimDue` + `missionRunsRepo.getRun` (wake); `messagesRepo.getLiveMessages`
  + `toolOutputBlobsRepo.refreshTtl` (blob refresh); `subagentsRepo.getById`, `sessionLinksRepo.*`,
  `subagentMessages.*` (subagent runner/relay); `compact-jobs/index.getBySessionAndGeneration`,
  direct `query`/`queryOne` on `sessions` and `messages` (resume packet).
- **Engine Z1** (runtime/lease): `claimRunLeaseAndFlipToRunning` → `createLeaseHandle` →
  `releaseLeaseAndEmitControlState` (wake executor, inside `handleClaimed`). Dynamic import
  to avoid circular dependency through the engine barrel.
- **Engine Z1** (ingress): `resumeMissionRun` called by wake executor via dynamic
  `import("@vex-agent/engine/index.js")`. This is the only back-edge into Z1 from Z2.
- **Engine Z1** (events): `appendEngineMessage` used to inject `wake_due` banner.
- **Engine Z1** (turn loop + hydrate): `runTurnLoop`, `hydrateEngineSession` consumed
  directly by `runSubagentEngine`.
- **Z3** (inference): `resolveProvider` + `loadConfig` called at top of `runSubagentEngine`
  (provider remains GLOBAL — ADR-0001); `loadEnvConfig` + `loadSubagentConfig` provide
  SUBAGENT_* env override for maxIterations, timeoutMs, contextLimit.
- **Z3** (tools registry): `getOpenAITools` + `computeBand` called inside
  `buildSubagentToolsForBand`; `getVisibleToolsByCategory` called inside
  `buildToolCatalogPrompt`.
- **Diagnostics / BugReport (Z5)**: `getBugReportSink` + `emitBugReportSafe` used in wake
  executor error path (dynamic import, fail-closed).
- **Z5** (wallet tools): `resolveSelectedAddressSet` + `buildSessionWalletResolution` used
  synchronously inside `buildWalletStateBanner`.
- **env**: `isWakeProviderConfigured()` reads `process.env.OPENROUTER_API_KEY` +
  `process.env.AGENT_MODEL` as a pre-claim gate. Subagent runner uses
  `loadSubagentConfig(loadEnvConfig())` which reads `SUBAGENT_MAX_ITERATIONS`,
  `SUBAGENT_TIMEOUT_MS`, `SUBAGENT_CONTEXT_LIMIT` (falling back to `AGENT_*` if unset).
- **No network, no wallet signing, no IPC**: these three sub-areas are engine-internal only.

## File map

### wake/

- `src/vex-agent/engine/wake/executor.ts:83 startWakeExecutor` — exported scheduler. Starts
  a `setTimeout`-based loop (default 2 s / batch 10). Returns `WakeExecutorHandle { stop() }`.
  Production `WakeDeps` built by `buildProductionDeps()` at module bottom; tests inject fakes.
  Key export: `isWakeProviderConfigured()`.
- `src/vex-agent/engine/wake/executor.ts:86 tick` — pure single pass. Pre-claim provider gate
  → `claimDue` → per-row `handleClaimed`. Returns `ClaimedWake[]` with outcome per row.
- `src/vex-agent/engine/wake/executor.ts:146 handleClaimed` — per-row: fetch run →
  re-check `paused_wake` → `claimRunLeaseAndFlipToRunning` → `injectWakeBanner` →
  `resumeMissionRun` → `releaseLeaseAndEmitControlState`.
- `src/vex-agent/engine/wake/blob-refresh.ts:25 refreshBlobTtlForRecentMessages` — scans
  last 50 live messages for overflow blobs (`payload.overflow===true`), bumps TTL to
  `TOOL_OUTPUT_TTL_MIN * 60_000`. Non-fatal: returns 0 on failure.

### subagents/

- `src/vex-agent/engine/subagents/runner.ts:49 runSubagentEngine` — main entry. Resolves
  provider → loads subagent config → discovers child session via `session_links` → hydrates
  parent context (for wallet + mission policy) → hydrates child session → builds
  `EngineContext` with defense-in-depth permission demotion (`allowTrades=false` always
  forces `restricted`) → runs `runTurnLoop` → conditionally relays result.
- `src/vex-agent/engine/subagents/relay.ts:12 relayToParent` — plain text relay (backward
  compat). Calls `subagentMessages.sendMessage(subagentId, "to_parent", content)`.
- `src/vex-agent/engine/subagents/relay.ts:17 relayToChild` — plain text relay to child.
- `src/vex-agent/engine/subagents/relay.ts:24 sendStructuredToParent` — structured message
  with `SubagentMessageType` and optional `payload` + `replyTo`.
- `src/vex-agent/engine/subagents/relay.ts:35 sendStructuredToChild` — structured message to child.
- `src/vex-agent/engine/subagents/relay.ts:44 getUnhandledFromChild` — parent reads pending
  `to_parent` messages.

### prompts/

- `src/vex-agent/engine/prompts/index.ts:91 buildPromptStack` — **single entry point**.
  Takes `EngineContext + PromptStackOptions`. Returns `string[]` (caller joins with `\n\n`).
  Layer order: base → runtime clock → contextPressureBanner → resumePacket →
  memoryStateBanner → knowledgeStateBanner → activeKnowledgeBlock → memoryRoutingPrompt →
  toolCatalogPrompt → tool-usage → protocols → permission → walletStateBanner →
  agent OR mission-setup OR mission-run → subagent (if `isSubagent`).
- `src/vex-agent/engine/prompts/base.ts:11 buildBasePrompt` — identity + dynamic aspect +
  memory/self-learning contract + current context IDs + loaded documents.
  `resolveAspect(ctx)` emits the active mode branch only; carries
  `TODO(subagent-disabled)` comment for `ctx.isSubagent` branch.
- `src/vex-agent/engine/prompts/agent.ts:7 buildAgentPrompt` — `# Agent Mode` constant
  string. No-loop reminder; tool-only-when-useful rule.
- `src/vex-agent/engine/prompts/mission-setup.ts:16 buildMissionSetupPrompt` — dynamic:
  injects `currentDraft` + `missingFields` from `MissionSetupContext`. Contains full
  required-fields list, stop-condition semantics, and "draft-only" research guardrail.
- `src/vex-agent/engine/prompts/mission-run.ts:17 buildMissionRunPrompt` — dynamic:
  injects `missionPromptContext` (frozen contract) + `iterationCount`. Contains stop-only-
  with-tool rule and 4-step workflow.
- `src/vex-agent/engine/prompts/subagent.ts:38 buildSubagentPrompt` — dynamic: injects
  task, `parentSummarySnapshot`, `allowTrades`, `childPermission`. References
  `subagent_report_complete` / `subagent_request_parent` tools (currently disabled).
  Carries `TODO(subagent-disabled)` comment at file top.
- `src/vex-agent/engine/prompts/mode.ts:20 buildPermissionPrompt` — four static string
  constants: AGENT_RESTRICTED, AGENT_FULL, MISSION_RESTRICTED, MISSION_FULL. Dispatched
  on `{ mode, permission }`. Renamed from `buildModePrompt(LoopMode)` at M12.
- `src/vex-agent/engine/prompts/wallet-state.ts:23 buildWalletStateBanner` — sync;
  resolves session addresses via `buildSessionWalletResolution + resolveSelectedAddressSet`;
  fail-soft on `WALLET_SCOPE_MISMATCH`; re-throws other errors. Never crashes the turn.
- `src/vex-agent/engine/prompts/context-pressure.ts:10 buildContextPressureBanner` —
  returns `""` for `normal` band; directive text for `warning` / `barrier` / `critical`.
  The `barrier` variant disables mutating tools via prompt (dispatcher enforces as backstop).
- `src/vex-agent/engine/prompts/resume-packet.ts:38 buildResumePacket` — **async** (DB);
  sourced from `sessions.summary`, latest `compact_jobs.preserve_md`,
  `session_memories.outstanding_items`, recent assistant + tool messages. All strings pass
  through `sanitizeForSystemPrompt`. Injected for first
  `POST_COMPACT_BRIDGE_CYCLES` turns after compact_committed.
- `src/vex-agent/engine/prompts/memory-state.ts:11 buildMemoryStateBanner` — pure sync;
  takes `SessionMemoryStats`; emits "skip memory_recall" for zero-chunk state, count+themes
  + tool hint otherwise.
- `src/vex-agent/engine/prompts/memory-routing.ts:18 buildMemoryRoutingRule` — static
  4-line decision hierarchy (live tools / memory_recall / knowledge_recall / document_read).
- `src/vex-agent/engine/prompts/knowledge.ts:31 formatActiveKnowledgeBlock` — pure sync;
  renders pinned + recent entries with char caps: `ACTIVE_KNOWLEDGE_HOT_CHARS_CAP` (3000),
  `ACTIVE_KNOWLEDGE_SUMMARY_TRUNCATE` (200), `ACTIVE_KNOWLEDGE_ENTRY_LIMIT` (12).
  Returns `""` when both inputs are empty (section omitted from prompt).
- `src/vex-agent/engine/prompts/knowledge-state.ts:16 buildKnowledgeStateBanner` — pure
  sync; count signal + top kinds + empty-state "use knowledge_write" guidance.
- `src/vex-agent/engine/prompts/tool-catalog.ts:29 buildToolCatalogPrompt` — sync; calls
  `getVisibleToolsByCategory(ctx)` using the same `ToolVisibilityContext` as `getOpenAITools`
  so tool array and Tool Map prompt cannot drift. Returns `""` if no tools visible.
- `src/vex-agent/engine/prompts/tool-usage.ts:15 buildToolUsagePrompt` — static constant
  string (7 sections: selection, live state, protocol execution, safety, memory layers,
  research, learning protocol). Rendered every turn.
- `src/vex-agent/engine/prompts/protocols.ts:65 buildProtocolsPrompt` — auto-generated
  from protocol manifests + `PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST`. Process-scoped
  cache (`cached`); reset by `resetProtocolsPromptCache()` in tests. Includes
  env-availability counts per namespace.
- `src/vex-agent/engine/prompts/sanitize.ts:39 sanitizeForSystemPrompt` — neutralizes
  triple-backtick fence escapes, pseudo role tags (`<system>` etc.), `[INST]`/`[/INST]`,
  `<|im_start|>`/`<|im_end|>` chat-template artifacts via zero-width separator insertion.
  Preserves all characters. Alias `sanitizePreserveMd` kept for regression test compat.

## Key types & invariants

- `WakeDeps` (`src/vex-agent/engine/wake/executor.ts:55`) — injectable interface for `tick`.
  Production built by `buildProductionDeps()`; test injection never touches real DB.
- `ClaimedWakeOutcome` (`executor.ts:37`) — discriminated union:
  `resumed | skipped_stale_status | skipped_claim_lost | skipped_mission_run_missing | error`.
- `WakeExecutorHandle` (`executor.ts:221`) — `{ stop(): Promise<void> }`. `stop()` drains
  in-flight tick before resolving; idempotent.
- `SubagentResult` (`runner.ts:30`) — `{ subagentId, sessionId, output, toolCallsMade, success, stopReason }`.
  `success=false` when `stopReason ∈ { timeout, iteration_limit, system_error }`.
- `SubagentContext` (`subagent.ts:16`) — prompt injection context: `task`, `allowTrades`,
  `childPermission` (immutable, set at spawn), `parentSummarySnapshot` (copy-by-value).
- `PermissionPromptArgs` (`mode.ts:15`) — `{ mode: SessionKind, permission: Permission }`.
- `MissionSetupContext` (`mission-setup.ts:11`) — `{ currentDraft, missingFields }`. Both
  optional; omitting yields the generic setup instructions without a draft state block.
- `MissionRunContext` (`mission-run.ts:10`) — `{ missionPromptContext: string, iterationCount: number }`.
- `PromptStackOptions` (`prompts/index.ts:28`) — nine optional pre-built strings/objects
  fed in from `executeTurn` / `runTurnLoop` async fetches. Keeps `buildPromptStack` sync
  and pure.
- **Invariant (subagent permission)**: `effectivePermission = allowTrades ? hydrated.context.sessionPermission : "restricted"`.
  Defense-in-depth: even if DB row has `permission='full'` on `allow_trades=false`, the
  runner demotes before any tool dispatch sees the context.
- **Invariant (wake claim)**: `claimDue` is destructive (`pending→consumed`). Rows consumed
  by a tick that cannot resume (provider not ready, race loss) are **permanently consumed**
  — they do NOT re-queue. The executor only claims when `isProviderReady()` returns true.
- **Invariant (prompt sanitizer)**: All LLM/DB-derived strings entering the system prompt
  pass through `sanitizeForSystemPrompt`. This covers `sessions.summary`,
  `compact_jobs.preserve_md`, `session_memories.outstanding_items[].text`, recent
  assistant decisions, tool outcomes. Raw strings from `context.*` fields (IDs, mode
  literals, wallet addresses) are safe by construction and not sanitized.
- **ADR-0001 compliance**: `runSubagentEngine` calls `resolveProvider()` globally. No
  per-session model field is read. `loadSubagentConfig` provides SUBAGENT_* env overrides
  for iteration/timeout budgets only — never for model or provider identity.

## Capabilities (stable IDs)

- **CAP-wake-claim-and-resume**: Poll `loop_wake_requests`, atomically claim due rows, inject
  wake banner, resume paused mission run — `executor.ts:86 tick` + `executor.ts:146 handleClaimed`
- **CAP-wake-provider-gate**: Pre-claim gate: no row consumed when `OPENROUTER_API_KEY`
  or `AGENT_MODEL` absent — `executor.ts:307 isWakeProviderConfigured`
- **CAP-wake-blob-ttl-refresh**: Bump tool-output blob TTLs on any resume path —
  `blob-refresh.ts:25 refreshBlobTtlForRecentMessages`
- **CAP-wake-handle-stop**: Drain in-flight tick before shutdown —
  `executor.ts:276 WakeExecutorHandle.stop`
- **CAP-subagent-run-engine**: Run a full child engine session (hydrate + turn-loop + relay) —
  `runner.ts:49 runSubagentEngine`
- **CAP-subagent-permission-demotion**: Force `restricted` when `allowTrades=false`,
  regardless of DB row permission — `runner.ts:93 effectivePermission`
- **CAP-subagent-wallet-inheritance**: Child inherits parent's wallet selection via
  `parentContext.selectedEvmWallet / selectedSolanaWallet` — `runner.ts:103 context`
- **CAP-subagent-relay-plain**: Plain-text to_parent / to_child message relay —
  `relay.ts:12 relayToParent`, `relay.ts:17 relayToChild`
- **CAP-subagent-relay-structured**: Structured `SubagentMessageType` relay with payload
  and replyTo threading — `relay.ts:24 sendStructuredToParent`, `relay.ts:35 sendStructuredToChild`
- **CAP-prompts-stack-build**: Compose full system prompt from layered builder —
  `prompts/index.ts:91 buildPromptStack`
- **CAP-prompts-base-identity**: Identity, dynamic aspect, memory contract, loaded docs —
  `base.ts:11 buildBasePrompt`
- **CAP-prompts-permission**: Four-variant permission policy (AGENT/MISSION × RESTRICTED/FULL) —
  `mode.ts:20 buildPermissionPrompt`
- **CAP-prompts-wallet-state**: Session wallet banner (mirrors tool resolver, fail-soft) —
  `wallet-state.ts:23 buildWalletStateBanner`
- **CAP-prompts-context-pressure**: Pressure band → directive text; empty for normal band —
  `context-pressure.ts:10 buildContextPressureBanner`
- **CAP-prompts-resume-packet**: Async post-compact bridge packet with sanitized rolling
  summary, preserve_md, outstanding items, recent decisions/tool outcomes —
  `resume-packet.ts:38 buildResumePacket`
- **CAP-prompts-memory-state**: Per-session memory chunk count signal + empty-state guidance —
  `memory-state.ts:11 buildMemoryStateBanner`
- **CAP-prompts-knowledge-state**: Cross-session knowledge count + top kinds signal —
  `knowledge-state.ts:16 buildKnowledgeStateBanner`
- **CAP-prompts-memory-routing**: Static 4-line substrate decision hierarchy —
  `memory-routing.ts:18 buildMemoryRoutingRule`
- **CAP-prompts-active-knowledge**: Render pinned + recent knowledge entries with char caps —
  `knowledge.ts:31 formatActiveKnowledgeBlock`
- **CAP-prompts-tool-catalog**: Sync visibility-aware Tool Map matching `getOpenAITools` filter —
  `tool-catalog.ts:29 buildToolCatalogPrompt`
- **CAP-prompts-tool-usage**: Static 7-section tool usage + DeFi safety policy —
  `tool-usage.ts:15 buildToolUsagePrompt`
- **CAP-prompts-protocols**: Auto-generated protocol namespace overview with env availability —
  `protocols.ts:65 buildProtocolsPrompt`
- **CAP-prompts-sanitize**: Neutralize prompt-injection via zero-width separator insertion —
  `sanitize.ts:39 sanitizeForSystemPrompt`
- **CAP-prompts-mission-setup**: Mission draft state + missing fields guidance —
  `mission-setup.ts:16 buildMissionSetupPrompt`
- **CAP-prompts-mission-run**: Frozen mission contract injection + stop discipline —
  `mission-run.ts:17 buildMissionRunPrompt`
- **CAP-prompts-subagent**: Subagent role, task, parent snapshot, trades restriction —
  `subagent.ts:38 buildSubagentPrompt`

## Public API (consumed by)

**Wake executor** (`CAP-wake-*`):

- `vex-app/src/main/agent/wake-worker.ts:51 defaultStartExecutor` → `startWakeExecutor()`
  (narrow dynamic import, not the engine barrel). Wrapped by `setupWakeWorker()` which adds
  a probe-loop supervisor (30 s poll) before starting.
- `vex-app/src/main/index.ts:143` → `setupWakeWorker()` started at boot, stop registered
  via `makeOrderedQuitCleanup` (sequenced before Postgres teardown).
- `src/vex-agent/engine/index.ts:44` — re-exports `startWakeExecutor` from the engine barrel
  (for external consumers; internal callers use the narrow import path).

**Blob refresh** (`CAP-wake-blob-ttl-refresh`):

- `src/vex-agent/engine/core/approval-runtime/post-tx.ts:117,344 refreshBlobTtlForRecentMessages`
  — called in approval post-tx paths (two call sites, before resume).
- `src/vex-agent/engine/core/runner/mission-run.ts:215 refreshBlobTtlForRecentMessages`
  — called inside `resumeMissionRun` before the turn loop restart.

**Subagent runner** (`CAP-subagent-run-engine`):

- `src/vex-agent/tools/internal/subagent/lifecycle.ts:66` → `runSubagentEngine(id, signal)`
  (dynamic import, called when subagent lifecycle handler fires — currently unreachable for
  new sessions because `subagent_spawn` is commented out in `dispatcher.ts:269`).
- `src/vex-agent/engine/index.ts:40` — re-exports `runSubagentEngine` from engine barrel.

**Prompt stack** (`CAP-prompts-stack-build`):

- `src/vex-agent/engine/core/turn.ts:14,118 executeTurn` — the sole production callsite.
  `buildPromptStack(context, { … })` is called with all async-prebuilt options passed in
  from `runTurnLoop` / `executeTurn`'s `Promise.all` pre-fetch phase.

## Internal flow

### Wake tick (CAP-wake-claim-and-resume)

```
tick(now, limit, deps)
  → deps.isProviderReady()              // pre-claim gate
  → deps.claimDue(now, limit)           // FOR UPDATE SKIP LOCKED, pending→consumed
  for each claimed wake:
    → handleClaimed(wake, deps)
        → deps.getMissionRun(wake.missionRunId)
        → check run.status === "paused_wake"
        → claimRunLeaseAndFlipToRunning(sessionId, runId, ["paused_wake"], ownerId)
        → createLeaseHandle(lease, ownerId)
        → deps.injectWakeBanner(sessionId, wake.reason, wake.dueAt)
            → appendEngineMessage(sessionId, "[Engine: wake_due …]", {messageType:"wake_due"})
        → deps.resumeMissionRun(run.id)
            → dynamic import("@vex-agent/engine/index.js").resumeMissionRun(runId)
              (includes refreshBlobTtlForRecentMessages internally)
        finally: releaseLeaseAndEmitControlState(handle, sessionId)
```

Race safety: `claimDue` uses `FOR UPDATE SKIP LOCKED`; `claimRunLeaseAndFlipToRunning`
is a single atomic tx (lease acquire + status CAS + wake-row cleanup). A user preempt
that moved the run from `paused_wake` before the tick reaches `handleClaimed` causes
`skipped_claim_lost` — the wake row is already consumed (terminal), no re-queue.

### Subagent turn loop (CAP-subagent-run-engine)

```
runSubagentEngine(subagentId, signal?)
  → resolveProvider() + provider.loadConfig()   // global model (ADR-0001)
  → subagentsRepo.getById(subagentId)
  → sessionLinksRepo.getSubagentSession(subagentId)  // canonical session graph
  → hydrateEngineSession(parentSessionId)        // parent wallet + walletPolicy snapshot
  → hydrateEngineSession(sessionId)              // child session, permission from DB row
  → effectivePermission = allowTrades ? hydrated.permission : "restricted"  // defense-in-depth
  → build EngineContext { ...child, isSubagent:true, wallet from parent, walletPolicy from parent }
  → buildSubagentToolsForBand(band) closure  // per-band tool projection, same filter as runTurnLoop
  → runTurnLoop(context, messages, summary, tokenCount, provider, config, tools, loopConfig, promptOptions, signal)
  → conditionally relayToParent(subagentId, output)  // skip if waiting_for_parent or hasStructuredReport
  → return SubagentResult
```

### Prompt stack assembly (CAP-prompts-stack-build)

`buildPromptStack(context, options)` is synchronous. All async data (memory stats,
knowledge entries, resume packet, context pressure, tool catalog) is pre-fetched upstream
in `executeTurn` via `Promise.all` and passed as `PromptStackOptions`.

Layer order (index.ts):
1. `buildBasePrompt(context)` — identity + aspect + memory contract + context IDs
2. `buildRuntimeClockPrompt(runtimeClock)` — session/run/deadline timestamps
3. `contextPressureBanner` (if non-empty) — band-dependent warning/directive
4. `resumePacket` (if non-empty) — post-compact DB snapshot (sanitized)
5. `memoryStateBanner` (if non-empty) — chunk count / empty-state
6. `knowledgeStateBanner` (if non-empty) — cross-session knowledge count
7. `activeKnowledgeBlock` (if non-empty) — hot context entries
8. `memoryRoutingPrompt` (if non-empty) — 4-line substrate routing rule
9. `toolCatalogPrompt` (if non-empty) — visibility-aware Tool Map
10. `buildToolUsagePrompt()` — constant 7-section DeFi safety policy
11. `buildProtocolsPrompt()` — auto-generated namespace overview (cached)
12. `buildPermissionPrompt({ mode, permission })` — four-variant policy
13. `buildWalletStateBanner(context)` — session wallet addresses (sync resolve)
14. Contextual layer:
    - `buildAgentPrompt()` if `sessionKind="agent"` and no run
    - `buildMissionSetupPrompt(ctx, setupCtx)` if `sessionKind="mission"` and no run
    - `buildMissionRunPrompt(ctx, runCtx)` if `missionRunId` is set
15. `buildSubagentPrompt(ctx, subagentCtx)` if `context.isSubagent`

## Dependencies

**Imports FROM** (this module calls):

- Z1: `engine/runtime/lease-and-status.js`, `engine/runtime/lease-handle.js`,
  `engine/runtime/release-and-emit.js`, `engine/events/index.js` (wake);
  `engine/core/hydrate.js`, `engine/core/turn-loop.js`, `engine/core/context-band.js` (subagent)
- Z3: `inference/registry.js`, `inference/config.js` (subagent); `tools/registry.js` (prompts/tool-catalog);
  `tools/protocols/catalog.js`, `tools/protocols/descriptions.js` (prompts/protocols);
  `tools/internal/wallet/resolve.js` (prompts/wallet-state)
- Z4: `db/repos/loop-wake.js`, `db/repos/mission-runs.js`, `db/repos/messages.js`,
  `db/repos/tool-output-blobs.js` (wake); `db/repos/subagents.js`, `db/repos/session-links.js`,
  `db/repos/subagent-messages.js` (subagent); `db/repos/compact-jobs/index.js`,
  `db/repos/knowledge.js`, `db/repos/session-memories/index.js`,
  `db/client.js` (prompts/resume-packet); `knowledge/policy.js`, `memory/policy.js` (prompts)
- Z5: `lib/diagnostics/bug-report-sink.js`, `engine/support/bug-report-registry.js` (wake);
  `errors.js` (prompts/wallet-state); `utils/logger.js`

**Consumed BY**:

- `vex-app/src/main/index.ts:143` (wake via `setupWakeWorker`)
- `vex-app/src/main/agent/wake-worker.ts:51` (wake executor start)
- `src/vex-agent/engine/core/runner/mission-run.ts:215` (blob refresh)
- `src/vex-agent/engine/core/approval-runtime/post-tx.ts:117,344` (blob refresh)
- `src/vex-agent/tools/internal/subagent/lifecycle.ts:66` (subagent runner — disabled path)
- `src/vex-agent/engine/core/turn.ts:118` (prompt stack — sole production callsite)
- `src/vex-agent/engine/index.ts:40,44` (barrel re-exports: `runSubagentEngine`, `startWakeExecutor`)

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-wake-claim-and-resume`
- quality findings: `audits/current/quality-findings.md` (F2 — wake executor now wired;
  see Open questions for residual subagent-disabled state)
- related decisions: `decisions/ADR-0001-global-model-session-wallet.md` (global provider
  used in `runSubagentEngine`; no per-session model in subagent config)

## Refresh triggers

Paths/commits that invalidate this doc:

- Any change to `src/vex-agent/engine/wake/**`
- Any change to `src/vex-agent/engine/subagents/**`
- Any change to `src/vex-agent/engine/prompts/**`
- `src/vex-agent/engine/core/turn.ts` (prompt stack call site)
- `vex-app/src/main/agent/wake-worker.ts` (supervisor wiring)
- `vex-app/src/main/index.ts` (boot sequence for workers)
- `src/vex-agent/tools/dispatcher.ts` (subagent_spawn gate)
- `src/vex-agent/tools/internal/subagent/lifecycle.ts` (runSubagentEngine call site)
- ADR-0001 revision (per-session model would affect `runSubagentEngine`)

## Open questions

1. **Subagent disabled state (intentional MVP scope)**: `subagent_spawn` is commented out
   in `src/vex-agent/tools/dispatcher.ts:269`. The subagent runner (`runSubagentEngine`),
   relay, and all prompt layers (`buildSubagentPrompt`, `resolveAspect` subagent branch) are
   fully implemented and preserved intentionally for future re-enable. No new sessions can
   become subagents. The `subagent_spawn` test cases in dispatcher and registry tests are
   marked `it.skip`. `TODO(subagent-disabled)` comments in `base.ts:65` and `subagent.ts:9`
   describe the residual risk: legacy DB sessions with `is_subagent=true` hydrated by
   `hydrate.ts` will receive the subagent prompt including references to
   `subagent_report_complete` and `subagent_request_parent` tools that are also gated off —
   those sessions would receive a hang signal (no callable tool to terminate the subagent).
   Tracked as a known residual risk; not a quality finding.

2. **Wake supervisor interval vs executor interval**: The `setupWakeWorker` supervisor polls
   every 30 s (`SUPERVISOR_INTERVAL_MS`) before the executor is ready; the executor itself
   ticks every 2 s once started. The 30 s gap means a mission that defers within the first
   30 s after boot (before Postgres is ready) will wait up to 30 s before the executor
   starts — acceptable given the DB bootstrap requirement.

3. **Blob refresh scan window**: `RECENT_WINDOW = 50` messages is hardcoded. For very
   large context windows or sessions approaching the 500-node transcript cap, this may miss
   older overflow blobs. Non-fatal (expire error reported cleanly), but worth tracking if
   blob expiry errors surface in practice.

4. **Protocols prompt cache and env gate**: `buildProtocolsPrompt` caches the protocols
   section once per process. `isProtocolToolAvailable` reads env at cache-build time, so
   tool availability counts in the prompt become stale if env changes (e.g. vault unlock
   adds a new protocol key after first turn). `resetProtocolsPromptCache()` is only exposed
   for tests; no production invalidation path. Impact: tool counts in the prompt can drift
   from the dispatcher's live env check. The dispatcher still enforces env gates at
   execution time so no behavioral regression, only a stale informational count.
