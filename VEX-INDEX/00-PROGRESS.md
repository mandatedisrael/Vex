# VEX-INDEX — Master Progress & Ground Truth

> Persistent tracker for the **vex-app ↔ src/vex-agent integration verification**.
> Everything we learn is saved under `VEX-INDEX/`. This file is the canonical anchor
> and MUST be re-read at the start of any resumed session.

Started: 2026-05-27. Owner: integration verification (read-first, then propose).

---

## 0. Objective

Verify what the **source-of-truth runtime** (`src/vex-agent/`) actually implements, then
verify whether each capability is **correctly wired into the Electron app** (`vex-app/`).
Produce gap notes (missing in vex-app) + simplification notes (over-complex vs MVP).
We are **auditing**, not yet implementing. No production/destructive changes without approval.

Verification direction (per product owner): **vex-agent = source of truth → check mapping into vex-app.**

---

## 1. GROUND TRUTH (current product intent — overrides older plan docs)

The `agents_dm/plan-integration/` docs are a **UI/UX reference snapshot** and in places
**contradict** current intent. Where they differ, THIS section wins:

1. **Model is GLOBAL.** Configured once in onboarding, applied to **every** session, billed
   centrally. There is **NO per-session model selection**.
   - ⚠️ Plan docs (`06-model-context-usage.md`, README, `00-current-state...` line 73/88/190)
     propose per-session `sessions.model_id`. That is **NOT** current intent.
   - The engine *already* uses a **global** provider config from env (`resolveProvider()` /
     `provider.loadConfig()`, `.env`: `AGENT_MODEL`, `AGENT_PROVIDER=openrouter`). This MATCHES intent.
   - Any per-session-model code found is a **candidate divergence / bug source**.
2. **Wallets are selected PER SESSION.**
3. **Secrets encrypted with a master password** (AES-256-GCM + scrypt). `OPENROUTER_API_KEY`
   lives in `secrets.vault.json`; injected into `process.env` only after unlock; password
   held in memory only.
4. **Renderer is untrusted UI.** No `src/vex-agent`, Node/Electron privileged, DB, Docker,
   wallet, or signing imports in renderer. All side effects via typed IPC.
5. **MVP focus.** Prefer simplification over feature-completeness where the plan over-engineered.

### Mode semantics (product owner, authoritative)
- **Agent / FULL permission** — agent conducts transactions itself; no approval gate.
- **Agent / RESTRICTED** — inline approval card appears in chat on a transaction tool call;
  user clicks Approve → tx executes. **A signal must flow back to the agent** that the user
  approved, so the run resumes. (Suspected missing/incomplete — verify.)
- **Mission = FULL AUTONOMOUS** — user sets up a mission; agent does everything to fulfill it.
  It can **self-sleep**: calls a defer/sleep tool writing a **wake timestamp**, then wakes on
  schedule and loops message → tool call → response until mission stop conditions are met.
- **Compaction** — when the context window fills, compaction runs; **chunk creation runs in
  PARALLEL** to compaction so it does not block the main context window (a vex-agent worker).

---

## 2. LIVE BUG (from Screenshot_1.jpg)

Chat header shows **"Model not configured"** + `0%` context bar; composer error (red):
**"No inference provider is available. Unlock Vex or complete provider setup, then retry."**
— despite onboarding being completed. Session is `AGENT` / `FULL`.

Hypotheses to confirm in Stage 4:
- (H1) Vault unlock not injecting `OPENROUTER_API_KEY` into the engine process's `process.env`.
- (H2) `.env` (`AGENT_MODEL`/`AGENT_PROVIDER`) not read on the vex-app chat path.
- (H3) A partial per-session-model layer reports "not configured" when `model_id` is NULL
  instead of falling back to the global default.
- (H4) Provider readiness check (`resolveProvider`/availability gate) wired to wrong source.

---

## 3. STAGE PLAN

