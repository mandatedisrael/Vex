---
id: ADR-0001-global-model-session-wallet
kind: decision
status: accepted
date: 2026-05-27
deciders: [product-owner, lead-dev]
supersedes: []
superseded_by: null
related: [index.structure, module.vex-agent.inference, audit.current.coverage-gaps]
---

# ADR-0001 — Global model, per-session wallet

## Status

**Accepted** (2026-05-27, restated and confirmed by the product owner during the F1–F3 audit).

## Context

The earlier `agents_dm/plan-integration/` plan (notably `06-model-context-usage.md` and the
README) proposes a **per-session model** with `sessions.model_id` (NULL = global default).
The engine, however, ALREADY uses a **global** provider config from env (`resolveProvider()` +
`provider.loadConfig()` over `AGENT_PROVIDER` + `AGENT_MODEL` + `OPENROUTER_API_KEY`).

Wallets, in contrast, were intentionally made **per-session** in migration 026 — `sessions`
gained `selected_evm_wallet_id`/`selected_evm_wallet_address` + Solana equivalents. Selection
is immutable post-creation.

## Decision

1. **Model is GLOBAL.** Configured once in onboarding (`AGENT_MODEL` in `.env` +
   `OPENROUTER_API_KEY` in the vault). Applied to every session. Billing is central.
   **There is no per-session model selection.**

2. **Wallets are PER-SESSION.** Each session picks its EVM and/or Solana wallet at creation,
   persisted on the `sessions` row. Selection is immutable post-creation.

3. **All secrets** are encrypted under a master password (AES-256-GCM + scrypt). Vault
   unlock injects vault secrets into `process.env`. Non-secret `.env` config is loaded
   separately on app boot + post-onboarding (F1, commit `97c2c9c`).

## Consequences

- Plan docs proposing per-session model are **superseded**; their `sessions.model_id`
  proposal is not implemented.
- Any future code introducing a per-session model column or picker is a **candidate
  divergence** — flag in `audits/current/coverage-gaps.md`.
- F1 ("Model not configured" / "No inference provider") was caused by the main process
  never loading `.env` into `process.env`, NOT by missing per-session-model implementation.
  Fixed in commit `97c2c9c`.
- A capability marked "per-session model" in coverage audits is **intentionally absent**, not
  a gap. Coverage audits should flag attempted per-session-model implementations as
  divergences instead.

## Counter-arguments / risks

- If different sessions need different inference economics (e.g. a cheap model for trivial
  chat and a flagship for mission planning), the global model is limiting.
  - **Mitigation**: revisit when usage data justifies. Until then, global is simpler and
    consistent with the current engine.

## Refresh triggers

This ADR is stale if either:

- The product decision changes (model becomes per-session), or
- The engine adds a per-session model code path that overrides env defaults, or
- A new column on `sessions` for model selection is added in a migration.

Watch paths: `src/vex-agent/inference/registry.ts`, `src/vex-agent/inference/config.ts`,
`src/vex-agent/db/migrations/**`, `vex-app/src/main/ipc/sessions/get-model.ts`,
`vex-app/src/main/ipc/models.ts`.
