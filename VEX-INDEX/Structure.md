# VEX-INDEX — Structure.md (Stage 1: Repository Index)

> Durable structural index of the Vex repo for future LLM/Codex navigation.
> Refreshed on 2026-05-28 from 10 read-only Explore reports against source
> snapshot `cf05003` (`docs(vex-index): Round 2 — root src module index (10 modules)`).
> Detailed module facts live under `modules/`; this file is the cross-zone map.

Zone map: **Z0** build/config/ops · **Z1** engine core/runtime · **Z2** mission/wake/compact/prompts ·
**Z3** inference+tools · **Z4** db+memory/knowledge/sync/embeddings · **Z5** root `src` lib/tools ·
**Z6** Electron main · **Z7** preload+shared IPC · **Z8** renderer.

---

## 0. Monorepo & build/resolution model

Two independent pnpm package roots, not a pnpm workspace:

- `/Vex/package.json` — root MCP/CLI library + canonical `src/vex-agent` runtime; `packageManager: pnpm@10.32.1`, TypeScript 5.6.
- `/Vex/vex-app/package.json` — Electron desktop app; `packageManager: pnpm@10.32.1`, Electron 42, Vite 8, React 19.2, TypeScript 6.
- CI installs both roots. The Electron app bundles root sources into main/preload/renderer, so root dependencies must exist when app builds.

**Resolution / aliases**
- `vex-app` aliases root code as `@vex-lib/*` and dynamically imports `@vex-agent/*` from Electron main only.
- Root `tsconfig.json` aliases are `@tools/*`, `@utils/*`, `@config/*`, `@vex-agent/*`. There is no root `@lib/*` alias.
- Renderer/shared currently import only pure `@vex-lib` modules (`agent-config`, `embedding-constants`, diagnostics schemas). Keep `@vex-lib/wallet`, FS, DB, Docker, signing, and Node-only code out of renderer.

**Build / gates**
- Root scripts: `pnpm build` runs `tsc` + `tsc-alias`; root tests are Vitest.
- App scripts: `pnpm --dir vex-app lint` = `tsc --noEmit` + process-boundary check; `build` = lint + Vite main/preload/renderer; `postbuild` runs `scripts/check-build-artifacts.mjs`.
- App Vite main config must preserve Node platform/external behavior; changing it can break runtime Node built-ins in Electron main.
- `vex-app/electron-builder.yml` is an unsigned dev/test packaging profile (`forceCodeSigning: false`, notarization/signature verification disabled). Production signing, notarization, checksums, updater metadata, and release workflow are not present.
- `afterPack.mjs` applies Electron fuses. Postbuild artifact checks cover CSP/protocol/preload/renderer/compose/migration safety.

**Migration mirror**
- Canonical migrations live in `src/vex-agent/db/migrations/`.
- App-packaged mirror lives in `vex-app/resources/migrations/`.
- `vex-app/scripts/copy-migrations.mjs` syncs the mirror; `vex-app/scripts/check-build-artifacts.mjs` verifies packaged migration resources. Treat both as release-critical gates.

### Config/secret layout (`${CONFIG_DIR}` = `%APPDATA%/vex` | `~/Library/Application Support/vex` | `~/.config/vex`)

- `.env` — non-secret runtime config: `AGENT_MODEL`, `AGENT_PROVIDER=openrouter`, `AGENT_CONTEXT_LIMIT`, `AGENT_MAX_OUTPUT_TOKENS`, `AGENT_TEMPERATURE`, `SUBAGENT_*`, `EMBEDDING_*`.
- `secrets.vault.json` — AES-256-GCM + scrypt(N=65536); holds `OPENROUTER_API_KEY`, `JUPITER_API_KEY`, `TAVILY_API_KEY`, `RETTIWT_API_KEY`, Polymarket creds. Injected to `process.env` only after unlock.
- `config.json` — public wallet addresses, chain/RPC/service URLs.
- `keystore.json` / `solana-keystore.json` — wallet keystores (AES-256-GCM + scrypt N=16384, weaker than vault; tracked as security finding).
- `.setup-complete`, `.install-id`, `.electron-state/{preferences,wizard-state}.json`, and rendered `compose/docker-compose.yml`.

---