| Stage | Goal | Output | Status |
|------|------|--------|--------|
| 1 | Index the repo — what's where, per-file purpose, cross-zone links | `VEX-INDEX/Structure.md` | ✅ DONE + refreshed 2026-05-28 (10-agent verification) |
| 2 | Functionality map — every workflow/module in vex-agent & vex-app, how they relate | folded into `Structure.md` §INTEGRATION WIRING MAP + module docs | ✅ covered for src/vex-agent/root-src; vex-app module docs seeded |
| 3 | Deep analysis + dependency map per module (modes, tools, mission, rewind, compaction, approvals, model/inference, wallets, onboarding) | `VEX-INDEX/Deep-*.md` | NEXT |
| 4 | Verification — vex-agent capability vs vex-app wiring; gaps + simplifications; resolve §2 bug | `VEX-INDEX/Gap-Report.md` per area | pending |

**Headline findings — all three blockers FIXED + dual-Codex-reviewed (uncommitted):**
- **F1** ✅ FIXED — `.env` boot-load + post-onboarding overwrite-reload + `resetProvider()`. Plan: `fix-plans/F1-model-provider-env.md`.
- **F2** ✅ FIXED — wake worker wired with pre-claim provider gate in the executor. Plan: `fix-plans/F2-wake-worker.md`.
- **F3** ✅ FIXED — inline approval card + region mounted in SessionPanel. Plan: `fix-plans/F3-approval-card-ui.md`.
- **F7** — IMPLEMENTED & matches intent: per-session wallet, global model (no model_id), parallel compaction, context meter, /restore + /mission-renew.

Method: parallel **Explore** agents (read-only). Stage 1 indexers run on **Sonnet** (mechanical
enumeration); deep stages use **Opus**. Agents are instructed to read `vex-platform-architecture`
+ a zone skill, and apply repo rules/skills.

---

## 4. STAGE-4 VERIFICATION CHECKLIST (targets from product owner)

Legend: ⛔ broken/gap · ⚠ partial/fragile · ✅ implemented (confirm e2e) · ❓ unverified
- [x] ✅ §2 bug FIXED + VERIFIED — F1: vex-app now loads `${CONFIG_DIR}/.env` into `process.env` at boot (`loadProviderDotenv()` in `index.ts`) + reloads with overwrite + `resetProvider()` after provider persist. Harness: Codex plan + final GREEN LIGHT (`harness-integration-blockers`). Tests 34/34 (root) + 11/11 (vex-app), vex-app lint + root source tsc pass. NOT committed (no user request). Plan: `fix-plans/F1-model-provider-env.md`.
- [ ] ❓ Global model config (onboarding → `.env`/vault → engine) reaches every session — depends on F1
- [ ] ✅ Per-session wallet selection wired (mig026 + IPC + picker) — confirm e2e
- [ ] ❓ Central billing of model usage (usage_log per-turn; confirm aggregation/display)
- [ ] ⚠ Secrets encrypted under master password; unlock → env injection — confirm boot vs unlock timing (F1)
- [ ] ⚠ OpenRouter ↔ vex-app (streaming OK; F4: per-turn `loadConfig` fragility, no resetProvider on unlock)
- [ ] ✅ Conversation flow e2e (submit→engine→stream→transcript) — confirm; F6 cold-start DB risk
- [ ] ✅ Tool-call rendering in chat (`TranscriptMessage` tool variant) — confirm
- [ ] ✅ Context-usage % bar + context window value (`ContextMeter`, `usage.getContextWindow`) — confirm
- [ ] ✅ Header shows configured model badge (`ModelIndicator` + `ModelBrandIcon`) — gated by F1
- [ ] ❓ Mode: FULL permission (agent executes tx directly) — verify no approval gate path
- [x] ✅ Mode: RESTRICTED — F3 FIXED: inline `ApprovalCard` + `ApprovalsRegion` mounted in `SessionPanel` between transcript and composer; two-step confirm for `risk in {high,critical}` or `actionKind in {destructive,user_wallet_broadcast}`; default focus on Reject for first new card; invalidates pending+history(prefix)+messages+runtime on resolve; aria-live polite; bounded `max-h-[40vh]`. Dual Codex GREEN LIGHT. Tests: 14/14 (8 card + 5 region + 1 SessionPanel mount). vex-app lint + root src tsc pass. NOT committed. Plan: `fix-plans/F3-approval-card-ui.md`. Follow-up: `expiresAt` countdown (non-blocking; backend expiry is authoritative).
- [x] ✅ Mode: Mission/FULL AUTONOMOUS — F2 FIXED: `setupWakeWorker` wired in `index.ts` (supervisor DB+schema gate) + executor pre-claim provider gate (`OPENROUTER_API_KEY && AGENT_MODEL`). Dual Codex GREEN LIGHT. Tests: engine 10/10, vex-app 9/9, lint + root src tsc pass. NOT committed. Plan: `fix-plans/F2-wake-worker.md`.
- [ ] ✅ Compaction + **parallel** chunk creation (Track1 sync + Track2 async) — confirm; Track2 needs key
- [ ] ✅ Slash `/mission start`,`/rewind`,`/restore`,`/mission-renew` exist both sides — confirm round-trip
- [ ] ❓ Messages do not overflow session area (UI) — F9: no virtualization, 500-node cap
- [ ] ❓ Security review of full Electron app — F10 keystore KDF; trust boundaries look respected

