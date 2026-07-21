import type { ChatRequest, ChatRequestEffort } from "@openrouter/sdk/models/chatrequest.js";
import { unrecognized } from "@openrouter/sdk/types";
import type {
  InferenceConfig,
  ProviderMessage,
  ReasoningEffort,
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

/**
 * Adapt Vex's own 7-value `ReasoningEffort` to the SDK's `ChatRequestEffort`
 * OpenEnum. The installed SDK (0.12.79) does not type a "max" member —
 * OpenRouter's live API added it ahead of the pinned SDK's types (verified
 * against the installed package) — so "max" is passed through the SDK's
 * own public `unrecognized()` escape hatch (`ChatRequestEffort` is an
 * OpenEnum: unknown values forward to the wire unchanged). Every other
 * value is already a literal member of `ChatRequestEffort` — no cast.
 */
export function toChatRequestEffort(effort: ReasoningEffort): ChatRequestEffort {
  return effort === "max" ? unrecognized<string>("max") : effort;
}

export function buildOpenRouterParams(
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  config: InferenceConfig,
  stream: boolean,
  responseFormat?: ChatRequest["responseFormat"],
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
    // D6: send `reasoning.effort` ONLY when the operator made an EXPLICIT
    // per-turn choice AND the model advertises the `reasoning_effort`
    // parameter. No explicit choice → no reasoning param at all — the
    // provider's own model default applies (the forced "medium" fallback is
    // retired; an unconditional default risked sending an unadvertised
    // effort to models with a narrower advertised set). Explicit "none" is
    // sent verbatim, not treated as omission.
    ...(config.reasoningEffort !== undefined &&
      config.supportsReasoningEffort && {
        reasoning: { effort: toChatRequestEffort(config.reasoningEffort) },
      }),
    // API-level output-format enforcement (F31 Layer B). Omitted by default so
    // every caller that passes nothing keeps a byte-identical wire request.
    ...(responseFormat !== undefined && { responseFormat }),
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