## Z1 — vex-agent engine core/runtime (`src/vex-agent/engine/{core,events,runtime,checkpoint,support}`)

Owns run lifecycle: claim lease -> hydrate -> build tools -> `runTurnLoop` -> finalize -> release lease. Provider/model are resolved per entry point from global env, not session state.

**Entry / key files**
- `engine/ingress.ts:43 routeUserMessage` — main entry for chat/operator instructions; routes by run status.
- `engine/types.ts:59 MISSION_RUN_STATUSES` — running, paused_approval, paused_wake, paused_error, paused_user, completed, failed, stopped, cancelled.
- `engine/types.ts:239 EngineContext` — no model/provider fields.
- `engine/core/turn.ts:66 executeTurn`, `:258 saveAssistantMessage`.
- `engine/core/turn-loop.ts:77 runTurnLoop` plus helper modules for tool batches, waiting-for-wake, post-compact, control emits.
- `engine/core/runner/agent.ts:29 processAgentTurn` and mission runner files for prepare/resume/finalize/recover.
- `engine/events/append-transcript.ts:85 appendMessage` — all transcript writes funnel here, then publish transcript event after commit.
- `engine/runtime/lease-and-status/*` — atomic CAS claim/heartbeat/release and control-state observation.
- `engine/runtime/control-bus.ts` — main emits live control-state, but renderer does not receive it yet (F5).

**Cross-zone**: imports Z3 provider/tools, Z4 repos/client, Z2 mission/wake/compact/prompt helpers, Z5 diagnostics. Consumed by Z6 IPC and bridge setup.

---

## Z2 — engine mission/wake/subagents/prompts/compaction (`src/vex-agent/engine/{mission,wake,subagents,prompts,compact-jobs}`)

**Mission lifecycle**: draft/patch/accept/commit-start/restore/renew/stop contract. Mission statuses are draft, ready, running, completed, failed, cancelled.

**Wake/defer/sleep**
- `tools/internal/loop-defer.ts:62 handleLoopDefer` enqueues `loop_wake_requests` and returns `defer_until`.
- `wake/executor.ts:83 startWakeExecutor` polls due rows, claims with `FOR UPDATE SKIP LOCKED`, claims the run lease, injects a wake banner, and calls `resumeMissionRun`.
- Wake is now wired in desktop boot by Z6 `setupWakeWorker()` and has a pre-claim provider gate requiring `OPENROUTER_API_KEY && AGENT_MODEL`. Removing the gate can consume wake rows before they can resume.

**Compaction**
- Track 1 `compact-jobs/service.ts:64 executeCompactNow` is synchronous and atomic: summary/archive/enqueue Track 2 in one transaction.
- Track 2 `compact-jobs/executor.ts:64 startCompactJobsExecutor` polls `compact_jobs`, calls the OpenRouter chunker, embeds chunks, and writes `session_memories`. It is non-blocking; failure does not roll back Track 1.
- Track 2 currently requires `OPENROUTER_API_KEY && AGENT_MODEL`; the chunker directly constructs `OpenRouterProvider`, bypassing the inference registry singleton/reset path for in-flight calls.

**Prompts / subagents**
- `prompts/index.ts:91 buildPromptStack` layers base, clock, pressure, resume packet, memory, knowledge, tool catalog, permission and wallet banners.
- `prompts/protocols.ts` caches the protocol prompt per process; env/tool visibility changes after first build can leave stale tool counts until cache reset.
- Subagent runner/relay is implemented, but the public tool surface is disabled in both registry and dispatcher. Re-enable only by changing registry + dispatcher + prompts + tests together.

**Cross-zone**: imports Z1 runtime/lease/turn loop, Z3 inference/tools, Z4 repos/memory/embeddings. Consumed by Z6 workers and IPC.

---

## Z3 — vex-agent inference + tools (`src/vex-agent/{inference,tools}`)

**Inference**
- Provider is global, OpenRouter only. `inference/config.ts` reads `process.env.AGENT_PROVIDER`, `OPENROUTER_API_KEY`, `AGENT_MODEL`, and parseable AGENT_* settings.
- F1 is fixed for provider persist and boot: Z6 loads non-secret `.env` at boot and provider persist reloads with overwrite + `resetProvider()`.
- Caveat: generic vault unlock/secret writes do not call `resetProvider()`. A previously cached provider can stay stale if secrets/model change outside provider persist; null providers are not cached.
- F4 remains open: `OpenRouterProvider.loadConfig()` calls the OpenRouter models API on every turn and can return null on transient API/model-list failure.

