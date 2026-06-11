/**
 * OpenRouter request-cost computation (pure).
 *
 * Extracted from `OpenRouterProvider.calculateCost` so the real logic is unit
 * testable without instantiating the provider (which needs env/API config).
 *
 * Trust model: OpenRouter returns an authoritative `usage.cost` (USD) on every
 * response. We PREFER that value when it is a finite, non-negative number
 * (`0` is valid for free models). Otherwise — unreported, null, NaN/Infinity,
 * or negative — we fall back to the local price-table estimate derived from the
 * cached `/models` pricing. The breakdown is always the local estimate and is
 * informational only; `totalCost` is the value we trust and persist.
 */

import type { InferenceConfig, InferenceUsage, RequestCost } from "../types.js";

export function computeRequestCost(
  usage: InferenceUsage,
  config: InferenceConfig,
): RequestCost {
  const promptCost = (usage.promptTokens / 1_000_000) * config.inputPricePerM;
  const completionCost =
    (usage.completionTokens / 1_000_000) * config.outputPricePerM;

  // NET cache savings with PER-TERM null-gating: read savings require only
  // the cache-READ price; the write surcharge requires only the cache-WRITE
  // price. Auto-prefix-cache providers (OpenAI/DeepSeek/Gemini) report
  // cachedTokens but have no write price (and never report cacheWriteTokens)
  // — they must still get their POSITIVE read savings; a missing write price
  // NEVER suppresses them. Net can be NEGATIVE (write-heavy first request of
  // an explicit-cache prefix) — recorded truthfully.
  let readSavings = 0;
  if (
    config.cachePricePerM !== null &&
    usage.cachedTokens &&
    usage.cachedTokens > 0
  ) {
    const standardCost = (usage.cachedTokens / 1_000_000) * config.inputPricePerM;
    const cacheCost = (usage.cachedTokens / 1_000_000) * config.cachePricePerM;
    readSavings = standardCost - cacheCost;
  }

  let writeSurcharge = 0;
  if (
    config.cacheWritePricePerM !== null &&
    usage.cacheWriteTokens &&
    usage.cacheWriteTokens > 0
  ) {
    const standardCost =
      (usage.cacheWriteTokens / 1_000_000) * config.inputPricePerM;
    const writeCost =
      (usage.cacheWriteTokens / 1_000_000) * config.cacheWritePricePerM;
    writeSurcharge = writeCost - standardCost;
  }

  const cachedSavings = readSavings - writeSurcharge;

  let reasoningCost = 0;
  if (
    config.reasoningPricePerM !== null &&
    usage.reasoningTokens &&
    usage.reasoningTokens > 0
  ) {
    const standardCost =
      (usage.reasoningTokens / 1_000_000) * config.outputPricePerM;
    const actualCost =
      (usage.reasoningTokens / 1_000_000) * config.reasoningPricePerM;
    reasoningCost = actualCost - standardCost;
  }

  // INTENTIONAL coupling (pinned by tests): `cachedSavings` is now NET
  // (read savings − write surcharge), so the fallback estimate absorbs the
  // write surcharge here. Only the fallback changes — `totalCost` still
  // prefers the authoritative `usage.cost`. Correct because OpenRouter's
  // `prompt_tokens` already INCLUDES cached and cache-write tokens.
  const localTotal = promptCost + completionCost - cachedSavings + reasoningCost;

  // Prefer the provider's authoritative cost when it is a finite, non-negative
  // number; `0` is a legitimate cost (free models). Anything else falls back to
  // the local estimate so a missing/garbage value never shows as $0.
  const useApiCost =
    typeof usage.cost === "number" &&
    Number.isFinite(usage.cost) &&
    usage.cost >= 0;
  const totalCost = useApiCost ? (usage.cost as number) : localTotal;

  return {
    totalCost,
    currency: "USD",
    breakdown: { promptCost, completionCost, cachedSavings, reasoningCost },
  };
}
