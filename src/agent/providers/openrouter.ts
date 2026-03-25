/**
 * OpenRouter inference provider — uses @openrouter/sdk.
 *
 * SDK handles retry, timeout, typed responses natively.
 * Also provides balance check (credits API) and dynamic model pricing.
 *
 * @see https://openrouter.ai/docs/quickstart
 */

import { OpenRouter } from "@openrouter/sdk";
import type { ChatResponse } from "@openrouter/sdk/models/chatresponse.js";
import type { ChatGenerationParams } from "@openrouter/sdk/models/chatgenerationparams.js";
import type { ChatMessageToolCall } from "@openrouter/sdk/models/chatmessagetoolcall.js";
import type { ChatGenerationTokenUsage } from "@openrouter/sdk/models/chatgenerationtokenusage.js";
import type { InferenceConfig, InferenceResponse, Message, ParsedToolCall } from "../types.js";
import type { OpenAITool } from "../tool-registry.js";
import type { InferenceProvider, ProviderBalance } from "./types.js";
import { sanitizeContent } from "../tool-parser.js";
import logger from "../../utils/logger.js";

// ── Constants (§5.6) ─────────────────────────────────────────────────

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_MODEL = "anthropic/claude-sonnet-4";
const OPENROUTER_DEFAULT_CONTEXT_LIMIT = 200_000;
const OPENROUTER_APP_URL = "https://echoclaw.ai";
const OPENROUTER_APP_TITLE = "EchoClaw Agent";
const OPENROUTER_APP_CATEGORY = "cli-agent";
const OPENROUTER_LOW_BALANCE_USD = 5.0;
const OPENROUTER_TIMEOUT_MS = 300_000;
const OPENROUTER_MAX_TOKENS = 8192;
const OPENROUTER_TEMPERATURE = 0.7;

// ── Provider ─────────────────────────────────────────────────────────

export class OpenRouterProvider implements InferenceProvider {
  readonly id = "openrouter";
  readonly displayName = "OpenRouter";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly contextLimit: number;
  private readonly client: OpenRouter;

  constructor() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for OpenRouter provider");

    this.apiKey = apiKey;
    this.model = process.env.AGENT_MODEL ?? OPENROUTER_DEFAULT_MODEL;

    const envLimit = Number(process.env.AGENT_CONTEXT_LIMIT);
    this.contextLimit = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : OPENROUTER_DEFAULT_CONTEXT_LIMIT;