**Tools**
- `tools/registry.ts` builds the visible tool set; pressure/env filters happen at runtime.
- `tools/dispatcher.ts` approval gate uses **`mutating`**, not `actionKind`: restricted + mutating + not approved -> pending approval.
- `actionKind` is still important for intent/risk/audit/UI, but it does not by itself force approval.
- `execute_tool` is a read-only wrapper; protocol runtime overwrites result `actionKind` from the target manifest. Incorrect manifest metadata directly affects approval/risk/audit.
- `document_delete` is `actionKind:"destructive"` AND now `mutating:true` (FIXED in Bundle A / FINDING-security-005 — was `mutating:false`, which bypassed the restricted-mode approval gate). `document_write` deliberately stays `mutating:false` (low-risk, recoverable scratchpad; pinned by a dispatcher test).

**Cross-zone**: consumed by Z1/Z2. Imports Z4 repos and Z5 protocol/wallet clients.

---

## Z4 — vex-agent data + memory/knowledge/sync/embeddings (`src/vex-agent/{db,memory,knowledge,sync,embeddings,scripts,public}`)

**Schema**
- Current schema version is 027 across 24 SQL migration files; gaps 007/008/012 are intentional.
- `sessions` has mode/permission/title/pinned/deleted/checkpoint fields plus selected EVM/Solana wallet id/address from migration 026.
- `sessions` has **no `model_id`**. Model is global by ADR-0001; wallet selection is per-session.
- DB enforces wallet id/address atomicity, not immutability by trigger. App/engine create/update paths enforce session-scope immutability/CAS.

**Repos / DB access**
- Engine uses `src/vex-agent/db/client.ts` pool + typed repos.
- Electron main uses its own raw `vex-app/src/main/database/*` `pg.Client` layer against the same local Postgres. SQL and shared schemas are the boundary.
- A few main handlers dynamically import engine repos where intentionally documented, including wallet intents, runtime-control, loop-wake, compact-jobs, and knowledge status update.
- `inbox_events` has `src/vex-agent/db/repos/inbox.ts`; old “no repo found” notes are obsolete.

**Embeddings**
- The bundled desktop compose stack uses `llama.cpp:server` on host `127.0.0.1:55134`, OpenAI-compatible base URL `/v1`, alias `ai/embeddinggemma:300M-Q8_0`, dim 768.
- Older `:12434` Docker Model Runner references remain in probe/config paths and docs; treat them as legacy/status-only unless code proves they are required.
- Vector columns have no typmod. Recall filters by `embedding_model` and `embedding_dim`.

**Sync**
- `src/vex-agent/sync` exposes projectors/executor for protocol sync runs.
- Desktop boot wires compact + wake + sync workers (sync added in Bundle A / F11). `setupSyncWorker()` drains `protocol_sync_jobs`/`protocol_sync_runs` enqueued by mutating protocol tools.

---

## Z5 — root `src` lib/tools/providers/config/constants/utils

Root MCP/CLI library; pure subsets are bridged into `vex-app` through `@vex-lib`.

- `src/config/paths.ts` and `vex-app/src/main/paths/config-dir.ts` intentionally duplicate config-dir resolution. Drift can split `.env`, vault and keystores.
- `src/lib/runtime-env.ts` is the F1 facade for `loadProviderDotenv()`.
- `src/providers/env-resolution.ts` loads non-secret `.env` keys and skips managed secrets.
- `src/lib/local-secret-vault.ts` + `src/lib/secret-keys.ts` own vault format and key list.
- `src/lib/env.ts` exists with env-key constants / `TRACKED_API_KEYS`; no active consumers found in this verification.
- `src/lib/agent-config.ts`, `embedding*.ts`, and diagnostics schemas are renderer-safe only when they remain pure.
- `src/tools/wallet/**` owns local keystore, inventory, signing clients, and Polymarket credential derivation.
- Protocol clients under `src/tools/{dexscreener,khalani,kyberswap,polymarket,solana-ecosystem,twitter-account}` are engine/main-only. They assume caller has already enforced approval, wallet policy, and key lifetime.