---

## 5. ZONE MAP (Stage 1 indexing assignment)

- **Z1** `src/vex-agent/engine` core/runner/events/runtime(+lease)/checkpoint/support
- **Z2** `src/vex-agent/engine` mission/wake/subagents/prompts/compact-jobs
- **Z3** `src/vex-agent/inference` (openrouter) + `tools` (internal + protocols)
- **Z4** `src/vex-agent/db` + memory/knowledge/sync/embeddings/scripts/public
- **Z5** root `src/` tools/lib/providers/config/constants/utils (MCP/CLI lib via `@vex-lib`)
- **Z6** `vex-app/src/main` (all privileged: ipc, agent bridge, secrets, wallet, onboarding, workers)
- **Z7** `vex-app/src/preload` + `vex-app/src/shared` (IPC contracts, channels, schemas, bridge types)
- **Z8** `vex-app/src/renderer` (UI: wizard/onboarding, chat compose, wallets, stores, slash)

Build/config (root + vex-app) consolidated by the lead (me) during Structure.md assembly.

---

## 6. LOG

- 2026-05-27: Recon done (tree, plan-integration README + 00-disputes read, skill paths, file
  counts). Ground truth + bug recorded. Launching 8 Stage-1 Explore indexers (Sonnet).
- 2026-05-27: Stage 1 complete. 8 indexers returned; `Structure.md` written (zone index +
  integration wiring map + F1–F10 findings). Functionality map folded into wiring map. Headline
  gaps: F1 (model env/boot), F2 (wake worker not started), F3 (approval UI missing). Next: Stage 3
  deep-dives starting with F1 bug confirmation (verify `.env` boot-load), then F2/F3, then
  systematic Stage-4 gap reports per checklist area.
- 2026-05-27: F1 FIXED via /harness (Codex reviewer, session `harness-integration-blockers`). 8
  files (7 modified + new `src/lib/runtime-env.ts`). Codex plan GREEN LIGHT (after BLOCKED round-1
  requiring `resetProvider()`), final GREEN LIGHT. Verified: root 34/34, vex-app 11/11, vex-app lint
  + boundary check + root source tsc all pass. NOT committed. Found preexisting tech debt:
  `tsconfig.test.json` is red on baseline (147 tsc errors across 30 untouched test files —
  InternalToolContext drift, `findLast` lib target). Now starting F2 (wake worker wiring).
- 2026-05-28: F2 FIXED via /harness (Codex session continued). NEW `vex-app/src/main/agent/wake-worker.ts`
  + `database/wake-db.ts` (+ tests); engine `wake/executor.ts` gains a pre-claim provider gate
  (`isProviderReady` dep + exported `isWakeProviderConfigured`); `index.ts` wires `setupWakeWorker` and
  drains both workers before Postgres teardown (logs rejected stops). Codex plan GREEN LIGHT after
  BLOCKED round-1 (required pre-claim gate inside the executor, both env vars), final GREEN LIGHT.
  Verified: engine 10/10, vex-app 9/9, vex-app lint + boundary + root source tsc. NOT committed.
  Now starting F3 (approval card UI for restricted mode).