    this.client = new OpenRouter({
      apiKey: this.apiKey,
      httpReferer: OPENROUTER_APP_URL,
      xTitle: OPENROUTER_APP_TITLE,
      timeoutMs: OPENROUTER_TIMEOUT_MS,
      retryConfig: {
        strategy: "backoff",
        backoff: { initialInterval: 2000, maxInterval: 15000, exponent: 2, maxElapsedTime: 60000 },
      },
    });
  }

  async loadConfig(): Promise<InferenceConfig | null> {
    // Validate API key + model by fetching model list (fail-fast §2.10)
    let inputPricePerM = 0;
    let outputPricePerM = 0;
    let modelVerified = false;

    try {
      const models = await this.client.models.list({});
      const found = models.data?.find((m: { id: string }) => m.id === this.model);
      if (found) {
        modelVerified = true;
        if (found.pricing) {
          inputPricePerM = parseFloat(String(found.pricing.prompt)) * 1_000_000;
          outputPricePerM = parseFloat(String(found.pricing.completion)) * 1_000_000;
        }
      } else {
        logger.error("provider.openrouter.model_not_found", { model: this.model, hint: "Check AGENT_MODEL or OpenRouter model availability" });
        return null;
      }
    } catch (err) {
      // API key invalid or network error — agent should not start
      logger.error("provider.openrouter.api_unreachable", {
        model: this.model,
        error: err instanceof Error ? err.message : String(err),
        hint: "Check OPENROUTER_API_KEY and network connectivity",
      });
      return null;
    }

    if (inputPricePerM === 0 || outputPricePerM === 0) {
      logger.warn("provider.openrouter.zero_pricing", { model: this.model, inputPricePerM, outputPricePerM });
    }

    logger.info("provider.openrouter.config_loaded", {
      model: this.model, contextLimit: this.contextLimit, modelVerified,
      inputPricePerM: inputPricePerM.toFixed(4),
      outputPricePerM: outputPricePerM.toFixed(4),
    });

    return {
      provider: this.id, model: this.model, endpoint: OPENROUTER_ENDPOINT,
      contextLimit: this.contextLimit, inputPricePerM, outputPricePerM, priceCurrency: "USD",
    };
  }

  async getAuthHeaders(): Promise<Record<string, string>> {
    return {
      "Authorization": `Bearer ${this.apiKey}`,
      "HTTP-Referer": OPENROUTER_APP_URL,
      "X-OpenRouter-Title": OPENROUTER_APP_TITLE,
      "X-OpenRouter-Categories": OPENROUTER_APP_CATEGORY,
    };
  }

  async getBalance(): Promise<ProviderBalance | null> {
    // Try management key endpoint first (richer data)
    try {
      const res = await this.client.credits.getCredits();
      const total = res.data?.totalCredits ?? 0;
      const used = res.data?.totalUsage ?? 0;
      const remaining = total - used;
      const isLow = remaining < OPENROUTER_LOW_BALANCE_USD;
      return {
        availableDisplay: `$${remaining.toFixed(2)} USD`,
        availableRaw: remaining,
        currency: "USD",
        isLow,
        lowBalanceMessage: isLow ? `Low OpenRouter credits: $${remaining.toFixed(2)} remaining` : undefined,
        total, available: remaining,
      };
    } catch { /* management key not available — try current key metadata */ }

    // Fallback: getCurrentKeyMetadata (works with regular inference keys)
    try {
      const keyInfo = await this.client.apiKeys.getCurrentKeyMetadata();
      const limit = keyInfo.data?.limit ?? null;
      const limitRemaining = keyInfo.data?.limitRemaining ?? null;
      if (limit != null && limitRemaining != null) {
        const isLow = limitRemaining < OPENROUTER_LOW_BALANCE_USD;
        return {
          availableDisplay: `$${limitRemaining.toFixed(2)} USD (limit: $${limit.toFixed(2)})`,
          availableRaw: limitRemaining,
          currency: "USD",
          isLow,
          lowBalanceMessage: isLow ? `Low OpenRouter key limit: $${limitRemaining.toFixed(2)} remaining` : undefined,
          total: limit, available: limitRemaining,
        };
      }
      // Key has no spending limit — balance unknown but not low
      return null;
    } catch {
      return null;
    }
  }

  getEndpoint(config: InferenceConfig): string {
    return config.endpoint;
  }

  // ── SDK inference ──────────────────────────────────────────────────

  async chatCompletion(messages: Message[], tools: OpenAITool[], config: InferenceConfig): Promise<InferenceResponse> {
    const params: ChatGenerationParams = {
      model: config.model,
      messages: mapMessages(messages),
      maxTokens: OPENROUTER_MAX_TOKENS,
      temperature: OPENROUTER_TEMPERATURE,
    };

    if (tools.length > 0) {
      params.tools = tools.map(t => ({
        type: "function" as const,
        function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters },
      }));
      params.toolChoice = "auto";
    }

    const response = await this.client.chat.send({
      chatGenerationParams: params,
    }) as ChatResponse;

    return parseResponse(response);
  }

  async chatCompletionSimple(messages: Message[], config: InferenceConfig): Promise<{ content: string; usage: { promptTokens: number; completionTokens: number } }> {
    const response = await this.client.chat.send({
      chatGenerationParams: {
        model: config.model,
        messages: mapMessages(messages),
        maxTokens: OPENROUTER_MAX_TOKENS,
        temperature: OPENROUTER_TEMPERATURE,
      },
    }) as ChatResponse;

    const msg = response.choices?.[0]?.message;
    const content = typeof msg?.content === "string" ? msg.content : "";
    return {
      content,
      usage: { promptTokens: response.usage?.promptTokens ?? 0, completionTokens: response.usage?.completionTokens ?? 0 },
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function mapMessages(messages: Message[]): ChatGenerationParams["messages"] {
  return messages.map(m => {
    if (m.role === "tool" && m.toolCallId) {
      return { role: "tool" as const, content: m.content, toolCallId: m.toolCallId };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: m.content || undefined,
        toolCalls: m.toolCalls.map(tc => ({
          id: tc.id ?? "",
          type: "function" as const,
          function: { name: tc.command, arguments: JSON.stringify(tc.args) },
        })),
      };
    }
    if (m.role === "system") return { role: "system" as const, content: m.content };
    if (m.role === "assistant") return { role: "assistant" as const, content: m.content || undefined };
    return { role: "user" as const, content: m.content };
  });
}

function parseResponse(response: ChatResponse): InferenceResponse {
  const choice = response.choices?.[0];
  const msg = choice?.message;
  const usage: ChatGenerationTokenUsage | undefined = response.usage;

  const sdkToolCalls: ChatMessageToolCall[] | undefined = msg?.toolCalls;
  if (sdkToolCalls?.length) {
    const parsed: ParsedToolCall[] = [];
    for (const tc of sdkToolCalls) {
      try {
        parsed.push({ id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments) });
      } catch {
        logger.warn("provider.openrouter.malformed_tool_call", { name: tc.function.name });
      }
    }
    if (parsed.length > 0) {
      // Preserve content alongside tool calls (Finding #6 — SDK allows both)
      const textContent = typeof msg?.content === "string" ? msg.content : null;
      return {
        content: textContent, toolCalls: parsed,
        usage: { promptTokens: usage?.promptTokens ?? 0, completionTokens: usage?.completionTokens ?? 0 },
      };
    }
  }

  const content = typeof msg?.content === "string" ? sanitizeContent(msg.content) : "";
  return {
    content, toolCalls: null,
    usage: { promptTokens: usage?.promptTokens ?? 0, completionTokens: usage?.completionTokens ?? 0 },
  };
}