Lock semantics (FIXED in Bundle A / FINDING-security-003): `lockSecretSession()` now (1) clears the in-memory master password, (2) sweeps `MANAGED_SECRET_ENV_KEYS` (master-password key + all vault keys) from `process.env`, and (3) awaits `resetProvider()` to drop the cached inference provider (necessary because `resolveProvider()` returns its cache before re-reading env). Centralized in `scrubUnlockedRuntime()` + `invalidateProviderCache()`; the `getUnlockedSecretPresence` failure path routes through the same scrub.

---

## Z6 — vex-app main process (`vex-app/src/main`)

Privileged process: secrets, wallet, DB, Docker/Compose, onboarding, IPC, engine bridge, packaging-time security gates.

**Bootstrap (`index.ts`)**
- `index.ts:51` maps Electron `userData` to `${CONFIG_DIR}/.electron-state`.
- `index.ts:86` enforces single instance.
- `index.ts:92` registers app protocol privileges before ready.
- `index.ts:116 loadProviderDotenv()` loads non-secret `.env` before IPC handlers/workers.
- `index.ts:120 installPermissionHandlers()` deny-all permissions.
- `index.ts:126 installAppProtocolHandler(rendererRoot)`.
- `index.ts:129 registerAllIpcHandlers()`.
- `index.ts:136 setupCompactWorker()` starts Track 2 supervisor.
- `index.ts:143 setupWakeWorker()` starts wake supervisor.
- `index.ts setupSyncWorker()` starts the sync supervisor (Bundle A / F11; no provider gate, public-address egress).
- `index.ts` drains compact+wake+sync workers (Promise.allSettled) before Compose/Postgres cleanup on quit.

**Security**
- `windows/main-window.ts:139-150` uses `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `webSecurity:true`, no insecure content, devtools only unpackaged.
- `windows/main-window.ts:171-187` denies `window.open` and blocks navigation outside allowed app/dev URLs, only forwarding allowlisted external URLs to `shell.openExternal`.
- `protocol/app-protocol.ts:20-58` implements privileged `app://vex` with host/path containment and no production `file://` loading.
- `permissions.ts:11-27` denies permission checks/requests/device/display media by default.

**IPC / engine bridge**
- `register-handler.ts` validates sender and request envelope, then main-side output schemas/error envelopes. Preload does not validate invoke outputs.
- `agent/index.ts` subscribes transcript/control/stream buses and bug-report sink. Control-state reaches main broadcast but not renderer bridge yet (F5).
- Engine calls are dynamic imports from Electron main; renderer never imports `src/vex-agent`.

**Docker/local services**
- `ipc/docker.ts`, `docker/*`, `compose/*`, and `database/*` own Docker detection/start, endpoint policy, compose render/up/stop, health probes, migration status, and DB connection handoff.
- Compose template binds only `127.0.0.1`, uses digest-pinned images, SCRAM Postgres secrets, and local named volumes.
- Normal quit stops services without deleting volumes. Destructive reset/recovery must remain explicit and gated.

**Updater/release**
- `electron-updater` dependency and placeholder IPC/event constants exist, but no `autoUpdater`, download, install, or registered updater handler was found. No silent updater path exists today.

---

## Z7 — vex-app preload + shared (`vex-app/src/{preload,shared}`)

Trust boundary: `window.vex` is a narrow typed bridge; no raw `ipcRenderer`, `invoke`, `send`, Electron, Node, DB, Docker, wallet or signing authority is exposed.

- `preload/index.ts:34-36` exposes `{...shellBridge, ...agentBridge} satisfies VexBridge`.
- Preload surface: 10 shell domains + 13 agent domains.
- `shared/ipc/channels.ts` current inventory: 93 request channel constants across 24 request domains; `EV` has 10 event constants across system/docker/database/updater/engine.
- `shared/ipc/result.ts` current inventory: 29 domains, 54 error codes.
- `preload/_dispatch.ts` validates renderer inputs and subscribed events; main `registerHandler` validates success outputs and malformed error envelopes.
- Unbridged/dead or reserved constants: `CH.onboarding.providerListModels`, `CH.onboarding.providerTest`, `CH.updater.check`, `EV.engine.controlState`, `EV.system.*`, `EV.docker.daemonChanged`, `EV.updater.available`.
- F5 remains real: main publishes `EV.engine.controlState`, but preload engine bridge currently exposes transcript append + stream delta only.
- Runtime bridge type drift remains: `RuntimeBridge` uses legacy `RuntimeRequestResult` while handlers validate per-action schemas.

