# Fix Plan — F1: "Model not configured" / "No inference provider"

Harness session: `harness-integration-blockers`. Status: awaiting Codex plan GREEN LIGHT.

## Goal
Make non-secret runtime config in `${CONFIG_DIR}/.env` (`AGENT_MODEL`, `AGENT_PROVIDER`,
`AGENT_CONTEXT_LIMIT`, `AGENT_MAX_OUTPUT_TOKENS`, `AGENT_TEMPERATURE`, `EMBEDDING_*`, `SUBAGENT_*`)
actually reach `process.env` in the Electron app, so the global model resolves and the model
badge / context meter / engine inference work after onboarding — on a fresh wizard run AND after
restart. Confirmed root cause: vex-app never loads `.env` into `process.env` (see
`Deep-F1-model-provider-bug.md`).

## Rules/skills read
- CLAUDE.md + `.claude/rules/{00,10,20,30,60,70,80}` (in context).
- `vex-master-router` → routed to `vex-process-boundaries` (env injection belongs in MAIN; renderer
  untrusted) and `vex-provider-hot-wallet` (secret handling — confirms this fix touches only
  NON-secret config; vault secrets stay vault-only).

## Files/patterns inspected
- `vex-app/src/main/index.ts` (boot order; no dotenv load present).
- `src/providers/env-resolution.ts` `loadProviderDotenv()` — loads `.env` skipping
  `isManagedSecretEnvKey` (master pw + all `VAULT_SECRET_KEYS`).
- `src/utils/dotenv.ts` `loadDotenvFileIntoProcess` — **load-if-undefined** (`:46`), missing-file safe.
- `src/lib/secret-keys.ts` `MANAGED_SECRET_ENV_KEYS`.
- `vex-app/src/main/secrets/session.ts` `applyUnlockedRuntime` (vault→env only).
- `vex-app/src/main/onboarding/provider-writer.ts` (writes AGENT_MODEL/PROVIDER to `.env` file only).
- `vex-app/src/main/ipc/onboarding/provider.ts` + `onboarding/env-write-mutex.ts` (serializer).
- vex-app main aliases: `@vex-lib,@vex-agent,@tools,@utils,@config` (NO `@providers`).

## Current state
`.env` written correctly by onboarding; `process.env` never populated from it. Vault unlock injects
only `VAULT_SECRET_KEYS`. So `AGENT_MODEL` is undefined → `OpenRouterProvider` ctor throws → provider
null → "No inference provider"; and `sessions.getModel` → `unconfigured` → "Model not configured".

## Directions considered
- **A (chosen)**: vex-app MAIN loads `.env` into `process.env`.
  - Boot: `loadProviderDotenv()` early in `whenReady` (load-if-undefined → shell/env precedence kept).
  - Same-session after a non-secret config write: `loadProviderDotenv({ overwrite: true })` so a
    freshly written/reconfigured value goes live without restart. Requires a small, backward-compatible
    `overwrite?: boolean` on `loadDotenvFileIntoProcess` (default false → zero change for existing
    callers incl. CLI scripts).
  - Reach it from main via a `src/lib` re-export facade (`@vex-lib/runtime-env.js`) — established
    pattern; avoids adding a build alias.
- **B (rejected)**: engine loads `.env` itself inside `loadEnvConfig`. Rejected: engine is shared with
  vex-shell/CLI and must stay a pure `process.env` reader; file-loading inside the engine couples it
  to FS layout, risks double-load, and violates "main owns env/config injection" (process-boundaries).
- **C (sub-variant)**: write keys directly to `process.env` inside each writer (no reload). Simpler but
  spreads "which keys" knowledge across writers and doesn't generalize to all non-secret keys. Folded
  into A via the overwrite reload instead.

## Implementation steps (smallest safe change)
1. `src/utils/dotenv.ts`: add `overwrite?: boolean` to `LoadDotenvOptions`; line 46 →
   `if (!options.overwrite && process.env[key] !== undefined) continue;`. Default false.
2. `src/providers/env-resolution.ts`: `loadProviderDotenv(options: { overwrite?: boolean } = {})` →
   pass `overwrite` through (keep `shouldLoadKey` skip-managed-secrets).
3. `src/lib/runtime-env.ts` (new): `export { loadProviderDotenv } from "../providers/env-resolution.js";`.
4. `vex-app/src/main/index.ts`: early in `whenReady` (before `registerAllIpcHandlers` / compact worker),
   `loadProviderDotenv()` + a redaction-safe log line ("loaded non-secret runtime env").
5. `vex-app/src/main/ipc/onboarding/provider.ts`: after `writeProvider` succeeds: reload env, THEN
   reset the engine provider cache so the new model takes effect same-session:
   - inside the `withEnvWriteLock` callback → `loadProviderDotenv({ overwrite: true })`;
   - then `resetProvider()` via dynamic `import("@vex-agent/inference/registry.js")` — bumps the
     generation + clears the cached `OpenRouterProvider` so the next `resolveProvider()` rebuilds
     with the new model. **Codex round-1 catch**: reload alone refreshes badge reads but a cached
     provider keeps the OLD model on reconfigure.
   - Order: verify → writeProvider → loadProviderDotenv({overwrite:true}) → resetProvider().

Out of scope (note, not fixing now): same-session liveness for agent-core/embedding writers (context
limit, embedding) — boot-load already makes them correct on next launch; not the reported symptom.
Will reassess after F1 lands.

## Verification plan
- dotenv test: `overwrite:true` loads non-secret keys but STILL skips `OPENROUTER_API_KEY` /
  `MANAGED_SECRET_ENV_KEYS` present in .env.
- `provider.test.ts`: SUCCESS path asserts `loadProviderDotenv({overwrite:true})` AND `resetProvider()`
  called (in order) after a successful persist; FAILURE paths (verify fails; write fails) assert
  NEITHER reload NOR reset happens.
- `pnpm --dir vex-app lint` (tsc --noEmit) + root `tsc` for the `src/` edits.
- Manual: (1) fresh onboarding → session shows model + submit works; (2) restart, vault locked →
  unlock → model present; (3) reconfigure model in settings → engine uses NEW model without restart
  (proves resetProvider).

## Risks / mitigations
- **Secret leakage**: none — `loadProviderDotenv` skips `MANAGED_SECRET_ENV_KEYS`; `OPENROUTER_API_KEY`
  stays vault-only. Verified via `isManagedSecretEnvKey`.
- **Clobbering shell/test env at boot**: avoided — boot uses overwrite=false; only the explicit
  post-write path uses overwrite=true (user just changed it; .env is authoritative).
- **Shared util change**: `overwrite` defaults false → existing callers (CLI scripts, boot) unchanged.
- **Ordering vs vault unlock**: independent — managed secrets are skipped, so order doesn't matter.

## Open questions
- None blocking.

## Codex review log
- Round 1: **BLOCKED** — must `resetProvider()` after the overwrite reload (cached provider goes
  stale on reconfigure). Incorporated into step 5 + verification. Confirmed: keep
  `@vex-lib/runtime-env.js` facade; defer agent-core/embedding per-writer reload (provider is the
  last wizard config step; loader doesn't unset removed keys). Re-submitted for GREEN LIGHT.
