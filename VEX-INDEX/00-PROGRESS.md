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
| 1 | Index the repo — what's where, per-file purpose, cross-zone links | `VEX-INDEX/Structure.md` | ✅ DONE (8 indexers) |
| 2 | Functionality map — every workflow/module in vex-agent & vex-app, how they relate | folded into `Structure.md` §INTEGRATION WIRING MAP | ✅ largely covered |
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