---

## Z8 — vex-app renderer (`vex-app/src/renderer`)

Untrusted UI. It talks to main only via `window.vex` and pure shared schemas/types.

- `App.tsx:40-49` route map: splash -> systemCheck -> dockerBootstrap -> composeBootstrap -> migrations -> wizard -> unlock -> appShell.
- `WizardShell.tsx:174-199` makes unlock conditional; completed setup with locked vault routes to `unlock`, not blindly to appShell.
- Wizard order: keystore -> wallets -> apiKeys -> embedding -> agentCore -> provider -> review.
- `SessionPanel.tsx:93-109` active-session mount order: `SessionContext`, optional `MissionContractCard`, `SessionTranscript`, `ApprovalsRegion`, `SessionComposer`.
- F3 is fixed: `ApprovalsRegion` polls pending approvals every 5s because control-state is not bridged; `ApprovalCard` invalidates pending/history/messages/runtime after approve/reject.
- `SessionRuntimeBar.tsx:99-129` displays global model/unconfigured state from `sessions.getModel`; there is no per-session model selector.
- `SessionCreator.tsx` owns per-session wallet selection at session creation.
- Docker/compose/migrations UI is route-driven from IPC result kinds; log parsing is cosmetic.
- Settings currently re-enters wizard/reconfigure surfaces; updater UI is absent beyond constants/preferences placeholders.
- Transcript still has a 500-node cap/no virtualization; slash placeholder lists fewer commands than implemented.

---

## Integration wiring map

**Chat submit**: Z8 `SessionComposer` -> preload `chat.submit` -> Z6 `ipc/chat.ts` (DB URL handoff) -> dynamic import `@vex-agent/engine` -> Z1 `routeUserMessage` -> Z3 provider/tools -> turn loop/stream -> Z6 bridges -> Z8 stream preview and transcript invalidation.

**Mission start / wake**: Z8 slash `/mission start` -> Z6 mission IPC -> Z2 `prepareMissionStart` + fire-and-forget runner. `loop_defer` writes `loop_wake_requests`, run becomes `paused_wake`; Z6 `setupWakeWorker()` now starts the wake executor, which gates before claim on provider readiness.

**Restricted approval**: mutating tool + restricted + not approved -> Z3/Z1 approval queue/intents -> run `paused_approval`. Z8 `ApprovalsRegion` polls and renders `ApprovalCard`; approve/reject IPC calls Z6 approval runtime and resumes/finalizes through Z1. Live control-state still does not reach renderer (F5), so polling/invalidation is the workaround.

**Compaction**: context pressure -> Z2 Track 1 `executeCompactNow` archives prefix and enqueues outbox in one transaction; Z6 `setupCompactWorker()` runs Track 2 async chunking/embedding. Track 2 requires key+model but never blocks Track 1.

**Model/provider**: onboarding provider persist writes `.env` `AGENT_MODEL`/`AGENT_PROVIDER` and vault `OPENROUTER_API_KEY`; then reloads `.env` with overwrite and calls `resetProvider()`. Boot loads `.env` before IPC/workers. Vault unlock still required for `OPENROUTER_API_KEY`.

**Local services**: renderer bootstrap -> Z6 Docker/Compose IPC -> endpoint policy -> rendered compose -> Postgres/pgvector + embedding service -> migration runner -> appShell. Remote Docker contexts are rejected to keep data/secrets local.

---

## Cross-cutting findings

