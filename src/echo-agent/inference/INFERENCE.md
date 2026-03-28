# Inference Module — Echo Agent

Provider-agnostic inference layer. Two providers (OpenRouter SDK + 0G Compute raw fetch) behind a shared `InferenceProvider` interface.

## Files

| File | Role |
|------|------|
| `types.ts` | Shared contract: `InferenceProvider`, `InferenceConfig`, `InferenceResponse`, `InferenceUsage`, `ParsedToolCall`, `StreamChunk`, `ProviderBalance`, `RequestCost`, `ProviderMessage`, `ToolDefinition` |
| `config.ts` | ENV validation at startup + internal constants (timeouts, retry, thresholds). `loadEnvConfig()` fails fast on bad values |
| `resilience.ts` | `retryWithBackoff()`, `withTimeout()`, `isRetryableError()` — shared retry/timeout for both providers |
| `registry.ts` | `resolveProvider()` → singleton. Priority: `AGENT_PROVIDER` env → `OPENROUTER_API_KEY` → `compute-state.json` → null |
| `openrouter.ts` | `OpenRouterProvider` — `@openrouter/sdk`. Native streaming (`EventStream` → `AsyncGenerator<StreamChunk>`), tool calling (non-streaming + streaming delta accumulation), balance (credits API + key metadata fallback), cost with cache/reasoning breakdown |
| `0g-compute.ts` | `ZeroGComputeProvider` — raw HTTP fetch, OpenAI-compatible. HMAC auth via broker. No streaming (fallback: non-streaming → yield). Balance from on-chain ledger (30s cache) |

## Provider interface

```typescript
interface InferenceProvider {
  loadConfig(): Promise<InferenceConfig | null>;
  chatCompletion(messages, tools, config): Promise<InferenceResponse>;
  chatCompletionSimple(messages, config): Promise<{ content, usage }>;
  chatCompletionStream(messages, tools, config): AsyncGenerator<StreamChunk>;
  getBalance(): Promise<ProviderBalance | null>;
  calculateCost(usage, config): RequestCost;
}
```

Every consumer (engine, Echo Papa, subagents, scheduler) imports from this module — zero dependencies on DB, engine, or transport.

## ENV — required variables

```bash
# ── Provider selection (optional — auto-detected if missing) ─────
AGENT_PROVIDER=openrouter          # "openrouter" | "0g-compute"

# ── Shared ────────────────────────────────────────────────────────
AGENT_CONTEXT_LIMIT=128000         # context window tokens (provider-dependent: 128K OR, 64K 0G)
AGENT_MAX_OUTPUT_TOKENS=16384      # max output tokens per response (optional, default 16384)

# ── OpenRouter ────────────────────────────────────────────────────
OPENROUTER_API_KEY=sk-or-...       # required if provider=openrouter
AGENT_MODEL=anthropic/claude-sonnet-4  # required — model ID from OpenRouter
AGENT_TEMPERATURE=0.7              # optional, 0.0-2.0 (OpenRouter only — 0G ignores)

# ── 0G Compute ────────────────────────────────────────────────────
# No additional ENV — config loaded from compute-state.json
# (created by `echoclaw echo connect`)

# ── Subagent overrides (all optional — inherit from AGENT_* if unset) ──
SUBAGENT_MAX_CONCURRENT=5          # max parallel subagents (default: 5, range: 1-20)
SUBAGENT_CONTEXT_LIMIT=16384       # subagent context window (default: 16384)
SUBAGENT_MAX_OUTPUT_TOKENS=        # inherits AGENT_MAX_OUTPUT_TOKENS if unset
SUBAGENT_TEMPERATURE=              # inherits AGENT_TEMPERATURE if unset
SUBAGENT_MAX_ITERATIONS=25         # max tool call iterations per subagent (default: 25)
SUBAGENT_TIMEOUT_MS=300000         # subagent execution timeout (default: 5 min)
```

## Subagent config

`loadSubagentConfig(agentConfig)` returns a `SubagentConfig` object with ENV overrides + fallbacks from the agent's own config. Subagents share the agent's provider and model, but can have independent context limits, output caps, temperature, iteration budget, and timeout.

```typescript
interface SubagentConfig {
  maxConcurrent: number;      // how many can run in parallel
  contextLimit: number;       // smaller window than main agent
  maxOutputTokens: number;    // inherits from agent if unset
  temperature: number | null; // inherits from agent if unset
  maxIterations: number;      // tool call budget per subagent
  timeoutMs: number;          // hard timeout for entire execution
}
```

## Provider differences

| Aspect | OpenRouter | 0G Compute |
|--------|-----------|------------|
| Transport | SDK (`@openrouter/sdk`) | Raw HTTP fetch |
| Auth | Bearer token | HMAC broker signing |
| Streaming | Native `EventStream` | None — non-streaming fallback |
| Temperature | From ENV | Not supported |
| Tool calling | SDK-typed `ChatMessageToolCall` | OpenAI-compatible JSON |
| Balance | Credits API / key metadata (USD) | On-chain ledger (0G tokens) |
| Pricing source | Per-token string from `models.list()` × 1M | Per-M from service metadata |
| Cache pricing | Yes (`inputCacheRead`) | No |
| Reasoning pricing | Yes (`internalReasoning`) | No |

## Tests

```bash
npx vitest run src/__tests__/echo-agent/inference/
```

6 files, 81 tests: config validation, SubagentConfig, resilience (retry/timeout/error classification), registry (resolution/cache), types (structural integrity), cost calculation (both providers with full breakdown).
