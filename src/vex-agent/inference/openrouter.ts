/**
 * OpenRouter inference provider — SDK-based with streaming + tool calling.
 *
 * Uses @openrouter/sdk for all communication. SDK handles:
 * - Retry with backoff (429, 5xx)
 * - Timeout management
 * - Auth header injection
 * - Zod-validated response parsing
 *
 * Streaming: SDK returns EventStream<ChatStreamChunk> which
 * we consume and yield as provider-agnostic StreamChunk instances.
 *
 * Tool calling: both streaming (delta accumulation) and non-streaming paths.
 *
 * Message mapping, response parsing, and streaming accumulation in openrouter-mappers.ts.
 *
 * @see https://openrouter.ai/docs/quickstart
 */

import { OpenRouter } from "@openrouter/sdk";
import type { ChatResult } from "@openrouter/sdk/models/chatresult.js";
import type { ChatStreamChunk } from "@openrouter/sdk/models/chatstreamchunk.js";
import type { EventStream } from "@openrouter/sdk/lib/event-streams.js";

import type {
  InferenceProvider,
  InferenceConfig,
  InferenceResponse,
  InferenceUsage,
  StreamChunk,
  ProviderBalance,
  ProviderMessage,
  ToolDefinition,
  RequestCost,
} from "./types.js";

import { loadEnvConfig } from "./config.js";
import {
  OPENROUTER_APP_URL,
  OPENROUTER_APP_TITLE,
  OPENROUTER_SDK_TIMEOUT_MS,
  OPENROUTER_LOW_BALANCE_USD,
  MODEL_CONFIG_CACHE_TTL_MS,
  MODEL_CONFIG_STALE_RETRY_MS,
} from "./config.js";

import logger from "@utils/logger.js";
import { normalizeOpenRouterError } from "./openrouter/errors.js";
import { extractUsage, parseNonStreamingResponse, processToolCallDelta } from "./openrouter/mappers.js";
import { buildOpenRouterParams } from "./openrouter/params.js";
import { computeRequestCost } from "./openrouter/cost.js";

// ── Provider ─────────────────────────────────────────────────────

export class OpenRouterProvider implements InferenceProvider {
  readonly id = "openrouter";
  readonly displayName = "OpenRouter";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly contextLimit: number;
  private readonly temperature: number | undefined;
  private readonly maxOutputTokens: number;
  private readonly client: OpenRouter;

  // ── loadConfig cache (F4) ───────────────────────────────────────
  // `loadConfig()` is called once per turn but `/models` pricing is stable.
  // We memoize the last SUCCESSFUL config and reuse it for the TTL, dedup
  // concurrent fetches, and serve the last-good config on a transient
  // metadata failure (throttled). `cachedConfig` is the single canonical
  // reference — every return path hands out a fresh shallow copy so callers
  // can never mutate the cache.
  private cachedConfig: InferenceConfig | null = null;
  private cachedAt = 0;
  private staleServeUntil = 0;
  private inFlight: Promise<InferenceConfig | null> | null = null;

  constructor() {
    const env = loadEnvConfig();

    if (!env.openrouterApiKey) {
      throw new Error("OPENROUTER_API_KEY is required for OpenRouter provider");
    }
    if (!env.agentModel) {
      throw new Error("AGENT_MODEL is required for OpenRouter provider");
    }

    this.apiKey = env.openrouterApiKey;
    this.model = env.agentModel;
    this.contextLimit = env.contextLimit;
    this.temperature = env.temperature ?? undefined;
    this.maxOutputTokens = env.maxOutputTokens;

    this.client = new OpenRouter({
      apiKey: this.apiKey,
      httpReferer: OPENROUTER_APP_URL,
      appTitle: OPENROUTER_APP_TITLE,
      timeoutMs: OPENROUTER_SDK_TIMEOUT_MS,
      retryConfig: {
        strategy: "backoff",
        backoff: {
          initialInterval: 2000,
          maxInterval: 15000,
          exponent: 2,
          maxElapsedTime: 60000,
        },
      },
    });
  }

  // ── loadConfig (cached) ─────────────────────────────────────────
  //
  // F4: the raw `/models` fetch lives in `_fetchConfig()`; this wrapper
  // memoizes the result so the per-turn call sites do not each hit the
  // network. Semantics:
  //   - fresh hit (within TTL) → cached config (copied);
  //   - concurrent calls → share one in-flight fetch, each gets its own copy;
  //   - transient metadata failure WITH a last-good → serve stale (copied),
  //     throttled so we re-attempt `/models` at most every STALE_RETRY window;
  //   - `model_not_found` (catalog responded, model absent) → null even if a
  //     last-good exists, so a delisted/misconfigured model stays loud;
  //   - first-fetch failure (no last-good) → null, re-attempted next turn.
  // The cached object is canonical and never handed out by reference — every
  // return is a fresh shallow copy.

