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
} from "./config.js";

import logger from "@utils/logger.js";
import { normalizeOpenRouterError } from "./openrouter/errors.js";
import { extractUsage, parseNonStreamingResponse, processToolCallDelta } from "./openrouter/mappers.js";
import { buildOpenRouterParams } from "./openrouter/params.js";

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

  // ── loadConfig ──────────────────────────────────────────────────

  async loadConfig(): Promise<InferenceConfig | null> {
    let inputPricePerM = 0;
    let outputPricePerM = 0;
    let cachePricePerM: number | null = null;
    let reasoningPricePerM: number | null = null;

    try {
      const models = await this.client.models.list({});
      const found = models.data?.find((m: { id: string }) => m.id === this.model);

      if (!found) {
        logger.error("inference.openrouter.model_not_found", {
          model: this.model,
          hint: "Check AGENT_MODEL or OpenRouter model availability",
        });
        return null;
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
    } catch (err) {
      logger.error("inference.openrouter.api_unreachable", {
        model: this.model,
        error: err instanceof Error ? err.message : String(err),
        hint: "Check OPENROUTER_API_KEY and network connectivity",
      });
      return null;
    }

    return {
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

  calculateCost(usage: InferenceUsage, config: InferenceConfig): RequestCost {
    const promptCost = (usage.promptTokens / 1_000_000) * config.inputPricePerM;
    const completionCost = (usage.completionTokens / 1_000_000) * config.outputPricePerM;

    let cachedSavings = 0;
    if (config.cachePricePerM !== null && usage.cachedTokens && usage.cachedTokens > 0) {
      const standardCost = (usage.cachedTokens / 1_000_000) * config.inputPricePerM;
      const cacheCost = (usage.cachedTokens / 1_000_000) * config.cachePricePerM;
      cachedSavings = standardCost - cacheCost;
    }

    let reasoningCost = 0;
    if (config.reasoningPricePerM !== null && usage.reasoningTokens && usage.reasoningTokens > 0) {
      const standardCost = (usage.reasoningTokens / 1_000_000) * config.outputPricePerM;
      const actualCost = (usage.reasoningTokens / 1_000_000) * config.reasoningPricePerM;
      reasoningCost = actualCost - standardCost;
    }

    const totalCost = promptCost + completionCost - cachedSavings + reasoningCost;

    return {
      totalCost,
      currency: "USD",
      breakdown: { promptCost, completionCost, cachedSavings, reasoningCost },
    };
  }

}