- 2026-05-28: F3 FIXED via /harness. NEW `ApprovalCard.tsx` + `ApprovalsRegion.tsx` in
  `vex-app/src/renderer/features/appShell/`; `usePendingApprovals` gains optional
  `refetchInterval`; `SessionPanel.tsx` mounts the region between transcript and composer; 3
  new jsdom tests (14 cases, incl. the SessionPanel selected-session mount assertion Codex
  required). Codex plan GREEN LIGHT (first pass; 5 impl constraints surfaced + honoured: Result.ok
  handling, bounded height, focus-once on first-new, real query keys, mount test). Final GREEN
  LIGHT. Verified: 14/14 + AppShell 30/30 (re-run by Codex), vex-app lint + root source tsc.
  NOT committed. Non-blocking follow-up: `expiresAt` countdown on the card (backend expiry is
  authoritative).
- 2026-05-28: All three found blockers (F1+F2+F3) FIXED + dual-Codex-reviewed + uncommitted.
  Per project plan, NEXT: 10-agent vex-agent deep audit → `Structure-vex-agent.md` + vex-app
  coverage gap report. Audit plan in `VEX-INDEX/audit-vex-agent-plan.md`.
- 2026-05-28: F1+F2+F3 committed and pushed to `origin/main` (3 commits: 97c2c9c F1+F2,
  0430072 F3, c138af8 docs/audit). Foundation files added afterwards: `README.md`,
  `MANIFEST.yml`, `glossary.md`, `decisions/ADR-0001-global-model-session-wallet.md`.
  Structure redesigned with Codex (new session `vex-index-design`) — front matter,
  stable IDs (CAP-/FLOW-/FINDING-/ADR-), `path:line symbol` anchors, canonical
  coverage in `audits/current/coverage-gaps.md` only, `boundaries/` folder for
  trust/IPC/env/DB contracts, `decisions/` folder for ADRs.
- 2026-05-28: ROUND 1 complete. 10 `general-purpose` agents (sonnet, parallel) wrote
  module docs for `src/vex-agent/`:
    1. engine-core (11 CAPs · 6 open Qs · dead-export candidates: runTool, effectiveRecallSeed)
    2. engine-runner (17 CAPs · abortMissionRun + retryActiveMissionRun + stopActiveMissionForEdit have no IPC handler)
    3. engine-runtime-events (14 CAPs · F5 confirmed: controlStateBus not bridged to renderer)
    4. engine-mission (4 low-risk notes · no ADR-0001 divergence)
    5. engine-wake-subagents-prompts (F2 wired confirmed · subagents disabled = intentional MVP)
    6. engine-compact (15 CAPs · Track 1/2 separation invariant documented)
    7. inference (F1 resetProvider call site confirmed · pre-claim provider gate in 2 CAPs · Track-2 chunker bypasses registry singleton — flagged)
    8. tools-internal (25 CAPs · wallet prepare/confirm split · 5 open Qs)
    9. tools-protocols (5 protocols · MUTATION_MATRIX with 27 entries · `execute_tool` actionKind override)
    10. data-memory-knowledge (schema version 027 / 24 migration files catalogued · `sessions` has NO model_id → ADR-0001 verified)
  ADR-0001 verdict across all 10 modules: zero contradictions.
  Working tree: 10 module .md files + foundation (README/MANIFEST/glossary/ADR-0001).
  NOT yet committed. Next: optional commit; Round 2 (root `src/` + flows/ + boundaries/);
  Round 3 (vex-app/ + populated coverage-gaps).
- 2026-05-28: Round 1 committed + pushed (`152af27`: `docs(vex-index): Round 1 — vex-agent
  module index (10 modules) + foundation`). 15 files, 4337 insertions.
