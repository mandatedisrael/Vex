---
id: module.vex-agent.inference
kind: module
paths:
  - "src/vex-agent/inference/**"
source_commit: dee0d08
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/vex-agent/inference/**"
  - "src/lib/agent-config.ts"
  - "src/providers/env-resolution.ts"
  - "src/utils/dotenv.ts"
  - "vex-app/src/main/ipc/onboarding/provider.ts"
  - "src/vex-agent/db/migrations/**"
related:
  - module.vex-agent.engine-runner
  - module.vex-agent.engine-core
  - module.vex-agent.tools-internal
  - module.vex-agent.engine-compact
  - ADR-0001-global-model-session-wallet
  - fix-plan.F1
---

# vex-agent / inference

## Purpose

Single-provider inference layer for all agent turns. Resolves and caches a
GLOBAL `InferenceProvider` singleton (currently OpenRouter only) from
`process.env`; exposes streaming + non-streaming completions, tool-schema
normalization, and retry/timeout utilities. The provider is global — one
model for all sessions — per ADR-0001. No per-session model selection exists
here or anywhere in the engine.

## Retrieval keywords

- inference, provider, OpenRouter, LLM, model, streaming, stream consumer
- resolveProvider, resetProvider, runStreamingInference, loadEnvConfig, loadConfig
- OpenRouterProvider, AGENT_MODEL, OPENROUTER_API_KEY, AGENT_PROVIDER
- tool schema, schema normalizer, strict mode, stream consumer, resilience, retry
- chunker, compact Track 2, wake executor provider gate

## State owned

### Environment variables (read from `process.env`)

| Variable | Role | Required |
|---|---|---|
| `OPENROUTER_API_KEY` | Secret API key (vault-injected via `applySecretVaultToProcessEnv`) | Yes |
| `AGENT_MODEL` | Model ID, e.g. `anthropic/claude-sonnet-4` (loaded from `.env` via F1 fix) | Yes |
| `AGENT_PROVIDER` | Explicit provider override; defaults to auto-detect via key presence | No |
| `AGENT_CONTEXT_LIMIT` | Context window token limit | No (has default) |
| `AGENT_MAX_OUTPUT_TOKENS` | Max output tokens per response | No (has default) |
| `AGENT_TEMPERATURE` | Sampling temperature | No (nullable) |
| `SUBAGENT_*` | Subagent overrides; fall back silently to `AGENT_*` defaults if invalid | No |

**Load path (F1 fix, commit `97c2c9c`)**:
- Non-secret vars (`AGENT_*`, `SUBAGENT_*`): loaded from `${CONFIG_DIR}/.env`
  by `loadProviderDotenv()` called in `vex-app/src/main/index.ts` (boot) and
  via `loadProviderDotenv({ overwrite: true })` post-`writeProvider` in
  `vex-app/src/main/ipc/onboarding/provider.ts`.
- `OPENROUTER_API_KEY`: vault-only; injected by `applySecretVaultToProcessEnv`
  on `vex:secrets:unlock`. Never loaded from `.env`.

### In-process singleton cache

Three module-level variables in `src/vex-agent/inference/registry.ts`:
- `cachedProvider: InferenceProvider | null` — the live resolved provider.
- `generation: number` — monotonic invalidation token, bumped by `resetProvider()`.
- `inFlight: { gen, promise } | null` — dedup promise for parallel first-resolve calls.

No DB state. No Zustand. No filesystem writes.

## Boundary crossings

- **Network (OpenRouter API)**: `loadConfig()` calls `client.models.list({})` on every
  turn (see FINDING note under Open questions — F4). `chatCompletionStream` / `chatCompletion`
  / `chatCompletionSimple` send completion requests. `getBalance()` calls
  `/credits` or `/keys/current` endpoints.
- **`process.env` (read)**: all config reads are `process.env.*` at call time;
  no file IO inside this module. Env is injected externally (Z5 / Z6).
- **SDK**: `@openrouter/sdk` — `OpenRouter` client with backoff retry config and
  5-minute timeout baked in at construction. Streaming uses `EventStream<ChatStreamChunk>`.
- **AbortSignal (9-5a)**: `chatCompletionStream` and `runStreamingInference` both accept
  an optional `signal` for chat-turn stop. Pre-aborted signal short-circuits before any
  HTTP call; mid-stream abort returns a partial `InferenceResponse` with `aborted: true`.

## File map

- `src/vex-agent/inference/config.ts:52 loadEnvConfig` — reads + validates all `AGENT_*`
  env vars; throws with aggregated error on invalid numeric ranges. Re-exports
  `AGENT_CONTEXT_LIMIT`, `AGENT_MAX_OUTPUT_TOKENS`, `AGENT_TEMPERATURE` from
  `src/lib/agent-config.ts`. Exports internal constants: `INFERENCE_TIMEOUT_MS` (300s),
  `INFERENCE_SIMPLE_TIMEOUT_MS` (120s), `OPENROUTER_SDK_TIMEOUT_MS` (300s),
  `INFERENCE_MAX_RETRIES` (2), `INFERENCE_BASE_DELAY_MS` (2000),
  `INFERENCE_MAX_DELAY_MS` (15000), `OPENROUTER_LOW_BALANCE_USD` (5.0),
  `OPENROUTER_APP_URL`, `OPENROUTER_APP_TITLE`.
- `src/vex-agent/inference/config.ts:114 loadSubagentConfig` — parses `SUBAGENT_*` with
  fallback to agent config; logs warn on invalid values (no throw — engine contract).
- `src/vex-agent/inference/types.ts:183 InferenceProvider` — provider interface:
  `loadConfig → InferenceConfig | null`, `chatCompletion`, `chatCompletionSimple`,
  `chatCompletionStream`, `getBalance`, `calculateCost`. No session-scoped fields.
- `src/vex-agent/inference/registry.ts:100 resolveProvider` — global singleton resolver.
  Concurrency-safe dedup via `inFlight`. Returns `null` if no key/provider in env (not cached).
  Logs `inference.registry.none_configured` with `{hint: "Set OPENROUTER_API_KEY and AGENT_MODEL"}`.
- `src/vex-agent/inference/registry.ts:134 resetProvider` — bumps `generation`, clears
  `cachedProvider` and `inFlight`. Called by (a) `switchProvider` in-process and (b)
  Z6 `vex-app/src/main/ipc/onboarding/provider.ts` via dynamic import after writing
  new config (F1 fix — ensures next `resolveProvider` rebuilds with new model/key).
- `src/vex-agent/inference/registry.ts:121 getActiveProvider` — synchronous read of
  cached provider; returns null before first resolve.
- `src/vex-agent/inference/registry.ts:149 switchProvider` — sets `AGENT_PROVIDER`
  in `process.env`, resets, re-resolves. Only current valid argument: `"openrouter"`.
- `src/vex-agent/inference/openrouter.ts:52 OpenRouterProvider` — sole `InferenceProvider`
  implementation. Constructor calls `loadEnvConfig()` and throws if `OPENROUTER_API_KEY`
  or `AGENT_MODEL` is absent. SDK client built in constructor with backoff retry config.
- `src/vex-agent/inference/openrouter.ts:98 OpenRouterProvider.loadConfig` — fetches
  `client.models.list({})` on EVERY CALL to resolve pricing. Returns `null` on
  `model_not_found` (model absent from OpenRouter catalog) or `api_unreachable`
  (network failure). **Called once per turn by all engine entry points** — see F4 note.
- `src/vex-agent/inference/openrouter.ts:162 OpenRouterProvider.chatCompletion` — non-streaming
  with tools; used by tool-calling round-trips and as the `bufferedFallback` path in the
  stream consumer.
- `src/vex-agent/inference/openrouter.ts:184 OpenRouterProvider.chatCompletionSimple` — no tools;
  used by Track 2 compaction chunker (`callChunkerLLM`).
- `src/vex-agent/inference/openrouter.ts:209 OpenRouterProvider.chatCompletionStream` — streaming
  with `AbortSignal` support (Stage 9-5a). Accumulates `tool_call_delta` by index;
  yields `content | tool_call_delta | reasoning | usage | error | done` chunks.
- `src/vex-agent/inference/openrouter.ts:284 OpenRouterProvider.getBalance` — two-fallback
  balance fetch: management-key endpoint (`/credits`) first, then inference-key
  metadata (`/keys/current`). Returns `null` if neither works or no limit set.
- `src/vex-agent/inference/openrouter.ts:333 OpenRouterProvider.calculateCost` — pure cost
  calculation from `InferenceUsage + InferenceConfig`; accounts for cache savings and
  reasoning premium.
- `src/vex-agent/inference/stream-consumer.ts:137 runStreamingInference` — consumes the
  provider's `AsyncGenerator<StreamChunk>`. Fallback policy: before first chunk →
  `bufferedFallback`; after first chunk → rethrow; abort (signal or SDK throw) →
  partial response with `aborted: true`. Returns `StreamingInferenceResult`
  `{ response, aborted, usageObserved }`. Pre-aborted signal short-circuits to empty
  partial without any HTTP call.
- `src/vex-agent/inference/schema-normalizer.ts:39 normalizeToolSchemaForProvider` — pure
  idempotent tool schema transform: injects `items:{type:"string"}` on bare arrays;
  injects `additionalProperties:false` on objects with `properties`. Called by
  `buildOpenRouterParams` for every request.
- `src/vex-agent/inference/resilience.ts:21 retryWithBackoff` — generic exponential backoff
  retry with optional jitter and per-error `shouldRetry` gate.
- `src/vex-agent/inference/resilience.ts:63 withTimeout` — race a promise against a deadline;
  cleans up timer on resolution.
- `src/vex-agent/inference/resilience.ts:91 isRetryableError` — classifies transport/5xx/429
  as retryable; `AbortError` and 4xx (except 429) as non-retryable.
- `src/vex-agent/inference/openrouter/errors.ts:59 normalizeOpenRouterError` — converts raw
  SDK errors (status, code, provider message, metadata) into structured `Error` messages
  for engine logging.
- `src/vex-agent/inference/openrouter/mappers.ts:25 mapMessages` — converts `ProviderMessage[]`
  to SDK `ChatRequest["messages"]`, then calls `synthesizeMissingToolResults` as a
  defence-in-depth guard.
- `src/vex-agent/inference/openrouter/mappers.ts:68 synthesizeMissingToolResults` — inserts
  placeholder `tool` messages for any `assistant{tool_calls}` not followed by matching
  tool result rows. Idempotent. Logs `inference.openrouter.mapper_repair` with inserted count.
- `src/vex-agent/inference/openrouter/mappers.ts:119 extractUsage` — extracts
  `InferenceUsage` from raw SDK usage object, including `cachedTokens` and `reasoningTokens`.
- `src/vex-agent/inference/openrouter/mappers.ts:129 parseNonStreamingResponse` — converts
  `ChatResult` to `InferenceResponse`; handles tool-call and text paths; logs malformed args.
- `src/vex-agent/inference/openrouter/mappers.ts:174 processToolCallDelta` — generator;
  accumulates streaming tool call deltas by `index` into an `id/name/argsBuffer` entry
  and yields a `StreamChunk` per delta.
- `src/vex-agent/inference/openrouter/params.ts:10 buildOpenRouterParams` — builds
  `ChatRequest`; calls `mapMessages` + `normalizeToolSchemaForProvider`; sets
  `toolChoice:"auto"` when tools present; handles `stream` flag.

## Key types & invariants

- `InferenceProvider` (`types.ts:183`) — provider contract; all methods are stateless
  w.r.t. session. No session id, no wallet, no per-session model field. **ADR-0001 invariant:
  the provider is GLOBAL — any code adding a session-specific model field here is a divergence.**
- `InferenceConfig` (`types.ts:12`) — snapshot produced by `loadConfig()`. Contains `model`,
  `contextLimit`, `temperature`, `maxOutputTokens`, per-M pricing. Produced fresh per turn
  from the models API; not cached between turns.
- `EnvConfig` (`config.ts:31`) — raw env parse result. `agentProvider` is `ProviderType | null`
  (null = not set, auto-detect); `openrouterApiKey` and `agentModel` are `string | null`
  (null = absent, provider ctor will throw).
- `StreamingInferenceResult` (`stream-consumer.ts:44`) — result of one streaming turn:
  `{ response: InferenceResponse, aborted: boolean, usageObserved: boolean }`. The
  `aborted` flag is captured AT stream exit from signal state — never re-read post-turn.
- `StreamChunk` (`types.ts:83`) — discriminated union on `type`:
  `content | tool_call_delta | reasoning | usage | error | done`. The `done` chunk is
  informational only; assembly happens on generator exhaustion.
- Null-not-cached invariant: `resolveProvider` does NOT cache a `null` result. Every call
  that returns null is a fresh resolution attempt. This is intentional: vault unlock may
  inject `OPENROUTER_API_KEY` between calls.

## Capabilities (stable IDs)

- **CAP-inference-resolve-provider**: Global provider resolution with singleton cache and
  concurrency dedup — `registry.ts:100 resolveProvider`
- **CAP-inference-reset-provider**: Cache invalidation + generation bump for env change
  (F1 reconfigure path) — `registry.ts:134 resetProvider`
- **CAP-inference-load-config**: Per-turn model metadata fetch from OpenRouter models API
  — `openrouter.ts:98 OpenRouterProvider.loadConfig`
- **CAP-inference-stream**: Abortable streaming completion with tool-call delta accumulation
  — `openrouter.ts:209 chatCompletionStream` + `stream-consumer.ts:137 runStreamingInference`
- **CAP-inference-complete**: Non-streaming completion with tools (round-trip tool calls)
  — `openrouter.ts:162 chatCompletion`
- **CAP-inference-complete-simple**: Non-streaming completion without tools (compaction chunker,
  session summary) — `openrouter.ts:184 chatCompletionSimple`
- **CAP-inference-balance**: Provider balance/credit fetch (two-endpoint fallback)
  — `openrouter.ts:284 getBalance`
- **CAP-inference-cost**: Per-request cost calculation with cache savings and reasoning
  premium — `openrouter.ts:333 calculateCost`
- **CAP-inference-normalize-schema**: Strict-mode tool schema normalization (idempotent,
  pure) — `schema-normalizer.ts:39 normalizeToolSchemaForProvider`
- **CAP-inference-env-gate-wake**: Pre-claim provider env gate for wake executor
  (OPENROUTER_API_KEY && AGENT_MODEL present) — `wake/executor.ts:307 isWakeProviderConfigured`
  (consumed by: `wake/executor.ts:341`, called inside `tick` at line 94)
- **CAP-inference-env-gate-chunker**: Pre-call provider env gate for Track 2 compaction
  chunker — `compact-jobs/chunker-call.ts:59` (inline env check before `new OpenRouterProvider()`)

## Public API (consumed by)

| Caller | Entry point | Notes |
|---|---|---|
| `engine/core/runner/agent.ts:36` | `resolveProvider()` → `provider.loadConfig()` | `processAgentTurn` — throws if null |
| `engine/core/runner/setup-turn.ts:40` | `resolveProvider()` → `provider.loadConfig()` | Mission setup turn — throws if null |
| `engine/core/runner/mission-prepare.ts:164` | `resolveProvider()` → `provider.loadConfig()` | `prepareMissionStart` step 3 — returns `provider_unavailable` outcome if null |
| `engine/core/runner/recover-prepare.ts:116` | `resolveProvider()` → `provider.loadConfig()` | `prepareRecoverRun` — returns `provider_unavailable` outcome if null |
| `engine/core/runner/mission.ts:128` | `resolveProvider()` | `resumeMissionRun` — throws if null |
| `engine/core/turn.ts:150` | `runStreamingInference(provider, ...)` | `executeTurn` — primary streaming path |
| `engine/subagents/runner.ts:53` | `resolveProvider()` + `loadEnvConfig()` + `loadSubagentConfig()` | Subagent runner (disabled in production — `subagent_spawn` commented out) |
| `engine/compact-jobs/chunker-call.ts:63` | `new OpenRouterProvider()` (direct) | Track 2 compaction chunker — **bypasses registry singleton**; own instance per job |
| `engine/wake/executor.ts:94` | `deps.isProviderReady()` → `isWakeProviderConfigured()` | Pre-claim gate; checks `OPENROUTER_API_KEY && AGENT_MODEL` in env only |
| `vex-app/src/main/ipc/onboarding/provider.ts:70` | `resetProvider()` (dynamic import) | F1 fix: called after `writeProvider` + `loadProviderDotenv({overwrite:true})` inside env-write mutex |

## Internal flow

### Turn (agent or mission)

1. Engine runner calls `resolveProvider()`.
2. `resolveProvider` checks `cachedProvider` → hit: return immediately. Miss: check `inFlight`
   for same generation → reuse promise. Neither: call `doResolve()` and track as `inFlight`.
3. `doResolve` calls `loadEnvConfig()` (reads `process.env`). If `AGENT_PROVIDER` set →
   factory lookup → `new OpenRouterProvider()`. If absent but `OPENROUTER_API_KEY` set →
   `new OpenRouterProvider()`. Neither → log `none_configured` → return null.
4. `OpenRouterProvider` constructor: `loadEnvConfig()` again; throws if key/model absent.
   Builds `OpenRouter` SDK client with `retryConfig.strategy:"backoff"` + 5-min timeout.
5. On resolve success and matching generation: `cachedProvider = provider`.
6. Engine runner calls `provider.loadConfig()` (fresh every turn).
7. `loadConfig()` calls `client.models.list({})` → finds model by id → extracts pricing.
   Returns `null` on model-not-found or network error → engine returns `provider_unavailable`.
8. `executeTurn` calls `runStreamingInference(provider, messages, tools, config, { onDelta, signal })`.
9. `runStreamingInference`: checks pre-abort → calls `provider.chatCompletionStream(...)`.
   Streams chunks: dispatches `onDelta` for each (feeding `streamDeltaBus`), accumulates
   content/tools/reasoning, captures usage. On abort: breaks loop, returns partial with
   `aborted:true`. On pre-first-chunk error: `bufferedFallback` via `chatCompletion`. On
   mid-stream error: rethrows.

### Reconfigure (F1 same-session path)

1. Wizard writes new provider config: `vex-app/src/main/ipc/onboarding/provider.ts` calls
   `verifyOpenRouterConnection` → `writeProvider` (vault + `.env`) → inside `withEnvWriteLock`:
   `loadProviderDotenv({ overwrite: true })` → `resetProvider()` (dynamic import of registry).
2. `resetProvider()` bumps `generation`, clears `cachedProvider` and `inFlight`.
3. Any in-flight `doResolve` that committed before the generation bump is discarded (generation
   mismatch guard in `resolveProvider`'s `.then` callback).
4. Next `resolveProvider()` call builds a fresh `OpenRouterProvider` with the new model/key.

### Track 2 compaction (pre-claim gate)

1. `callChunkerLLM` checks `process.env.OPENROUTER_API_KEY && process.env.AGENT_MODEL` directly
   (does NOT use `resolveProvider` — own instance). If absent: throws `compact_worker_provider_config_missing`.
2. `new OpenRouterProvider()` + `provider.loadConfig()`. If `loadConfig` returns null: throws.
3. `chatCompletionSimple` with chunker system prompt; `Promise.race` against `TRACK2_TIMEOUT_MS`.
4. Output is parsed JSON, Zod-validated (`ChunkerOutputSchema`). On schema fail: throws so
   the outbox row stays `pending` for retry (not silently lost).

### Wake executor pre-claim gate

1. `tick(now, limit, deps)` calls `deps.isProviderReady()` → `isWakeProviderConfigured()` →
   `Boolean(process.env.OPENROUTER_API_KEY) && Boolean(process.env.AGENT_MODEL)`.
2. Returns `[]` immediately if not ready — **no `claimDue` called**, no row consumed.
   This prevents a wake row from being permanently consumed when the vault is locked.
3. When ready: `claimDue` → for each claimed wake → `claimRunLeaseAndFlipToRunning` →
   `resumeMissionRun` → full agent turn loop with inference.

## Dependencies

- **Imports FROM**:
  - `src/lib/agent-config.ts` — `parseAgentEnv`, `parseSubagentEnv`, `formatParseErrors`,
    `AGENT_CONTEXT_LIMIT`, `AGENT_MAX_OUTPUT_TOKENS`, `AGENT_TEMPERATURE`
  - `@openrouter/sdk` — `OpenRouter` client (npm package, root `node_modules`)
  - `@utils/logger.js` → `src/utils/logger.ts` (winston)
  - `@vex-agent/tools/types.js` → `src/vex-agent/tools/types.ts` (for `JsonSchema` in schema-normalizer)
- **Consumed BY** (in-tree):
  - `src/vex-agent/engine/core/runner/agent.ts` — `resolveProvider`
  - `src/vex-agent/engine/core/runner/setup-turn.ts` — `resolveProvider`
  - `src/vex-agent/engine/core/runner/mission-prepare.ts` — `resolveProvider`
  - `src/vex-agent/engine/core/runner/recover-prepare.ts` — `resolveProvider`
  - `src/vex-agent/engine/core/runner/mission.ts` — `resolveProvider`
  - `src/vex-agent/engine/core/turn.ts` — `runStreamingInference`
  - `src/vex-agent/engine/subagents/runner.ts` — `resolveProvider`, `loadEnvConfig`, `loadSubagentConfig`
  - `src/vex-agent/engine/compact-jobs/chunker-call.ts` — `OpenRouterProvider` (direct)
  - `src/vex-agent/engine/wake/executor.ts` — `isWakeProviderConfigured` (exported, injected as `deps.isProviderReady`)
- **Consumed BY** (cross-process via dynamic import):
  - `vex-app/src/main/ipc/onboarding/provider.ts:70` — `resetProvider` (dynamic import inside env-write mutex, F1 fix)

## Cross-references

- **ADR**: `decisions/ADR-0001-global-model-session-wallet` — global model decision; per-session
  model is **not implemented** and would be a divergence from this module's design.
- **Fix plan F1**: `fix-plans/F1-model-provider-env.md` — root cause was `.env` never loaded
  into `process.env` at boot. F1 added `loadProviderDotenv()` at boot and
  `loadProviderDotenv({overwrite:true}) + resetProvider()` post-`writeProvider`. The
  `resetProvider` call site at `vex-app/src/main/ipc/onboarding/provider.ts:70` is the
  canonical wiring for same-session reconfigure correctness.
- **vex-app coverage**: `audits/current/coverage-gaps.md#CAP-inference-resolve-provider`
- **quality findings**: `audits/current/quality-findings.md#FINDING-inference-001` (F4 –
  `loadConfig` models API hit every turn; see Open questions)
- **related flows**: `flows/FLOW-chat-turn.md` (Round 2), `flows/FLOW-mission-start.md` (Round 2)

## Refresh triggers

- Any file under `src/vex-agent/inference/**` — direct scope.
- `src/lib/agent-config.ts` — shared AGENT_*/SUBAGENT_* field metadata.
- `src/providers/env-resolution.ts` or `src/utils/dotenv.ts` — changes to how `.env` is
  loaded (F1 fix utilities).