  async loadConfig(): Promise<InferenceConfig | null> {
    const now = Date.now();

    // 1. Fresh cache hit.
    if (this.cachedConfig && now - this.cachedAt < MODEL_CONFIG_CACHE_TTL_MS) {
      return { ...this.cachedConfig };
    }
    // 2. Concurrent dedup — await the canonical fetch, copy per caller.
    if (this.inFlight) {
      const c = await this.inFlight;
      return c ? { ...c } : null;
    }
    // 3. Throttled stale-serve: a recent metadata failure left a last-good
    //    config and we're inside the retry window — serve stale without a
    //    network call.
    if (this.cachedConfig && now < this.staleServeUntil) {
      return { ...this.cachedConfig };
    }

    // 4. Fetch. The stored promise resolves to the CANONICAL reference (or
    //    null) — never a copy — so all awaiters clone independently.
    this.inFlight = this._fetchConfig()
      .then((result) => {
        if (result.kind === "success") {
          this.cachedConfig = result.config;
          this.cachedAt = Date.now();
          this.staleServeUntil = 0;
          return this.cachedConfig;
        }
        if (result.kind === "metadata_unavailable" && this.cachedConfig) {
          // Transient `/models` failure but we have a last-good — serve it and
          // throttle the next refetch attempt so we don't block every turn.
          this.staleServeUntil = Date.now() + MODEL_CONFIG_STALE_RETRY_MS;
          logger.warn("inference.openrouter.config_stale_served", {
            model: this.model,
            cachedAt: new Date(this.cachedAt).toISOString(),
          });
          return this.cachedConfig;
        }
        // `model_not_found` (surface delisting/misconfig), or metadata failure
        // with no last-good to fall back on.
        return null;
      })
      .finally(() => {
        this.inFlight = null;
      });

    // 5. Starter clones the canonical result too.
    const c = await this.inFlight;
    return c ? { ...c } : null;
  }

  // ── _fetchConfig (uncached `/models` read) ──────────────────────
  //
  // Classifies the outcome so `loadConfig()` can decide stale-vs-null:
  //   - `success`              → catalog responded and contains `this.model`;
  //   - `model_not_found`      → catalog responded but lacks the model (hard);
  //   - `metadata_unavailable` → the `/models` request itself failed.

  private async _fetchConfig(): Promise<
    | { kind: "success"; config: InferenceConfig }
    | { kind: "model_not_found" }
    | { kind: "metadata_unavailable" }
  > {
    let inputPricePerM = 0;
    let outputPricePerM = 0;
    let cachePricePerM: number | null = null;
    let reasoningPricePerM: number | null = null;

    // `/models` transport/server/SDK failure → metadata_unavailable (the
    // caller may serve a last-good config). A successful catalog that lacks
    // the model is a distinct, hard `model_not_found`.
    let models: Awaited<ReturnType<typeof this.client.models.list>>;
    try {
      models = await this.client.models.list({});
    } catch (err) {
      logger.error("inference.openrouter.api_unreachable", {
        model: this.model,
        error: err instanceof Error ? err.message : String(err),
        hint: "Check OPENROUTER_API_KEY and network connectivity",
      });
      return { kind: "metadata_unavailable" };
    }

    const found = models.data?.find((m: { id: string }) => m.id === this.model);
    if (!found) {
      logger.error("inference.openrouter.model_not_found", {
        model: this.model,
        hint: "Check AGENT_MODEL or OpenRouter model availability",
      });
      return { kind: "model_not_found" };
    }

    if (found.pricing) {
      // PublicPricing: prompt/completion are per-TOKEN strings (not per-1M)
      inputPricePerM = parseFloat(String(found.pricing.prompt)) * 1_000_000;
      outputPricePerM = parseFloat(String(found.pricing.completion)) * 1_000_000;

      if (found.pricing.inputCacheRead) {
        cachePricePerM = parseFloat(String(found.pricing.inputCacheRead)) * 1_000_000;
      }
      if (found.pricing.internalReasoning) {
        reasoningPricePerM = parseFloat(String(found.pricing.internalReasoning)) * 1_000_000;
      }
    }

    logger.info("inference.openrouter.config_loaded", {
      model: this.model,
      contextLimit: this.contextLimit,
      inputPricePerM: inputPricePerM.toFixed(4),
      outputPricePerM: outputPricePerM.toFixed(4),
      hasCachePrice: cachePricePerM !== null,
      hasReasoningPrice: reasoningPricePerM !== null,
    });

    return {
      kind: "success",
      config: {
        provider: this.id,
        model: this.model,
        contextLimit: this.contextLimit,
        temperature: this.temperature,
        maxOutputTokens: this.maxOutputTokens,
        inputPricePerM,
        outputPricePerM,
        priceCurrency: "USD",
        cachePricePerM,
        reasoningPricePerM,
      },
    };
  }

  // ── chatCompletion (non-streaming, with tools) ──────────────────

