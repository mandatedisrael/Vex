/**
 * Inference layer types — shared contract for all providers.
 *
 * Provider-agnostic: no DB, no engine, no transport details.
 * Every provider maps to these types.
 */

import type { JsonSchema } from "../tools/types.js";

// ── Provider config (loaded once at startup) ─────────────────────

export interface InferenceConfig {
  /** Provider identifier, e.g. "openrouter". */
  provider: string;
  /** Model ID, e.g. "anthropic/claude-sonnet-4" */
  model: string;
  /** Context window size in tokens — from AGENT_CONTEXT_LIMIT env */
  contextLimit: number;
  /** Sampling temperature. */
  temperature?: number;
  /** Max output tokens per response — from AGENT_MAX_OUTPUT_TOKENS env */
  maxOutputTokens: number;
  /** Price per 1M input tokens. */
  inputPricePerM: number;
  /** Price per 1M output tokens. */
  outputPricePerM: number;
  /** Pricing currency */
  priceCurrency: PriceCurrency;
  /** Price per 1M cached input tokens, when reported by the provider. */
  cachePricePerM: number | null;
  /** Price per 1M reasoning tokens, when reported by the provider. */
  reasoningPricePerM: number | null;
}

export type PriceCurrency = "USD";

// ── Per-request usage ────────────────────────────────────────────

export interface InferenceUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Cached input tokens (OpenRouter) — reduces prompt cost */
  cachedTokens?: number;
  /** Reasoning tokens (OpenRouter extended thinking) — separate pricing */
  reasoningTokens?: number;
  /**
   * Authoritative per-request cost reported by the provider (OpenRouter
   * `usage.cost`, USD). Present on every response now that usage accounting
   * is always-on; `null`/`undefined` when the provider did not report it, in
   * which case cost falls back to the local price-table estimate. Never
   * forwarded to the renderer stream preview (stripped at the stream bridge).
   */
  cost?: number | null;
}

// ── Tool calling ─────────────────────────────────────────────────

export interface ParsedToolCall {
  /** Tool call ID — must be preserved for round-trip with provider */
  id: string;
  /** Function name */
  name: string;
  /** Parsed arguments object */
  arguments: Record<string, unknown>;
}

// ── Inference response (non-streaming) ───────────────────────────

export interface InferenceResponse {
  /** Text content — null when tool calls returned */
  content: string | null;
  /** Tool calls — null when text returned */
  toolCalls: ParsedToolCall[] | null;
  /** Token usage from this request */
  usage: InferenceUsage;
  /** Reasoning output (OpenRouter extended thinking) */
  reasoning?: string | null;
}

// ── Streaming chunk ──────────────────────────────────────────────

export type StreamChunkType =
  | "content"
  | "tool_call_delta"
  | "reasoning"
  | "usage"
  | "error"
  | "done";

export interface StreamChunk {
  type: StreamChunkType;

  // content
  text?: string;

  // tool_call_delta — streamed incrementally by index
  toolCallIndex?: number;
  toolCallId?: string;
  toolCallName?: string;
  toolCallArgsDelta?: string;

  // reasoning
  reasoningText?: string;

  // usage (final chunk)
  usage?: InferenceUsage;

  // error
  errorMessage?: string;
  errorCode?: number;
}

// ── Provider balance ─────────────────────────────────────────────

export interface ProviderBalance {
  /** Available balance for inference */
  available: number;
  /** Balance currency */
  currency: PriceCurrency;
  /** Whether below alert threshold */
  isLow: boolean;
  /** Human-readable display string, e.g. "$12.50 USD". */
  displayText: string;
  /** Total balance (credits purchased or ledger total) */
  total?: number;
  /** Daily usage — OpenRouter only */
  usageDaily?: number;
  /** Monthly usage — OpenRouter only */
  usageMonthly?: number;
}

// ── Request cost breakdown ───────────────────────────────────────

export interface RequestCost {
  /** Total cost for this request */
  totalCost: number;
  /** Cost currency */
  currency: PriceCurrency;
  /** Detailed breakdown */
  breakdown: {
    /** Cost for prompt tokens (standard rate) */
    promptCost: number;
    /** Cost for completion tokens (standard rate) */
    completionCost: number;
    /** Amount saved due to cached tokens (positive = savings) */
    cachedSavings: number;
    /** Additional cost for reasoning tokens above standard completion rate */
    reasoningCost: number;
  };
}

// ── Messages (provider-agnostic) ─────────────────────────────────

export type ProviderMessageRole = "system" | "user" | "assistant" | "tool";

export interface ProviderMessage {
  role: ProviderMessageRole;
  content: string;
  /** For tool result messages: links back to the tool call */
  toolCallId?: string;
  /** For assistant messages: tool calls made in this turn */
  toolCalls?: ProviderToolCallRef[];
}

export interface ProviderToolCallRef {
  id: string;
  command: string;
  args: Record<string, unknown>;
}

// ── Tool definition (OpenAI-compatible) ──────────────────────────

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    /**
     * OpenAI-compatible JSON Schema. Strictly typed via `JsonSchema` rather
     * than `Record<string, unknown>` so engine-side `toToolDefinitions`
     * and subagent runner don't need `as unknown as Record<...>` casts.
     * Providers pass this through to the upstream API unchanged.
     */
    parameters: JsonSchema;
  };
}

// ── Provider interface ───────────────────────────────────────────

export interface InferenceProvider {
  readonly id: string;
  readonly displayName: string;

  /**
   * Load inference configuration (model, pricing, context limit).
   *
   * Called per turn but expected to cache: a successful fetch is reused for a
   * provider-defined TTL, refreshed on demand after the TTL, and may be served
   * stale on a transient metadata failure. Returns null when the model is absent from
   * the provider catalog (misconfig/delisting) or when the very first fetch
   * fails (no last-good to fall back on). The returned object is owned by the
   * caller — implementations must not hand out a shared mutable reference.
   */
  loadConfig(): Promise<InferenceConfig | null>;

  /**
   * Non-streaming chat completion with tool calling.
   * Used by: inference loop (tool calling round-trip).
   */
  chatCompletion(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
  ): Promise<InferenceResponse>;

  /**
   * Simple non-streaming completion without tools.
   * Used by: compaction, session summary, Vex Papa.
   */
  chatCompletionSimple(
    messages: ProviderMessage[],
    config: InferenceConfig,
  ): Promise<{ content: string; usage: InferenceUsage }>;

  /**
   * Streaming chat completion with tool calling.
   * Used by: UI chat (text deltas + tool call deltas).
   *
   * `signal` (Stage 9-5a) cancels the in-flight HTTP stream for chat-turn
   * "stop generating". When omitted, the stream runs to completion as before.
   */
  chatCompletionStream(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk>;

  /**
   * Get current provider balance/credit state.
   * Returns null if provider doesn't expose balance.
   */
  getBalance(): Promise<ProviderBalance | null>;

  /**
   * Calculate cost for a single request using provider-specific pricing.
   * Accounts for provider-specific cache and reasoning pricing.
   */
  calculateCost(usage: InferenceUsage, config: InferenceConfig): RequestCost;
}
