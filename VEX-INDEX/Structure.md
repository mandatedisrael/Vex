# VEX-INDEX — Structure.md (Stage 1: Repository Index)

> Durable structural index of the Vex monorepo, produced by 8 parallel Explore indexers
> (2026-05-27). Navigation reference for all later verification stages. Ground truth and the
> live bug are in `00-PROGRESS.md`. File:line anchors are clickable.

Zone map: **Z1** engine core/runtime · **Z2** engine mission/wake/compaction · **Z3** inference+tools ·
**Z4** db+memory/knowledge · **Z5** root src lib/tools · **Z6** vex-app main · **Z7** preload+shared ·
**Z8** renderer.

---

## 0. Monorepo & build/resolution model

Two `package.json` projects: `/Vex/` (root MCP/CLI lib) and `/Vex/vex-app/` (Electron app).

- **`@vex-lib` alias** → `/Vex/src/lib` (vex-app vite + tsconfig). vex-app main/renderer/shared import root
  lib through this. At build, Rolldown bundles those root sources into the vex-app main bundle; Node
  resolves their deps from `/Vex/node_modules` → **CI must `pnpm install` at BOTH roots** (see edge-cases #4).
- **`@vex-agent/*`** → engine/runtime modules. vex-app main reaches the engine **via dynamic `await import("@vex-agent/...")`** (lazy; engine runs in-process in Electron main, no worker/utility process).
- **Root tsconfig aliases** `@tools/*`, `@utils/*`, `@config/*`, `@lib/*` used inside `src/vex-agent` and `src/`.
- **Two DB-access models against the SAME local Postgres**:
  - Engine (Z1–Z4) uses `@vex-agent/db/client.ts` pool + typed repos.
  - vex-app main (Z6) uses its OWN `vex-app/src/main/database/*` raw `pg.Client` layer. **SQL is the contract boundary; Z6 does NOT import engine repos** (except a few: `wallet-intents`, `runtime-control-requests`, `loop-wake`, `compact-jobs`).
  - Migrations live in `src/vex-agent/db/migrations/`, **copy-synced** to `vex-app/resources/migrations/` at build; both use shared `src/lib/db/migrate-runner.ts` (advisory-locked).
- **Config dir resolver intentionally duplicated**: `src/config/paths.ts` (engine) ↔ `vex-app/src/main/paths/config-dir.ts` (Electron, adds `.electron-state` paths). Shared path constants bridge via `@vex-lib/wallet.js` re-exports only.
- Top-level: root `src/errors.ts` (VexError + ErrorCodes); vex-app config files (`electron-builder.yml`, `vite.{main,preload,renderer}.config.ts`, `tsconfig.*.json`, `playwright.config.ts`).

### Config/secret layout (`${CONFIG_DIR}` = `%APPDATA%/vex` | `~/Library/Application Support/vex` | `~/.config/vex`)
- `.env` — non-secret runtime: `AGENT_MODEL`, `AGENT_PROVIDER=openrouter`, `AGENT_CONTEXT_LIMIT`, `AGENT_MAX_OUTPUT_TOKENS`, `AGENT_TEMPERATURE`, `SUBAGENT_*`, `EMBEDDING_*`.
- `secrets.vault.json` — AES-256-GCM + scrypt(N=65536); holds `OPENROUTER_API_KEY`, `JUPITER_API_KEY`, `TAVILY_API_KEY`, `RETTIWT_API_KEY`, Polymarket creds. Injected to `process.env` only after unlock.
- `config.json` — public wallet addresses, chain/RPC/service URLs. `keystore.json` / `solana-keystore.json` — wallet keystores (AES-256-GCM + scrypt **N=16384** — weaker than vault, flagged). `.setup-complete`, `.install-id`, `.electron-state/{preferences,wizard-state}.json`, `compose/docker-compose.yml`.

---

## Z1 — vex-agent engine core/runtime (`src/vex-agent/engine/{core,events,runtime,checkpoint,support}`)

Owns run lifecycle: claim lease → hydrate → build tools → `runTurnLoop` → finalize → release lease. Provider/model resolved ONCE per entry point (no per-session model). Three event buses. All transcript writes funnel through `appendMessage`.

**Entry / key files**
- `engine/index.ts:1` — public barrel (all exports below).
- `engine/ingress.ts:43` — `routeUserMessage` (== `submitOperatorInstruction`, alias): single entry for user messages; routes by run status (`paused_wake`→preempt+resume; `running`/`paused_approval`→persist interrupt; else `processAgentTurn`/`processMissionSetupTurn`).
- `engine/types.ts:59` — `MISSION_RUN_STATUSES` = running, paused_approval, paused_wake, paused_error, **paused_user**, completed, failed, stopped, cancelled (canonical; CI drift test). `:239` `EngineContext` (no model fields).
- `engine/core/turn.ts:66` `executeTurn` (builds prompt, `runStreamingInference`, logs usage, updates token_count); `:258` `saveAssistantMessage`.
- `engine/core/turn-loop.ts:77` `runTurnLoop` (+ ~12 `turn-loop-*.ts` helpers: tool-batch, text-response, waiting-for-wake, critical-fallback, post-compact, observe, control-emit).
- `engine/core/runner/agent.ts:29` `processAgentTurn` (maxIter=10); `:36` `resolveProvider()` `:39` `loadConfig()`.
- `engine/core/runner/mission*.ts` — `prepareMissionStart` (8-step atomic, provider resolved step 3), `runPreparedMissionStart`/`resumePreparedMissionRun` (maxIter=50), finalize, recover, abort, retry.
- `engine/core/runner/runtime-continuation.ts:39` `scheduleRuntimeContinuation` (iteration_limit/timeout → 5s loop-wake + `runtime_yield` msg).
- `engine/core/rewind.ts:81` `rewindSession` (/rewind N: soft-archive suffix + `rewind_checkpoint`).
- `engine/core/approval-runtime.ts` (+ `approval-runtime/` snapshot, post-tx, continuation, sweep) — `prepareApprove`/`prepareReject`/`runResumeAfterDecision`/`sweepExpiredApprovals` (puzzle-5, landed 2026-05-23).
- `engine/events/{transcript-bus,stream-bus,control-bus≈runtime/control-bus}.ts` — `transcriptEventBus` (post-COMMIT append), `streamDeltaBus` (ephemeral token stream), `controlStateBus`. `events/append-transcript.ts:85` `appendMessage`.
- `engine/runtime/lease-and-status/*` — `claimRunLeaseAndFlipToRunning`, `claimSessionLease`, `observeAndApplyControl` (atomic CAS). `release-and-emit.ts:41` (every runner `finally`).
- `engine/checkpoint/prefix.ts:54` `selectPrefixWithGiantFallback`.
- `engine/support/bug-report-registry.ts` — injectable `BugReportSink` (mounted by vex-app).

**Cross-zone**: imports Z3 (`resolveProvider`,`runStreamingInference`,`getOpenAITools`), Z4 (repos, client), Z2 (mission commit, prompts, wake/blob-refresh), Z5 (bug-report-sink). Consumed by Z6 (IPC dispatch + bus subscriptions) and Z2 (wake/compact executors call `resumeMissionRun`/turn loop).

---

## Z2 — engine mission/wake/subagents/prompts/compaction (`src/vex-agent/engine/{mission,wake,subagents,prompts,compact-jobs}`)

**Mission lifecycle** (`mission/`): `setup.ts` createDraft/applyPatch; `patch-parser.ts:11` drops model-set `stopConditionsAccepted` (host-only); `acceptance.ts:166` `acceptContract` (host-only, recomputes SHA-256 `contract-hash.ts`); `commit-start.ts:98` `commitMissionStart` (atomic gate→flip→createRun); `restore.ts:155` `restoreLatestCheckpoint` (/restore, LIFO); `renew.ts:85` `renewMission` (/mission-renew, fresh draft, NOT idempotent); `diff.ts` getContractStatus; `stop-contract.ts:53` reads only `acceptedContractHash`. Mission statuses (`types.ts:39`): draft, ready, running, completed, failed, cancelled.

**Wake/defer/sleep** (`wake/`): `tools/internal/loop-defer.ts:62` `handleLoopDefer` (mission-run only; enqueues `loop_wake_requests` via `loopWakeRepo`; returns `defer_until` signal → turn-loop sets `paused_wake`). `wake/executor.ts:83` `startWakeExecutor` (poll 2s, `claimDue` FOR UPDATE SKIP LOCKED → `claimRunLeaseAndFlipToRunning` → injectWakeBanner → `resumeMissionRun`). `wake/blob-refresh.ts` TTL refresh.

**Compaction** (`compact-jobs/`): **Track 1** `service.ts:64` `executeCompactNow` (sync, atomic single tx: summary + archive prefix + `enqueueJob` Track 2; returns immediately — "Track 2 NEVER blocks compact"). **Track 2** `executor.ts:64` `startCompactJobsExecutor` (poll 5s → `callChunkerLLM` OpenRouter → `processChunkerOutput` → `embedDocument` → `insertPreparedMemory`). `forced-fallback.ts` deterministic compact at critical band (no LLM). `state.ts` per-session mutex.

**Prompts** (`prompts/index.ts:91` `buildPromptStack`): layered base/clock/context-pressure/resume-packet/memory/knowledge/tool-catalog/tool-usage/protocols/permission/wallet banners; contextual agent vs mission-setup vs mission-run vs subagent. `mode.ts` `buildPermissionPrompt` (AGENT/MISSION × RESTRICTED/FULL).

**Subagents** (`subagents/runner.ts`,`relay.ts`): fully implemented BUT **disabled** (`subagent_spawn` commented out in dispatcher; prompts still reference disabled tools — `TODO(subagent-disabled)`).

**Cross-zone**: imports Z1 (hydrate, turn-loop, lease, checkpoint), Z3 (inference, loop-defer), Z4 (repos, memory/embeddings). Consumed by Z6 (`setupCompactWorker` starts Track 2 — but NOT wake), Z1, Z7 (mission IPC).

---

## Z3 — vex-agent inference + tools (`src/vex-agent/{inference,tools}`)

**Inference** — provider is GLOBAL, OpenRouter only.
- `inference/config.ts:58` reads `process.env.AGENT_PROVIDER`; `:69` `OPENROUTER_API_KEY`+`AGENT_MODEL`; `:75` `parseAgentEnv` (context/output/temp).
- `inference/registry.ts:41` `doResolve()` → null + log `inference.registry.none_configured` if no key/provider in env; `:100` `resolveProvider()` (singleton, generation-invalidated; **null is NOT cached**); `:134` `resetProvider()` (**only called by `switchProvider` — never on vault unlock**).
- `inference/openrouter.ts:66` constructor throws if key/model missing; `:98` `loadConfig()` calls OpenRouter **models API on every turn** → returns null (`model_not_found` / `api_unreachable`) if model absent or network fails. `chatCompletionStream()` (signal-cancelable) for streaming.
- `inference/stream-consumer.ts:137` `runStreamingInference` (buffered fallback only before first chunk; abort → partial; mid-stream error rethrows).

**Tools** — `tools/registry.ts` (TOOLS concat, `getOpenAITools(ctx)` visibility/pressure filtering, `isMutatingTool`, `getActionKind`); `tools/dispatcher.ts:85` `dispatchTool`→`routeToolCall` (`discover_tools`, `execute_tool`→`executeProtocolTool`, internal via `INTERNAL_TOOL_LOADERS` lazy map; **approval gate**: mutating+restricted+!approved → `pendingApproval:true`). `taxonomy.ts` ActionKind = read|local_write|schedule|approval_prepare|user_wallet_broadcast|external_post|destructive.
- Wallet tools (`internal/wallet/`): `wallet_send_prepare` (mutating:false, actionKind approval_prepare — DB intent, no signing) / `wallet_send_confirm` (mutating:true, user_wallet_broadcast — CAS consume, approval gate, resolves session-scoped signing wallet, EVM/Solana execute; raw errors fingerprinted, never surfaced).
- Protocols (`protocols/`): khalani, kyberswap, solana-jupiter, polymarket (mutating), dexscreener (read-only). `runtime.ts:53` `executeProtocolTool` (manifest→lifecycle/env/pressure/param/approval gates→handler→capture; **always overwrites `result.actionKind`** with manifest's effective kind).

**Cross-zone**: consumed by Z1/Z2 (provider+tools); imports Z4 (wallet-intents, loop-wake, executions repos), Z5 (`@tools/wallet`, `agent-config`, `secret-keys`, protocol clients). Env injected by Z6 `secrets/session.ts:applyUnlockedRuntime`.

---

## Z4 — vex-agent data + memory/knowledge/sync/embeddings (`src/vex-agent/{db,memory,knowledge,sync,embeddings,scripts}`)

**Schema** (27 migrations, gaps 007/008/012 intentional). `sessions` columns: id, scope, started/ended_at, summary, compacted, message_count, token_count, checkpoint_generation, **mode** (agent|mission), **permission** (restricted|full), initial_goal, title(≤120), pinned_at, deleted_at, **selected_evm_wallet_id/address, selected_solana_wallet_id/address (mig 026, per-session wallet, immutable)**. **NO `model_id` column — global model confirmed.**
- Other tables: messages(+archive, +rewind_checkpoint_id), usage_log(model per-row), mission_runs(status, contract_snapshot_json, recovered_from_run_id), approval_queue, approval_intents(mig024: action_kind, risk_level, preview/policy_json, decision, execution_status), wallet_intents(mig025), knowledge_entries(pgvector, source, supersedes), session_memories(mig016: themes, body_md, outstanding_items, pgvector), compact_jobs(mig017: outbox), loop_wake_requests(mig011: one-pending-per-session partial unique), rewind_checkpoints(mig023), runtime_control_requests + runner_leases(mig022), tool_output_blobs(mig013), proj_* (balances/positions/pnl/lp), bug_reports, soul, documents/folders.

**Repos** (`db/repos/`): `messages.ts` (`addMessageReturningId` returns id+ts; `getLiveMessagesWithId`; `getAllMessages`); `usage.ts` `getStats` (session + lifetime totals; **NO getLastTurn — that lives in vex-app `usage-db.ts`**); `mission-runs.ts` (`casFlipToRunning`, `getActiveRunBySession`); `approvals.ts`/`approval-intents.ts` (CAS); `compact-jobs/` (`claimNextDueJob` SKIP LOCKED, heartbeat, recoverStale); `session-memories/` (prepareRender→embed→insert invariant); `knowledge/` (recallTopK, hot-context, supersede); `loop-wake.ts` (`enqueue` ON CONFLICT, `claimDue`); `wallet-intents.ts`; `runtime-control-requests.ts`; `runner-leases.ts`.

**Embeddings**: `ai/embeddinggemma` via Docker Model Runner `:12434`; dim config-driven (`EMBEDDING_DIM`); vector cols have NO typmod (per-row dim is authoritative; recall filters on model+dim). **Sync** (`sync/projectors/{spot,lp}.ts`): FIFO PnL lots + LP positions from `proj_activity`.

**Cross-zone**: consumed directly by Z1/Z2/Z3 (engine pool). Z6 reads same Postgres via own raw-pg layer. Z7 schemas mirror (not import) these DTOs.

---

## Z5 — root src lib/tools/providers/config (`src/{tools,lib,providers,config,constants,utils}`)

Root MCP/CLI lib; subset bridged into vex-app via `@vex-lib`.
- `config/paths.ts` (CONFIG_DIR resolver, VEX_CONFIG_DIR override), `config/store.ts` (config.json, `isValidWalletId` path-traversal guard, wallet inventory).
- `lib/wallet.ts` (`@vex-lib/wallet.js` facade: create/import/keystore/inventory + `privateKeyToAddress`), `lib/local-secret-vault.ts` (vault AES-256-GCM scrypt N=65536, `applySecretVaultToProcessEnv`), `lib/secret-keys.ts` (`VAULT_SECRET_KEYS`, `MASTER_PASSWORD_ENV_KEY="VEX_KEYSTORE_PASSWORD"`), `lib/agent-config.ts` (AGENT_*/SUBAGENT_* field metadata, shared with onboarding + renderer), `lib/dotenv.ts`→`utils/dotenv.ts` (atomic .env read/write), `lib/db/migrate-runner.ts` (shared), `lib/diagnostics/{text-redaction,redactor,bug-report-sink,bug-report-schema}.ts`, `lib/openrouter-client.ts`, `lib/embedding*.ts`.
- `providers/env-resolution.ts` (loadProviderDotenv, readEnvValue routes managed secrets→process.env, others→file).
- `tools/wallet/` (keystore N=16384, inventory multi-wallet max 3/family, multi-auth `WalletResolution`, signing clients, polymarket-credentials EIP-712). `tools/{dexscreener,khalani,kyberswap,polymarket,solana-ecosystem,twitter-account}/` protocol clients.
- `utils/{logger(winston, not cross-boundary), logger-shim, http(fetchWithTimeout), package-assets, validation-helpers, env}.ts`.

**Cross-zone**: consumed by Z3 (`@tools/*`), Z4 (migrate-runner), Z6 (`@vex-lib/*`), Z7 (schemas import `@vex-lib/agent-config`), Z8 (renderer imports pure `@vex-lib/{agent-config,embedding-constants}` only).

---

## Z6 — vex-app main process (`vex-app/src/main`)

Privileged process: secrets, wallet, DB, Docker, onboarding, IPC, engine bridge.

**Bootstrap `index.ts`**: L49 userData→`.electron-state`; L84 single-instance; L90 protocol privileges; L107 whenReady → L110 deny-all permissions → L119 `registerAllIpcHandlers()` → **L126 `setupCompactWorker()` (Track 2 only)** → L133 cleanup → L153 `createMainWindow()`. **NO wake worker started anywhere. NO automatic vault unlock at boot.**

**Engine bridge** (`agent/`): `setupAgentBridges()` subscribes the 3 engine buses → `broadcastToAllWindows` on `vex:event:engine:{transcriptAppend,controlState,streamDelta}`. All engine calls via dynamic `import("@vex-agent/...")`. `ipc/runtime/_ensure-engine-db-url.ts` sets `process.env.VEX_DB_URL` + `closePool()` before each dispatch; `database/connection-state.ts` holds DB conn (null until `vex:docker:composeUp`).

**IPC handlers** (`ipc/register-all.ts`) — full channel list mirrors Z7. Engine-calling handlers: `chat.ts` (`submitOperatorInstruction`), `mission/{start,continue,recover,rewind,restore,renew,stop}`, `approvals.ts` (`prepareApprove`/`prepareReject`+`runResumeAfterDecision`), `runtime/{requestResume,cancelWake}`, `compaction.retry`. Read handlers hit DB directly.

**Secrets** (`secrets/session.ts`): `unlockSecretSession`→`applyUnlockedRuntime`→`applySecretVaultToProcessEnv` (injects `OPENROUTER_API_KEY` to env, deletes master pw from env, strips managed secrets from .env). Triggered by `vex:secrets:unlock`, `keystoreSet`, and `provider-writer` `writeUnlockedSecrets`.

**Onboarding** (`onboarding/provider-writer.ts:48`): vault-writes `OPENROUTER_API_KEY`; `.env`-writes `AGENT_MODEL` + `AGENT_PROVIDER=openrouter` (plaintext). `finalize.ts:199` writes `.setup-complete`.

**Model-configured computation (BUG)**: `ipc/sessions/get-model.ts:25` + `ipc/models.ts:29` read ONLY `process.env.AGENT_PROVIDER`/`AGENT_MODEL` → `source:"unconfigured"` if absent. `ipc/chat.ts:43,75` `classifyEngineError` → `provider.unavailable` "No inference provider is available. Unlock Vex or complete provider setup, then retry."

**Per-session wallet**: `sessions-db.ts:initializeSessionWalletScope` (CAS init); `wallets-session.ts` (list/setScope/intents). `wallet-export.ts` sudo-export to clipboard (never to renderer payload).

---

## Z7 — vex-app preload + shared (`vex-app/src/{preload,shared}`) — IPC contracts (trust boundary)

`window.vex` = `VexBridge` (VexShellBridge 10 domains + VexAgentBridge 13 domains), composed with `satisfies`; single `contextBridge.exposeInMainWorld`; no raw ipcRenderer.

- `shared/ipc/channels.ts` — `CH` (request, `vex:<domain>:<action>`) + `EV` (events). Domains present: capabilities, system, docker, database, secrets, wallet, onboarding(24 actions), sessions(+getModel), chat, messages, runtime, mission(12), approvals, wallets, models, usage, compaction, knowledge, memory, settings, telemetry, support, cancel.
- `shared/ipc/result.ts` — `VexDomain` (29, exhaustive), `VexErrorCode` (52, exhaustive), `VexError` (code/domain/message/retryable/userActionable/redacted/correlationId).
- `shared/schemas/*` (Zod, +18 tests): `sessions.ts:36` name `min(1)`; `sessions.ts:229` `sessionModelDtoSchema` (source `global_default|unconfigured`, updatedAt always null — **global model, read-only**); `models.ts` no session param, source has no "per-session"; `chat.ts` submit; `messages.ts` transcriptAppendEvent; `stream.ts` streamDeltaEvent (tool_call omits arg fragments); `runtime.ts` state + control results; `approvals.ts`; `wallets.ts` (export requires `riskAcknowledged:true`).
- `preload/_dispatch.ts` — `invokeWithSchema` (validates INPUT; output is cast, validated main-side only), `abortableInvoke` (chat.submit, docker.composeUp), `subscribe` (validates each event via Zod).

**Drift/gaps flagged**: (a) `RuntimeBridge` control-mutation return types still use legacy `RuntimeRequestResult`, not the per-action puzzle-03 schemas. (b) `EV.engine.controlState` schema + main publish exist but **no preload subscription / bridge method** → renderer can't observe control transitions live. (c) `EV.{system.logLine,system.resume,docker.daemonChanged,updater.available}` unbridged. (d) `CH.onboarding.{providerListModels,providerTest}` channels exist but no bridge method/preload impl.

---

## Z8 — vex-app renderer (`vex-app/src/renderer`) — untrusted UI

View state machine (`uiStore.ts`): splash→systemCheck→dockerBootstrap→composeBootstrap→migrations→wizard→unlock→**appShell** (sub-views session|sessionsLibrary|knowledge).

- **AppShell / sessions**: `SessionsList.tsx` tabs All/Agent/Mission (`sessionModeFilter`), groups Pinned/Today/Yesterday/Older; select sets `activeSessionId`.
- **Composer** `SessionComposer.tsx`: `useSubmitChat`→`window.vex.chat.submit` (abortable, stop button); slash parsing; free-text gate vs runtime state; welcome→`openCreateSession`; placeholder lists only 4 of 9 slash commands.
- **Transcript** `SessionTranscript.tsx`: `useTranscriptInfinite` (`messages.list`, **MAX 10 pages = 500 nodes, no virtualization yet**); `useTranscriptLiveSync` (onTranscriptAppend + 30s poll); `useStreamPreview`→`StreamingBubble`. `TranscriptMessage` variants: user/assistant/assistant_stopped/tool/notice/compaction/recall. Assistant via safe `MarkdownContent`.
- **Runtime bar** `SessionRuntimeBar.tsx`: `ModelIndicator` (`useSessionModel`→`sessions.getModel`; **"Model not configured" chip at :109/:112 when source unconfigured/modelId null**); `ContextMeter` (`usage.getContextWindow`→`tokensUsed/contextLimit` → `ctx N%` bar); `UsageChip` (last-turn tokens + cost); `CompactionChip`.
- **Slash** (`appShell/slash/catalog.ts`): mission-start/continue/recover/stop/edit, retry, rewind(confirm), restore(confirm), mission-renew(confirm) → `useSlashCommandDispatch`→ `window.vex.mission.*`.
- **Wizard** (`features/wizard/steps`): keystore→wallets→apiKeys→embedding→agentCore→provider→review. Secrets via uncontrolled refs cleared after submit. Provider step verifies OpenRouter then vault-stores key.
- **Stores**: `uiStore` (routing/filter/activeSession/modals; only `sidebarOpen` persisted), `streamStore` (ephemeral per-session preview).
- **lib/api**: ~25 TanStack wrappers over `window.vex.*`. `errors/error-copy.ts` maps codes (note: chat path shows raw `error.message`, not mapped copy).

**Stub flagged**: approval hooks `usePendingApprovals/useApprove/useReject` exist in `lib/api/approvals.ts` but **no approval card component is wired anywhere** → restricted-mode `paused_approval` soft-locks the user (composer blocks free text, no card to approve).

---

## INTEGRATION WIRING MAP (end-to-end flows, file:line)

**Chat submit (agent turn)**: `SessionComposer`→`chat.ts:34 window.vex.chat.submit` → preload `agent/chat.ts` (abortable) → Z6 `ipc/chat.ts` (ensureEngineDbUrl) → dynamic import `@vex-agent/engine/index.js` `submitOperatorInstruction` → Z1 `ingress.routeUserMessage`→`processAgentTurn` → Z3 `resolveProvider`+`loadConfig` → `runTurnLoop`→`executeTurn`→`runStreamingInference` → stream deltas on `streamDeltaBus` → Z6 `stream-bridge` → `vex:event:engine:streamDelta` → Z8 `streams.ts`→`streamStore`→`StreamingBubble`. Final msg → `saveAssistantMessage`→`appendMessage`→`transcriptEventBus`→Z6 `transcript-bridge`→`vex:event:engine:transcriptAppend`→Z8 transcript invalidate.

**Mission start**: Z8 slash `/mission start`→`mission.ts start.mutateAsync`→`window.vex.mission.start`→Z6 `ipc/mission/start.ts`→`prepareMissionStart`(atomic)+fire-and-forget `runPreparedMissionStart`(maxIter=50). Defer: agent calls `loop_defer`→`loop_wake_requests` row + `defer_until`→run `paused_wake`. **Wake: `startWakeExecutor` would resume — BUT NOT STARTED in Z6 ⇒ broken.**

**Restricted approval**: mutating tool + restricted + !approved → Z1 dispatcher returns `pendingApproval` → run `paused_approval` + `approval_queue`/`approval_intents` rows. User approves: Z8 `useApprove`→`window.vex.approvals.approve`→Z6 `ipc/approvals.ts`→`prepareApprove`+`runResumeAfterDecision` (resumes run = the "signal back to agent"). **Backend complete; Z8 approval CARD missing ⇒ user can't approve from UI.**

**Compaction**: context pressure → Z1 turn-loop → Z2 `executeCompactNow` (Track1 sync: summary+archive+enqueue) → Z2 `startCompactJobsExecutor` (Track2 async, started Z6 L126: chunker LLM→embed→`session_memories`). Parallel/non-blocking ✓ (but Track2 idle until OPENROUTER_API_KEY in env).

**Model/provider (BUG path)**: onboarding `provider-writer` → `.env`(AGENT_MODEL/PROVIDER) + vault(OPENROUTER_API_KEY). UI reads `sessions.getModel`/`models.listAvailable` = `process.env` only. Engine reads `process.env` via `inference/config.ts`. **Open: is `${CONFIG_DIR}/.env` loaded into `process.env` at boot? No `dotenv.config()` found in Z6 `index.ts`.** If not loaded, cold start (pre-unlock) ⇒ AGENT_MODEL absent ⇒ "Model not configured"; OPENROUTER_API_KEY absent ⇒ "No inference provider available".

---

## PRELIMINARY CROSS-CUTTING FINDINGS (seed for Stage 4 — verify before acting)

| # | Finding | Hits checklist | Confidence | Anchors |
|---|---------|----------------|-----------|---------|
| **F1** | **Live bug**: model/provider env not present at chat time → "Model not configured" + "No inference provider". Prime suspect: `${CONFIG_DIR}/.env` not auto-loaded into `process.env` at boot; OPENROUTER_API_KEY needs vault unlock. | §2 bug, model global | HIGH (mechanism), needs final confirm of dotenv-load | Z6 `index.ts`, `ipc/sessions/get-model.ts:25`, `ipc/chat.ts:43`; Z3 `inference/config.ts:69`, `registry.ts:86`; Z8 `SessionRuntimeBar.tsx:112` |
| **F2** | **Wake executor never started in vex-app** → mission autonomous defer/sleep→wake loop is dead; deferred missions sleep forever. | Mission/full-autonomous | HIGH (Z2+Z6 agree) | `startWakeExecutor` exported, zero prod callsite; Z6 `index.ts:126` starts only compact |
| **F3** | **Approval card UI not wired** in renderer → restricted-mode `paused_approval` soft-locks user (backend approve→resume is complete). | Restricted mode + approve→resume | HIGH | Z8 `lib/api/approvals.ts` hooks unused; Z1/Z6 approval runtime complete |
| **F4** | `loadConfig()` hits OpenRouter models API every turn; returns null on transient failure/model-not-listed → session-level "no provider"; `resetProvider()` never called post-unlock. | OpenRouter connection robustness | MED | Z3 `openrouter.ts:98`, `registry.ts:134` |
| **F5** | `EV.engine.controlState` not bridged to renderer; `RuntimeBridge` type drift. Renderer observes runtime via polling/transcript, not control events. | Runtime status display | MED | Z7 `channels.ts:281`, `runtime.ts` |
| **F6** | `connection-state.ts` null on cold start; engine handlers fail `dbUnavailableError` unless `composeUp` re-run. | Conversation flow after restart | MED | Z6 `database/connection-state.ts` |
| **F7** | Per-session wallet ✓ (mig026 + IPC + picker); global model ✓ (no model_id); compaction parallel ✓; context meter ✓; /restore + /mission-renew exist ✓. | Several — IMPLEMENTED | HIGH | Z4/Z6/Z8 |
| **F8** | Subagents fully built but disabled (`subagent_spawn` commented). Possibly intentional for MVP. | (scope) | HIGH | Z2/Z3 dispatcher |
| **F9** | Slash placeholder lists 4 of 9 commands; transcript not virtualized (500-node cap). | UI polish | HIGH | Z8 `SessionComposer.tsx:279`, `messages.ts:36` |
| **F10** | Wallet keystore KDF N=16384 < vault N=65536. | Security review | MED | Z5 `tools/wallet/keystore.ts:27` |

---

## OPEN VERIFICATION QUESTIONS (for Stage 3/4)
1. Is `${CONFIG_DIR}/.env` loaded into `process.env` at vex-app/engine boot? (decides F1) — check engine entry + any dotenv loader.
2. Was the vault unlocked in the screenshot's session? (the `UnlockScreen` exists; on restart vault re-locks.)
3. Is wake-worker omission intentional or a wiring gap? (F2 — affects whole autonomous mode.)
4. Is the approval card a planned-but-unbuilt step (F3)?
5. Does `loadConfig()` paginate `models.list()`? (F4 false-negative risk.)
6. Mission `/restore` `/mission-renew` `/rewind` — verified end-to-end (engine handlers exist; confirm IPC↔engine↔UI round-trip).
