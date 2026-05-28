---
id: index.glossary
kind: glossary
indexed_at: 2026-05-28
---

# Glossary

Project-specific terms used across the Vex codebase. Aliases included
liberally — this file is a retrieval hub for future LLMs that may guess.

## Core domain

- **Session**: a chat or mission context, persisted in Postgres (`sessions` table). One user
  "thread" of conversation/work.
- **Mode**: `agent | mission`. Immutable per session (DB CHECK constraint).
- **Permission**: `restricted | full`. Immutable per session.
- **Mission**: an autonomous session with a contract. Backed by `missions` + `mission_runs`.
- **Run / mission run**: a single execution of a mission contract. Status lifecycle:
  `running → paused_{approval,wake,error,user} → completed | failed | stopped | cancelled`.
- **Restricted mode**: mutating tool calls require user approval (`paused_approval`).
  Aliases: "approval-gated".
- **Full / FULL permission**: agent executes mutating tools without per-call approval.
  Aliases: "no-approval", "unrestricted".

## Runtime

- **Engine**: `src/vex-agent/` — the canonical runtime backend (turn loop, runners, inference,
  tools, mission, wake, compaction).
- **Turn**: one round-trip with the LLM provider (build prompt → infer → emit stream deltas →
  save assistant message → maybe dispatch tools).
- **Run lifecycle**: lease claim → status flip → tick(s) → release. Atomic via
  `claimRunLeaseAndFlipToRunning` + `observeAndApplyControl`.
- **Lease**: a runtime ownership claim in `runner_leases` (heartbeated). Prevents two callers
  from running the same session/run.
- **Defer / `loop_defer`**: the agent's "sleep" tool — writes a `loop_wake_requests` row + an
  engine signal. Aliases: "sleep", "wake schedule".
- **Wake**: the executor (`startWakeExecutor`) that resumes deferred mission runs at their `dueAt`.
- **Compaction**: shrinking the live transcript to a rolling summary + archived prefix. Two
  tracks: Track 1 (sync, in-turn) + Track 2 (async chunker → `session_memories`).
  Aliases: "summarization".
- **Checkpoint**: a saved point for `/rewind` (archive suffix + `rewind_checkpoint` row).
- **Approval**: a request for user permission to dispatch a mutating tool. Backed by
  `approval_queue` + `approval_intents` (puzzle-5 phase-3).
- **Approval intent**: companion row to an approval queue entry with `action_kind`,
  `risk_level`, `preview_json`, `decision`, `execution_status` (migration 024).
- **Action kind** (`approval_intents.action_kind`): `read | local_write | schedule |
  approval_prepare | user_wallet_broadcast | external_post | destructive`.
- **Risk level**: `info | low | medium | high | critical`.

## Inference

- **Provider**: the LLM provider (currently only `openrouter`). Resolved via `resolveProvider`
  from env (`AGENT_PROVIDER`, `OPENROUTER_API_KEY`).
- **Model**: **GLOBAL** — one model for all sessions (see `ADR-0001-global-model-session-wallet`).
  Configured in onboarding (`AGENT_MODEL` in `.env`). No per-session model.
- **`AGENT_*` env vars** (non-secret, in `.env`): `AGENT_MODEL`, `AGENT_PROVIDER`,
  `AGENT_CONTEXT_LIMIT`, `AGENT_MAX_OUTPUT_TOKENS`, `AGENT_TEMPERATURE`.
- **`SUBAGENT_*` env vars**: fallback to `AGENT_*` if unset. Subagent inference defaults.

## Secrets / config

- **Vault**: `secrets.vault.json` — AES-256-GCM + scrypt-derived key from master password.
  Holds `VAULT_SECRET_KEYS`: `OPENROUTER_API_KEY`, Jupiter/Tavily/Rettiwt/Polymarket keys,
  per-wallet CLOB credentials. Decrypted to `process.env` on `vex:secrets:unlock`.
- **Master password**: kept only in memory after unlock. Env var name:
  `VEX_KEYSTORE_PASSWORD` (= `MASTER_PASSWORD_ENV_KEY`).
- **`.env`**: NON-secret runtime config. F1 fix (commit 97c2c9c): vex-app main loads it into
  `process.env` on boot + post-onboarding overwrite-reload.
- **`config.json`**: public wallet addresses, RPCs, service URLs. No secrets, no private keys.
- **Keystore** (`keystore.json` EVM + `solana-keystore.json` Solana): user-wallet hot keys,
  AES-256-GCM + scrypt N=16384 (weaker than vault; flagged).
- **Wallet**: user-created hot wallet (EVM or Solana). **Per-session selection** (see
  `ADR-0001`) via `sessions.selected_evm_wallet_id/address` + Solana equivalents (mig 026).

## Architecture

- **`vex-app/src/main`**: privileged Electron main process. Owns DB, Docker, vault, wallet,
  IPC handlers, engine bridge.
- **`vex-app/src/preload`**: typed bridge. Exposes `window.vex.*` to renderer; never raw
  `ipcRenderer`.
- **`vex-app/src/renderer`**: UNTRUSTED UI. React 19 + Vite + Tailwind + TanStack + Zustand.
  No direct DB/Docker/wallet/engine access.
- **`vex-app/src/shared`**: cross-process schemas, channels, error union, bridge types.
- **`src/vex-agent`**: the engine. Loaded in main via dynamic `await import("@vex-agent/...")`.
- **`src/lib`**: shared lib for vex-app via `@vex-lib` alias (wallet, vault, env helpers,
  runtime-env added in F1).
- **`src/tools`, `src/providers`, `src/config`**: root utilities consumed by vex-agent (and
  partly by vex-app via aliases).

## IPC

- **Channel format**: `vex:<domain>:<action>` (request), `vex:event:<domain>:<topic>` (event),
  `vex:stream:<domain>:<topic>` (stream), `vex:cancel` (cancellation).
- **VexDomain**: closed enum (29 domains) in `vex-app/src/shared/ipc/result.ts`.
- **VexErrorCode**: closed enum (~52 codes) paired with VexDomain for typed errors.
- **Result**: `{ok:true, data} | {ok:false, error}` envelope on every IPC call.

## Aliases (build/tsconfig)

- `@vex-lib/*` → `src/lib/*` (vex-app main + renderer; renderer restricted to pure modules).
- `@vex-agent/*` → `src/vex-agent/*` (vex-app main only; not renderer).
- `@tools/*`, `@utils/*`, `@config/*` → `src/tools|utils|config`.
- `@shared/*` → `vex-app/src/shared/*` (vex-app only).

## Stage-1 zones (mnemonic)

From `Structure.md`. Use when reading or referencing modules.

| Zone | Path scope |
|------|------------|
| Z1 | `src/vex-agent/engine/{core,events,runtime,checkpoint,support}` |
| Z2 | `src/vex-agent/engine/{mission,wake,subagents,prompts,compact-jobs}` |
| Z3 | `src/vex-agent/{inference,tools}` |
| Z4 | `src/vex-agent/{db,memory,knowledge,sync,embeddings,scripts,public}` |
| Z5 | `src/{tools,lib,providers,config,constants,utils}` (root, excl. vex-agent + tests) |
| Z6 | `vex-app/src/main` |
| Z7 | `vex-app/src/{preload,shared}` |
| Z8 | `vex-app/src/renderer` |

## Status tokens

Used in MANIFEST and audit docs.

- **Doc status**: `pending | round-1-in-progress | landed | superseded | stale`.
- **Finding status**: `open | fixed | superseded | wontfix`.
- **Coverage cell**: `✅ implemented | ⚠ partial | ⛔ missing | n/a`.