  async chatCompletion(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
  ): Promise<InferenceResponse> {
    const params = buildOpenRouterParams(messages, tools, config, false);

    let response: ChatResult;
    try {
      response = await this.client.chat.send({
        chatRequest: params,
      }) as ChatResult;
    } catch (err) {
      throw normalizeOpenRouterError(err, "chat completion");
    }

    return parseNonStreamingResponse(response);
  }

  // ── chatCompletionSimple (no tools) ─────────────────────────────

  async chatCompletionSimple(
    messages: ProviderMessage[],
    config: InferenceConfig,
  ): Promise<{ content: string; usage: InferenceUsage }> {
    const params = buildOpenRouterParams(messages, [], config, false);

    let response: ChatResult;
    try {
      response = await this.client.chat.send({
        chatRequest: params,
      }) as ChatResult;
    } catch (err) {
      throw normalizeOpenRouterError(err, "simple chat completion");
    }

    const msg = response.choices?.[0]?.message;
    const content = typeof msg?.content === "string" ? msg.content : "";

    return {
      content,
      usage: extractUsage(response.usage),
    };
  }

  // ── chatCompletionStream (streaming with tools) ─────────────────

  async *chatCompletionStream(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const params = buildOpenRouterParams(messages, tools, config, true);

    let stream: EventStream<ChatStreamChunk>;
    try {
      // `signal` is a flattened RequestInit field on the SDK's RequestOptions
      // (takes precedence over the client timeout); it cancels the fetch so a
      // chat-turn "stop generating" tears down the HTTP stream (Stage 9-5a).
      stream = await this.client.chat.send(
        { chatRequest: { ...params, stream: true } },
        signal ? { signal } : undefined,
      ) as EventStream<ChatStreamChunk>;
    } catch (err) {
      throw normalizeOpenRouterError(err, "streaming chat completion");
    }

    // Accumulate tool call deltas by index
    const toolCallAccumulator = new Map<number, {
      id: string;
      name: string;
      argsBuffer: string;
    }>();

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      // Error on chunk
      if (chunk.error) {
        yield {
          type: "error",
          errorMessage: chunk.error.message,
          errorCode: chunk.error.code,
        };
        continue;
      }

      // Text content delta
      if (delta?.content) {
        yield { type: "content", text: delta.content };
      }

      // Reasoning delta
      if (delta?.reasoning) {
        yield { type: "reasoning", reasoningText: delta.reasoning };
      }

      // Tool call deltas — accumulate by index
      if (delta?.toolCalls) {
        for (const tc of delta.toolCalls) {
          yield* processToolCallDelta(tc, toolCallAccumulator);
        }
      }

      // Usage (typically in last chunk)
      if (chunk.usage) {
        yield { type: "usage", usage: extractUsage(chunk.usage) };
      }

      // Check finish reason
      const finishReason = chunk.choices?.[0]?.finishReason;
      if (finishReason === "stop" || finishReason === "tool_calls") {
        // Yield final parsed tool calls if accumulated
        // (done event signals completion — engine assembles final tool calls)
        yield { type: "done" };
      }
    }
  }

  // ── getBalance ──────────────────────────────────────────────────

  async getBalance(): Promise<ProviderBalance | null> {
    // Try management key endpoint first (richer data)
    try {
      const res = await this.client.credits.getCredits();
      const total = res.data?.totalCredits ?? 0;
      const used = res.data?.totalUsage ?? 0;
      const remaining = total - used;
      const isLow = remaining < OPENROUTER_LOW_BALANCE_USD;

      return {
        available: remaining,
        currency: "USD",
        isLow,
        displayText: `$${remaining.toFixed(2)} USD`,
        total,
      };
    } catch {
      // Management key not available — try regular key metadata
    }

    // Fallback: getCurrentKeyMetadata (works with regular inference keys)
    try {
      const keyInfo = await this.client.apiKeys.getCurrentKeyMetadata();
      const data = keyInfo.data;
      const limit = data?.limit ?? null;
      const limitRemaining = data?.limitRemaining ?? null;

      if (limit != null && limitRemaining != null) {
        const isLow = limitRemaining < OPENROUTER_LOW_BALANCE_USD;
        return {
          available: limitRemaining,
          currency: "USD",
          isLow,
          displayText: `$${limitRemaining.toFixed(2)} USD (limit: $${limit.toFixed(2)})`,
          total: limit,
          usageDaily: data?.usageDaily,
          usageMonthly: data?.usageMonthly,
        };
      }

      // Key has no spending limit — balance unknown but not low
      return null;
    } catch {
      return null;
    }
  }

  // ── calculateCost ───────────────────────────────────────────────
  //
  // Delegates to the pure `computeRequestCost` (testable without a provider
  // instance). It prefers OpenRouter's authoritative `usage.cost` and falls
  // back to the local price-table estimate when that value is absent/invalid.

  calculateCost(usage: InferenceUsage, config: InferenceConfig): RequestCost {
    return computeRequestCost(usage, config);
  }

}
