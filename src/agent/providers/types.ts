/**
 * Inference provider interface — contract for pluggable LLM backends.
 *
 * Each provider (0G Compute, OpenRouter, future) implements this interface.
 * Adding a new provider = one new file + one line in registry.ts.
 *
 * @see registry.ts for provider resolution logic
 * @see 0g-compute.ts and openrouter.ts for implementations
 */

import type { InferenceConfig, InferenceResponse, Message } from "../types.js";
import type { OpenAITool } from "../tool-registry.js";

// ── Provider balance ─────────────────────────────────────────────────

export interface ProviderBalance {
  /** Human-readable display string, e.g. "44.99 0G" or "$12.50 USD" */
  availableDisplay: string;
  /** Raw numeric value for comparisons and calculations */
  availableRaw: number;
  /** Currency code: "0G", "USD", etc. */
  currency: string;
  /** Whether the balance is below the provider's alert threshold */
  isLow: boolean;
  /** Optional human-readable message for low balance alerts */
  lowBalanceMessage?: string;
  /** Total balance (0G: ledger total, OpenRouter: total credits) */
  total?: number;
  /** Available balance (0G: ledger available, OpenRouter: remaining credits) */
  available?: number;
  /** Locked/committed balance (0G: provider sub-account, OpenRouter: n/a) */
  locked?: number;
}

// ── Provider interface ───────────────────────────────────────────────

export interface InferenceProvider {
  /** Unique provider identifier used in config and logs */
  readonly id: string;
  /** Human-readable name for UI display */
  readonly displayName: string;

  /**
   * Load inference configuration (model, endpoint, pricing).
   * Returns null if the provider is not configured or unavailable.
   */
  loadConfig(): Promise<InferenceConfig | null>;

  /**
   * Build auth headers for an inference request.
   * @param content — serialized message content for request signing (0G uses this, OpenRouter ignores it)
   */
  getAuthHeaders(content: string): Promise<Record<string, string>>;

  /**
   * Get current provider balance/credit state.
   * Returns null if the provider does not expose a balance API.
   */
  getBalance(): Promise<ProviderBalance | null>;

  /**
   * Build the full chat/completions URL for this provider.
   */
  getEndpoint(config: InferenceConfig): string;

  /**
   * Provider-native chat completion with tools (optional).
   * If implemented, inference.ts uses this instead of raw fetch.
   */
  chatCompletion?(messages: Message[], tools: OpenAITool[], config: InferenceConfig): Promise<InferenceResponse>;

  /**
   * Provider-native simple completion without tools (optional).
   * Used by compaction and session summary.
   */
  chatCompletionSimple?(messages: Message[], config: InferenceConfig): Promise<{ content: string; usage: { promptTokens: number; completionTokens: number } }>;
}
