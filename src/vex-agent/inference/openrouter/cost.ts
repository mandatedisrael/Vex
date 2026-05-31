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

  let cachedSavings = 0;
  if (
    config.cachePricePerM !== null &&
    usage.cachedTokens &&
    usage.cachedTokens > 0
  ) {
    const standardCost = (usage.cachedTokens / 1_000_000) * config.inputPricePerM;
    const cacheCost = (usage.cachedTokens / 1_000_000) * config.cachePricePerM;
    cachedSavings = standardCost - cacheCost;
  }

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
