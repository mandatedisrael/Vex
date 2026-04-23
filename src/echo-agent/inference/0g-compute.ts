/**
 * 0G Compute inference provider — raw HTTP fetch, OpenAI-compatible.
 *
 * Decentralized AI inference on the 0G Network.
 * Auth: HMAC broker signing per request.
 * Billing: on-chain ledger (0G token).
 * No streaming support — chatCompletionStream() falls back to non-streaming.
 *
 * Imports existing 0G Compute tooling from src/tools/0g-compute/ — no duplication.
 *
 * @see https://0g.ai
 */

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
  BALANCE_CACHE_TTL_MS,
  INFERENCE_SIMPLE_TIMEOUT_MS,
  INFERENCE_TIMEOUT_MS,
  INFERENCE_MAX_RETRIES,
  INFERENCE_BASE_DELAY_MS,
  INFERENCE_MAX_DELAY_MS,
  ZG_DEFAULT_ALERT_THRESHOLD,
} from "./config.js";

import { retryWithBackoff, isRetryableError } from "./resilience.js";
import { getAuthenticatedBroker } from "@tools/0g-compute/broker-factory.js";
import { getServiceMetadata, listChatServices, getLedgerBalance, getSubAccountBalance } from "@tools/0g-compute/operations.js";
import { loadComputeState } from "@tools/0g-compute/readiness.js";
import { calculateProviderPricing, formatPricePerMTokens } from "@tools/0g-compute/pricing.js";
import logger from "@utils/logger.js";
import type { OpenAIResponse } from "./0g-compute/mappers.js";
import { mapMessagesToOpenAI, parseOpenAIResponse } from "./0g-compute/mappers.js";

// ── Provider ─────────────────────────────────────────────────────

export class ZeroGComputeProvider implements InferenceProvider {
  readonly id = "0g-compute";
  readonly displayName = "0G Compute";

  private alertThreshold = ZG_DEFAULT_ALERT_THRESHOLD;
  private cachedBalance: ProviderBalance | null = null;
  private cachedBalanceAt = 0;
  /**
   * 0G service base URL (`metadata.endpoint` from `getServiceMetadata`).
   * Set by `loadConfig()`; consumed by `doFetch()` to build the chat-completions
   * URL. The on-chain provider address (`state.activeProvider`) is the broker
   * auth identifier — it is NOT a URL and must never be used to build one.
   */
  private endpoint: string | null = null;

  // ── loadConfig ──────────────────────────────────────────────────