- 2026-05-28: ROUND 2 complete. 10 `general-purpose` agents (sonnet, parallel) wrote module
  docs for root `src/` under `VEX-INDEX/modules/src-root/`:
    1. lib-vault-secrets   (vault crypto + secret keys + Polymarket credential map)
    2. lib-wallet          (wallet facade + keystore + inventory + multi-auth + signing)
    3. lib-env-config      (dotenv + agent-config + runtime-env + providers/env-resolution
                            + config/paths + config/store + utils/dotenv + chain)
    4. lib-db-utilities    (lib/db/migrate-runner + utils logger/http/validation-helpers
                            + canonicalJson/minimatch/rateLimit + errors)
    5. lib-diagnostics     (text-redaction + redactor + bug-report-sink + bug-report-schema)
    6. tools-dexscreener   (read-only)
    7. tools-khalani       (cross-chain bridge — mutating)
    8. tools-kyberswap     (aggregator + limit-order + token-api + ZaaS — mutating)
    9. tools-polymarket    (clob + bridge + data + gamma + relayer — mutating)
   10. tools-solana-jupiter-twitter (5 Jupiter sub-protocols + shared/ + twitter read-only)
  ADR-0001 verdict across Z5: zero contradictions.
  Cross-cutting findings (to consolidate into audits/current/quality-findings.md later):
   - Dead-code candidates: getSigningClient, getPublicClient, canonicalJson, minimatch,
     rateLimit, DexScreener WebSocket client (no production callsites).
   - Security: vault scrypt N=65536 < OWASP rec; keystore N=16384 4× weaker; lock doesn't
     clear env secrets; Khalani Solana raw err.message leak in VexError hint;
     KSZapRouterPermit in spender allowlist on chains where it's not deployed.
   - Test gaps: no config-dir resolver parity test (src/config/paths.ts ↔ vex-app config-dir).
   - Type-safety: parseJsonResponse casts without Zod validation.
	  Working tree: 10 new module .md + MANIFEST/PROGRESS edits. NOT yet committed.
	  Next: optional commit; Round 3 (vex-app/) + populated audits/current/coverage-gaps.md.
- 2026-05-28: Stage 1/2 verification refresh complete with 10 read-only Explore agents
  (runtime limit observed: 6 active agents at once, run as 6+4). Consolidated findings:
  `Structure.md` was stale after F1/F2/F3 shipped; migration count is schema version
  027 / 24 SQL files; bundled embeddings use llama.cpp on `127.0.0.1:55134/v1`; Z6
  security/Docker boot paths needed indexing; Z7 has 93 CH constants, 10 EV constants,
  54 VexErrorCode entries, and F5 remains real; Z8 approval UI is mounted; updater is
  placeholder-only; sync executor wiring is not found in desktop boot. Added/updated
  manifest coverage, `modules/_INDEX.md`, seeded `modules/vex-app/*`, and populated
  `audits/current/*`.
- 2026-05-28: ROUND 3 deep vex-app indexing complete. 10 `Explore` agents (sonnet,
  parallel) wrote deep module docs for `vex-app/` (~5500 new lines):
    1. main-bootstrap-lifecycle (26 CAPs · 5 open Qs)
    2. main-agent-bridge (9 CAPs · F5 confirmed: preload `engine.ts` missing `onControlState`)
    3. main-secrets-wallet-support (12 CAPs · idle-lock confirmed absent · FINDING-security-003 + 004 stand)
    4. main-database-migrations (18 CAPs · F11 sync worker location flagged · schema 027/24 confirmed)
    5. main-ipc-engine-orchestration (29 CAPs · F4 OpenRouter loadConfig-per-turn evidence · F6 legacy `RuntimeRequestResult` retained only in test scaffolds; live handlers use per-action schemas)
    6. main-docker-compose-onboarding (29 CAPs · F1 resetProvider call site verified at provider.ts:70-73 · F13 embedding port 55134 verified · $$VAR escaping correct)
    7. preload-channels-events-errors (full inventory: 92 CH, 10 EV, 54 error codes, 29 domains · 9 reserved/unbridged constants enumerated)
    8. shared-schemas-bridge-types (~71 z.object definitions, 24 bridge type files · F6 RuntimeBridge legacy declaration enumerated)
    9. renderer-appshell-runtime (24 CAPs · F3 ApprovalCard two-step confirm verified · F5 polling workaround 5000ms · F9 transcript 500-node cap)
    10. renderer-onboarding-bootstrap-secrets (21 CAPs · F1 ProviderStep → provider.ts resetProvider verified · password discipline: uncontrolled refs + pre-await clear across all steps)
  After Round 3 I also synthesized:
    - `VEX-INDEX/flows/` 6 FLOW-* docs (chat-turn, mission-start, approval-restricted, wake-resume, compaction-tracks, onboarding-config-write) with `path:line symbol` steps + invariants + failure modes.
    - `VEX-INDEX/boundaries/` 4 boundary docs (process-boundaries, ipc-contracts, env-secrets, database-contracts) consolidating cross-cutting contracts.
    - MANIFEST.yml updated: 36 modules total (10 vex-agent + 10 src-root + 6 vex-app seed + 10 vex-app deep), 6 FLOW-* entries, 4 boundary entries, 0 missing paths.
  Source snapshot: `cf05003`. Working tree: 10 new deep .md + 6 FLOW-*.md + 4 boundary-*.md + MANIFEST/_INDEX/00-PROGRESS edits.
