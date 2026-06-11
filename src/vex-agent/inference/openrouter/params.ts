import type { ChatRequest } from "@openrouter/sdk/models/chatrequest.js";
import type {
  InferenceConfig,
  ProviderMessage,
  ToolDefinition,
} from "../types.js";
import { normalizeToolSchemaForProvider } from "../schema-normalizer.js";
import { mapMessages } from "./mappers.js";

/**
 * Model families that require EXPLICIT `cache_control` breakpoints per the
 * OpenRouter prompt-caching docs (https://openrouter.ai/docs/features/prompt-caching):
 *
 * - Anthropic Claude: "cache_control breakpoints … Cache writes are charged
 *   at 1.25×/2× the input price; cache reads at 0.1×."
 * - Alibaba Qwen: explicit `cache_control` breakpoints, same mechanism.
 * - Google: IMPLICIT caching on Gemini 2.5 only — `google/` is deliberately
 *   NOT in this list (2.5 caches without markup; older models get nothing,
 *   which equals today's behavior).
 * - OpenAI / DeepSeek / Grok: automatic prefix caching, zero request markup.
 *
 * Closed prefix list by design: deriving the gate from
 * `cacheWritePricePerM !== null` was considered and rejected — the pricing
 * catalog can carry placeholders, while this 2-prefix list is predictable
 * and cheap to maintain. `cachePricePerM !== null` (read pricing present in
 * the `/models` catalog) remains the co-condition at the call site.
 */
const EXPLICIT_CACHE_MODEL_PREFIXES = ["anthropic/", "qwen/"] as const;

export function isExplicitCacheModel(model: string): boolean {
  return EXPLICIT_CACHE_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));
}

/**
 * F3 fallback activation switch (D-LIVETEST gate): when the live test shows
 * that a TRAILING turn-state system message costs Anthropic the history
 * cache, flip this to `true` to merge turn-state into the static system
 * message (`[static(+cache_control), turn-state]`) while RETAINING
 * breakpoint B on `history_tail`. Shipped `false` — the trailing shape is
 * the primary design; the merged shape is implemented + unit-tested so the
 * flip stays a one-line change after the livetest verdict.
 */
export const MERGE_TURN_STATE_FALLBACK_ENABLED = false;

export function buildOpenRouterParams(
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  config: InferenceConfig,
  stream: boolean,
): ChatRequest {
  // Breakpoints ONLY for explicit-cache model families AND when the catalog
  // reports cache-read pricing ("model supports cache" detection). Everything
  // else keeps today's exact request shape — zero markup for auto-prefix
  // providers and for models without cache pricing.
  const applyBreakpoints =
    isExplicitCacheModel(config.model) && config.cachePricePerM !== null;

  const params: ChatRequest = {
    model: config.model,
    messages: mapMessages(messages, {
      applyBreakpoints,
      mergeTurnStateIntoStaticPrefix:
        applyBreakpoints && MERGE_TURN_STATE_FALLBACK_ENABLED,
    }),
    maxTokens: config.maxOutputTokens,
    ...(config.temperature !== undefined && { temperature: config.temperature }),
    ...(stream && { stream: true }),
  };

  if (tools.length > 0) {
    params.tools = tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: normalizeToolSchemaForProvider(tool.function.parameters),
      },
    }));
    params.toolChoice = "auto";
  }

  return params;
}