| # | Finding | Status | Confidence | Anchors |
|---|---------|--------|------------|---------|
| **F1** | Model/provider boot bug fixed: non-secret `.env` loads before IPC/workers; provider persist reloads with overwrite + `resetProvider()`. Vault unlock is still required for API keys. | fixed | HIGH | `vex-app/src/main/index.ts:116`, `vex-app/src/main/ipc/onboarding/provider.ts`, `src/providers/env-resolution.ts` |
| **F2** | Wake worker omission fixed: `setupWakeWorker()` starts at boot and executor gates before destructive claim on key+model. | fixed | HIGH | `vex-app/src/main/index.ts:143`, `src/vex-agent/engine/wake/executor.ts` |
| **F3** | Restricted approval UI fixed: `ApprovalsRegion` + `ApprovalCard` are mounted in `SessionPanel`. | fixed | HIGH | `vex-app/src/renderer/features/appShell/SessionPanel.tsx:103`, `ApprovalsRegion.tsx:38` |
| **F4** | OpenRouter `loadConfig()` still hits models API every turn; transient model API failures can look like no provider. Provider reset is not called on generic vault unlock. | open | MED | `src/vex-agent/inference/openrouter.ts:98`, `registry.ts:134`, `vex-app/src/main/secrets/session.ts` |
| **F5** | `EV.engine.controlState` is broadcast from main but not bridged to renderer; runtime UI relies on polling/invalidation. | open | HIGH | `vex-app/src/main/agent/control-bridge.ts:23`, `vex-app/src/preload/agent/engine.ts` |
| **F6** | Runtime bridge result types drift from current per-action schemas. | open | MED | `vex-app/src/shared/types/bridge/agent/runtime.ts`, `vex-app/src/shared/schemas/runtime.ts` |
| **F7** | ADR-0001 holds: global model, no `sessions.model_id`, per-session wallet selection. | implemented | HIGH | migration 026, `sessions.getModel`, ADR-0001 |
| **F8** | Subagents are implemented but intentionally disabled at registry/dispatcher surface. | intentional | HIGH | `tools/registry/subagents.ts`, `tools/dispatcher.ts` |
| **F9** | UI polish/perf: slash placeholder incomplete; transcript cap/no virtualization. | open | HIGH | Z8 appShell files |
| **F10** | Wallet keystore KDF N=16384 is weaker than vault N=65536 (still open). Lock-clear half FIXED by Bundle A: `lockSecretSession()` now sweeps `MANAGED_SECRET_ENV_KEYS` from `process.env` + resets the cached provider. | partial (KDF open; lock-clear fixed) | MED | `src/tools/wallet/keystore.ts`, `vex-app/src/main/secrets/session.ts` |
| **F11** | Sync executor wiring FIXED by Bundle A: `setupSyncWorker()` started at boot (after wake) + drained on quit; new `agent/sync-worker.ts` + `database/sync-db.ts` (probe `protocol_sync_jobs`). No provider gate (public-address egress, no key access). | fixed | HIGH | `src/vex-agent/sync/executor.ts:39`, `vex-app/src/main/index.ts`, `vex-app/src/main/agent/sync-worker.ts` |
| **F-S5** | `document_delete` approval-gate bypass FIXED by Bundle A: `mutating:true` so restricted mode now gates it. `document_write` intentionally stays ungated. | fixed | HIGH | `src/vex-agent/tools/registry/documents.ts:54`, `src/vex-agent/tools/dispatcher.ts:293` |
| **F12** | Updater/release is placeholder-only: dependency/channels exist, no implementation, no production signing/notarization/update workflow. | open | HIGH | `vex-app/package.json`, `shared/ipc/channels.ts`, `.github/workflows/ci.yml` |
| **F13** | Docker Model Runner `:12434` references are legacy/status drift; bundled compose uses llama.cpp on `127.0.0.1:55134/v1`. | open-doc-drift | HIGH | `vex-app/resources/compose/docker-compose.template.yml`, `embedding-defaults.ts` |

---

## Open verification questions

1. ~~Is the sync executor intentionally not started in the Electron desktop app?~~ RESOLVED (Bundle A): it should join compact+wake — `setupSyncWorker()` now wired in `index.ts`.
2. Should vault lock clear vault-injected API keys from `process.env`, or is “UI lock only clears master password” the intended runtime model?
3. Should `document_delete` be `mutating:true`, or is it intentionally destructive/actionKind-only but approval-free?
4. Should `CH.updater.check` remain a reserved constant, or be removed until updater implementation lands?
5. Before any production release: verify current official Electron Builder, electron-updater, platform signing/notarization, Docker Desktop installer support, and update metadata requirements.