- 2026-05-28: ROUND 4 — independent Codex re-audit + Bundle A fixes.
  Codex (session `vex-index-audit-round-4`, 5 subagents, read-only) pressure-tested the
  open findings against source + node_modules SDKs. Verdicts: F4 confirmed-bug (OpenRouter
  loadConfig per-turn, cache `/models`), F5 confirmed-bug (no preload `onControlState`),
  F6 confirmed-bug (production `RuntimeRequestResult` still imported by
  `renderer/lib/api/runtime.ts:24`), F11 confirmed-bug (sync worker unwired),
  F12 confirmed-by-design, FINDING-security-003 confirmed-bug (lock leaves env+provider),
  FINDING-security-004 confirmed-bug (keystore N=16384), FINDING-security-005 confirmed-bug
  (document_delete ungated), Track-2 chunker confirmed-by-design. NEW: FINDING-codex-001
  (wallet auto-backup omits inventory keystores), FINDING-codex-002 (`fetchJson<T>` cast
  without Zod), FINDING-codex-003 (reembed script-only — needs-more-info). Index drift caught:
  matrix 28 (not 27), sync tables `protocol_sync_jobs`/`protocol_sync_runs`, chunker `:64`,
  stale "Round 3 pending" text.
  Bundle A (top-3) implemented via `/harness`-equivalent Codex GREEN-LIGHT gating
  (session `harness-bundle-a-security`; plan BLOCKED→revised→GREEN, final review GREEN):
    - FINDING-security-005: `document_delete` → `mutating:true` (`src/vex-agent/tools/registry/documents.ts:54`);
      restricted-mode regression + census update. `document_write` deliberately stays ungated.
    - FINDING-security-003: `lockSecretSession()` now async — `scrubUnlockedRuntime()` sweeps
      `MANAGED_SECRET_ENV_KEYS` from `process.env` + `invalidateProviderCache()` awaits
      `resetProvider()`; centralized; explicit lock paths await, quit hooks fire-and-forget
      after the sync scrub; `getUnlockedSecretPresence` failure path routes through the same scrub.
    - F11: new `vex-app/src/main/agent/sync-worker.ts` + `database/sync-db.ts`; `setupSyncWorker()`
      wired in `index.ts` (no provider gate — public-address egress) + drained on quit.
  Verified: engine dispatcher+registry 65 pass/7 skip; vex-app session 17 pass; sync-worker 5 pass;
  root `tsc --noEmit` clean; `pnpm --dir vex-app lint` (tsc + boundary check) clean. NOT committed
  (awaiting explicit user request). Index refreshed: audits/Structure/README/tools-protocols/
  FLOW-compaction/data-memory + boot docs updated to fixed; new findings tracked as candidate Bundle B
  (F4, F5, F6, F10-KDF, F12, codex-001/002/003).