- `vex-app/src/main/ipc/onboarding/provider.ts` — `resetProvider` call site; any change
  to the verify→write→reload→reset ordering would break same-session reconfigure.
- `src/vex-agent/db/migrations/**` — watch for any `model_id` column on `sessions` (would
  be an ADR-0001 divergence).
- `src/vex-agent/engine/wake/executor.ts` — `isWakeProviderConfigured` implementation lives
  here; changes to the env gate logic affect CAP-inference-env-gate-wake.

## Open questions

1. **F4 — `loadConfig()` models API hit every turn**: `OpenRouterProvider.loadConfig` calls
   `client.models.list({})` on every invocation (no in-process cache). A transient network
   failure or model de-listing returns `null`, causing a `provider_unavailable` error for
   that turn. The pricing data could be cached with a TTL (e.g. `BALANCE_CACHE_TTL_MS = 30s`
   already exists for balance). No per-session-model concern — caching would be global.
   Not fixed; cross-reference `audits/current/quality-findings.md#FINDING-inference-001`.
2. **Track 2 chunker bypasses registry singleton**: `callChunkerLLM` instantiates
   `new OpenRouterProvider()` directly rather than calling `resolveProvider()`. This means
   the chunker's provider instance is not invalidated by `resetProvider()` — a reconfigure
   mid-compaction job could use the old model for the chunker call of that job. Low risk
   (Track 2 jobs are short-lived) but worth noting for consistency.
3. **No per-session model — ADR-0001 confirmed**: The `sessions` table has no `model_id`
   column (migration inventory verified through mig-027). Any future PR adding such a column
   or any per-session model parameter to `InferenceProvider` / `resolveProvider` must be
   flagged as an ADR-0001 divergence and requires an explicit product decision.
