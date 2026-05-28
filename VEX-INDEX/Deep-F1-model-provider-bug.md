# Deep-F1 — "Model not configured" / "No inference provider" — ROOT CAUSE CONFIRMED

Status: **CONFIRMED** (2026-05-27). Severity: **blocker** (chat + missions unusable). Risk of fix: **low**.

## Symptom (Screenshot_1.jpg)
Header chip "Model not configured" + `0%` context bar; composer red error
"No inference provider is available. Unlock Vex or complete provider setup, then retry." —
despite onboarding completed. Session AGENT/FULL, "Connected to local runtime".

## Root cause (single, confirmed)
**The vex-app main process never loads `${CONFIG_DIR}/.env` into `process.env`.**
Non-secret runtime config (`AGENT_MODEL`, `AGENT_PROVIDER`, `AGENT_CONTEXT_LIMIT`,
`AGENT_MAX_OUTPUT_TOKENS`, `AGENT_TEMPERATURE`, `EMBEDDING_*`, `SUBAGENT_*`) is **written to
the `.env` file** by onboarding writers but is **never read back into `process.env`**. Only
vault secrets reach `process.env` (via unlock). So the model is "unconfigured" from the
app/engine's perspective even though setup wrote everything correctly to disk.

## Evidence chain (file:line)
1. `vex-app/src/main/onboarding/provider-writer.ts` `writeProvider` — vault-writes
   `OPENROUTER_API_KEY`; `.env`-writes `AGENT_MODEL` + `AGENT_PROVIDER=openrouter` via
   `appendMultipleToDotenvFile` (FILE only — does **not** set `process.env`).
2. `vex-app/src/main/secrets/session.ts:74` `applyUnlockedRuntime` → only
   `applySecretVaultToProcessEnv(...)` (+ delete master pw).
3. `src/lib/local-secret-vault.ts:333` `applySecretVaultToProcessEnv` — loops **only**
   `VAULT_SECRET_KEYS`; sets/deletes those in `process.env`. Never touches `.env` file values.
4. Repo-wide: callers of `loadDotenvFileIntoProcess`/`loadProviderDotenv` =
   `src/vex-agent/scripts/{tool-embeddings-health,tool-reembed}.ts` only. **Zero callers in
   `vex-app/`.** `vex-app/src/main/onboarding/embedding-state.ts:6` has a comment *claiming*
   `process.env` is "populated from .env via loadDotenvFileIntoProcess" — the call does not exist.
5. `src/vex-agent/inference/config.ts:52-70` `loadEnvConfig` reads `process.env.AGENT_PROVIDER`,
   `OPENROUTER_API_KEY`, `AGENT_MODEL` directly (no dotenv load). `agentModel` → `null`.
6. `src/vex-agent/inference/openrouter.ts:64-70` ctor throws "AGENT_MODEL is required" when null →
   `registry.ts:41` `doResolve` catch → `resolveProvider()` returns null →
   `engine/core/runner/agent.ts:37` throws "No inference provider available" →
   `vex-app/src/main/ipc/chat.ts:43,75` `classifyEngineError` → `provider.unavailable` message.
7. `vex-app/src/main/ipc/sessions/get-model.ts:29-30` + `ipc/models.ts:33-34` read
   `process.env.AGENT_MODEL` → undefined → `source:"unconfigured"` → renderer
   `SessionRuntimeBar.tsx:109/112` "Model not configured" chip.

## Why it reproduces in BOTH scenarios
- **Right after onboarding**: writer put `AGENT_MODEL` in `.env` file, not `process.env`. App
  never reloads `.env`. → undefined.
- **After restart (vault locked)**: `.env` still not loaded; OPENROUTER_API_KEY also absent until
  unlock. Both missing.
- Context bar still shows `0%` (not crash) because `parseAgentEnv` returns the default
  `AGENT_CONTEXT_LIMIT` when the key is absent.

## Fix path (NOT YET APPLIED — verification phase)
The infrastructure already exists and was designed for this; only the call site is missing:
- `src/providers/env-resolution.ts:37` `loadProviderDotenv()` already loads `ENV_FILE` while
  **skipping managed secret keys** (so it will NOT clobber vault-injected `OPENROUTER_API_KEY`).
- **Proposed**: call `loadProviderDotenv()` (exposed to vex-app via `@vex-lib`/`@config` or a thin
  bridge) **early in `vex-app/src/main/index.ts` boot** (before first engine dispatch / before the
  compact worker reads config), AND re-call it after the agent-core / embedding / provider
  onboarding writers run (so a freshly-written model is visible without restart).
- Ordering invariant: vault unlock (`applySecretVaultToProcessEnv`) sets managed secrets;
  `loadProviderDotenv` skips managed keys → safe in either order. Verify `loadProviderDotenv`'s
  skip-list == `MANAGED_SECRET_ENV_KEYS`.

## Risks / cautions
- Security-adjacent (provider/secret env). Must NOT load managed secrets from `.env` into env
  (they shouldn't be there — `stripManagedSecretsFromDotenvFile` removes them — but the loader's
  skip-list must be confirmed).
- `loadProviderDotenv` must not OVERWRITE an already-unlocked vault secret in env. Confirm it skips.
- `@vex-lib` boundary: `loadProviderDotenv` lives in `src/providers/` (not `src/lib/`); needs a
  bridge or move to be importable by vex-app main without dragging Node-only deps into renderer.
  Alternatively call `loadDotenvFileIntoProcess(ENV_FILE, { skip: MANAGED_SECRET_ENV_KEYS })`.

## Verification after fix (focused)
- Unit: a main-boot test asserting `process.env.AGENT_MODEL` is set after `.env` exists.
- Integration: `sessions.getModel` returns `source:"global_default"` post-onboarding without unlock
  for the non-secret model fields; chat submit reaches the engine and fails only if API key absent.
- Manual: complete onboarding → open session → model badge shows model, no "not configured".