- 2026-05-28/29: BUNDLE B SHIPPED (3 fixes, all `/codex`-gated + pushed to main):
  - B1a (F10): keystore scrypt KDF → vault parity N=65536 + maxmem=256MiB (mirrors vault;
    fixes the latent wallet-brick — bumping N without maxmem throws on every decrypt). No
    migration (dev/"na czysto"). Commit `cadeb6f`. Codex GREEN (plan v2 + final).
  - B1b (codex-001): complete backup + symmetric archive-restore + ADD-flow hooks, implemented
    as 3 sequenced Codex-gated checkpoints — C1 root primitive `a35d4f4`, C2 vex-app IPC
    `6a1f7ab`, C3 renderer screen `53f1266`. Design+adversarial workflow (5 design + 3 skeptics,
    38 guards) → Codex plan v3 (3 hardening rounds) → per-checkpoint final reviews (C1 ×3, C2 ×3,
    C3 ×2). autoBackup now captures the full wallet surface (legacy + per-id keystores + vault +
    .env + config, manifest v2); `backup-restore.ts restoreFromBackupArchive` recovers it with
    fail-closed validation (realpath/symlink/manifest-1:1/dup-address/signer-mismatch/canonical
    vault filename), staged journaled commit + rollback, mandatory pre-restore snapshot
    (retention-protected), `.env` sanitize, role-based vault refresh. IPC `walletListBackups`/
    `walletRestoreArchive` (metadata-only, opaque id) + renderer restore panel. New error codes:
    wallet.signer_mismatch, validation.archive_incomplete, validation.archive_manifest_malformed.
  - Earlier in Bundle A this session: F-S5 document_delete gate, F-S3 lock secret scrub, F11 sync
    worker (commits 823d2b6/9410be6). Index refreshed for each.
  Tooling note: B1b used the dynamic Workflow tool for design+adversarial verification (the
  resumed run recovered from a synth-agent StructuredOutput failure by re-running synthesis
  schema-less). Implementation delegated to Opus subagents per checkpoint; main agent reviewed
  diffs + re-ran tests independently + drove the Codex gates.
- 2026-05-29: BUNDLE B — F5 + F6 SHIPPED (runtime bridge; `/codex`-gated, NOT yet committed).
  - F5 (controlState preload bridge): preload `engine.ts` adds `onControlState` (+ `EngineEventsBridge`
    type), re-validating via `controlStateEventSchema` at the third layer. New renderer hook
    `useControlStateLiveSync(sessionId)` (`renderer/lib/api/runtime.ts`), mounted in `SessionPanel`,
    pushes invalidation of `runtimeKeys.state` + `approvalsKeys.pending` per event with a 30s
    runtime-state fallback. `ApprovalsRegion` KEEPS its 5s poll as a fast fallback — Codex caught that
    the controlState emit is post-commit on lease release (not in the approval txn) and can be missed,
    so dropping the poll would regress F3 unblock latency to 30s.
  - F6 (RuntimeRequestResult drift): `RuntimeBridge` + the 4 renderer mutation hooks retyped to the
    per-action discriminated unions; legacy `runtimeRequestResultSchema`/`RuntimeRequestResult` alias
    DELETED from `shared/schemas/runtime.ts` (+ its legacy test). Preload unchanged — `satisfies
    RuntimeBridge` re-infers `T`. Stale "feature_unavailable until puzzle 03" docstrings corrected
    (handlers are live DB-backed).
  Process: 5-agent Explore recon (pointed at VEX-INDEX) → plan → Codex named session `f5f6-harness`
  (RED→GREEN: required keeping the 5s approvals fallback) → inline implement → `pnpm --dir vex-app lint`
  (tsc + boundaries) clean + focused vitest 70 pass (incl. new `renderer/lib/api/__tests__/runtime.test.ts`,
  6) → Codex final review GREEN LIGHT. Index refresh: parallel doc-sweep workflow (10 files) +
  coverage-gaps/Structure/boundaries/flows/00-PROGRESS by hand. NOT committed (awaiting explicit user
  request). STILL OPEN (Bundle B remainder): F4 (OpenRouter /models per-turn cache), F10-KDF-OWASP
  (joint vault+keystore bump to 2^17), F12 (updater), codex-002 (fetchJson Zod),
  codex-003 (reembed runtime trigger).