  async loadConfig(): Promise<InferenceConfig | null> {
    const state = loadComputeState();
    if (!state) {
      logger.warn("inference.0g.no_compute_state", {
        hint: "Run 'echoclaw echo connect' first",
      });
      return null;
    }

    const env = loadEnvConfig();

    try {
      const broker = await getAuthenticatedBroker();
      const metadata = await getServiceMetadata(broker, state.activeProvider);
      this.endpoint = metadata.endpoint;

      let inputPricePerM = 1.0;
      let outputPricePerM = 3.2;

      try {
        const services = await listChatServices(broker);
        const svc = services.find(
          (s: { provider: string }) => s.provider.toLowerCase() === state.activeProvider.toLowerCase(),
        );
        if (svc) {
          inputPricePerM = parseFloat(formatPricePerMTokens(svc.inputPrice));
          outputPricePerM = parseFloat(formatPricePerMTokens(svc.outputPrice));
          const pricing = calculateProviderPricing(svc.inputPrice, svc.outputPrice);
          this.alertThreshold = pricing.recommendedAlertLockedOg;

          logger.info("inference.0g.pricing_loaded", {
            inputPricePerM,
            outputPricePerM,
            alertThreshold: this.alertThreshold,
          });
        }
      } catch {
        logger.warn("inference.0g.pricing_fallback", { inputPricePerM, outputPricePerM });
      }

      return {
        provider: this.id,
        model: state.model ?? metadata.model,
        contextLimit: env.contextLimit,
        // 0G does not support temperature — omitted
        maxOutputTokens: env.maxOutputTokens,
        inputPricePerM,
        outputPricePerM,
        priceCurrency: "0G",
        cachePricePerM: null,
        reasoningPricePerM: null,
      };
    } catch (err) {
      logger.error("inference.0g.config_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // ── chatCompletion (non-streaming, with tools) ──────────────────

  async chatCompletion(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
  ): Promise<InferenceResponse> {
    return retryWithBackoff(
      () => this.doFetch(messages, tools, config),
      {
        maxRetries: INFERENCE_MAX_RETRIES,
        baseDelayMs: INFERENCE_BASE_DELAY_MS,
        maxDelayMs: INFERENCE_MAX_DELAY_MS,
        jitter: true,
        shouldRetry: isRetryableError,
      },
      "0g-inference",
    );
  }

  // ── chatCompletionSimple (no tools) ─────────────────────────────

  async chatCompletionSimple(
    messages: ProviderMessage[],
    config: InferenceConfig,
  ): Promise<{ content: string; usage: InferenceUsage }> {
    const response = await retryWithBackoff(
      () => this.doFetch(messages, [], config),
      {
        maxRetries: INFERENCE_MAX_RETRIES,
        baseDelayMs: 1000,
      },
      "0g-simple",
    );

    return {
      content: response.content ?? "",
      usage: response.usage,
    };
  }

  // ── chatCompletionStream (fallback — 0G has no streaming) ───────

  async *chatCompletionStream(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
  ): AsyncGenerator<StreamChunk> {
    // 0G Compute does not support streaming with tool calling.
    // Fallback: non-streaming call, yield result as chunks.
    const response = await this.chatCompletion(messages, tools, config);

    if (response.content) {
      yield { type: "content", text: response.content };
    }

    if (response.toolCalls) {
      for (let i = 0; i < response.toolCalls.length; i++) {
        const tc = response.toolCalls[i];
        yield {
          type: "tool_call_delta",
          toolCallIndex: i,
          toolCallId: tc.id,
          toolCallName: tc.name,
          toolCallArgsDelta: JSON.stringify(tc.arguments),
        };
      }
    }

    yield { type: "usage", usage: response.usage };
    yield { type: "done" };
  }

  // ── getBalance ──────────────────────────────────────────────────

  async getBalance(): Promise<ProviderBalance | null> {
    const now = Date.now();
    if (this.cachedBalance && (now - this.cachedBalanceAt) < BALANCE_CACHE_TTL_MS) {
      return this.cachedBalance;
    }

    const state = loadComputeState();
    if (!state) return null;

    try {
      const broker = await getAuthenticatedBroker();
      const [ledger, subAccount] = await Promise.all([
        retryWithBackoff(
          () => getLedgerBalance(broker),
          { maxRetries: 2, baseDelayMs: 1000 },
          "0g-ledger",
        ),
        retryWithBackoff(
          () => getSubAccountBalance(broker, state.activeProvider),
          { maxRetries: 2, baseDelayMs: 1000 },
          "0g-sub-account",
        ),
      ]);

      if (!ledger) return null;

      const lockedOg = subAccount?.lockedOg ?? 0;
      const isLow = lockedOg < this.alertThreshold;

      this.cachedBalance = {
        available: lockedOg,
        currency: "0G",
        isLow,
        displayText: `${lockedOg.toFixed(4)} 0G`,
        total: ledger.totalOg,
        locked: lockedOg,
      };
      this.cachedBalanceAt = now;

      return this.cachedBalance;
    } catch (err) {
      logger.warn("inference.0g.balance_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.cachedBalance; // stale cache is better than nothing
    }
  }

  // ── calculateCost ───────────────────────────────────────────────

  calculateCost(usage: InferenceUsage, config: InferenceConfig): RequestCost {
    const promptCost = (usage.promptTokens / 1_000_000) * config.inputPricePerM;
    const completionCost = (usage.completionTokens / 1_000_000) * config.outputPricePerM;

    return {
      totalCost: promptCost + completionCost,
      currency: "0G",
      breakdown: {
        promptCost,
        completionCost,
        cachedSavings: 0,
        reasoningCost: 0,
      },
    };
  }

  // ── Private: raw fetch ──────────────────────────────────────────

  private async doFetch(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
  ): Promise<InferenceResponse> {
    const state = loadComputeState();
    if (!state) throw new Error("0G Compute state not available");

    const broker = await getAuthenticatedBroker();

    const body: Record<string, unknown> = {
      model: config.model,
      messages: mapMessagesToOpenAI(messages),
      max_tokens: config.maxOutputTokens,
      stream: false,
    };

    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const contentForAuth = JSON.stringify(body.messages);
    // allow: broker SDK returns `Record<string, unknown>` but the runtime
    // values are the HMAC header strings the 0G Compute API expects. A
    // typed SDK would remove this; tracked as follow-up in
    // `src/echo-agent/AUDIT_INVENTORY.md` (provider adapter rewrite).
    const authHeaders = await broker.inference.getRequestHeaders(
      state.activeProvider,
      contentForAuth,
    ) as unknown as Record<string, string>;

    if (!this.endpoint) {
      throw new Error(
        "0G Compute endpoint not loaded — call loadConfig() before chatCompletion()",
      );
    }
    const url = `${this.endpoint}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`0G Compute returned ${response.status}: ${errText.slice(0, 200)}`);
      }

      const json = await response.json() as OpenAIResponse;
      return parseOpenAIResponse(json);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }
}

