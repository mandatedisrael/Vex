import { describe, it, expect } from "vitest";
import type { InferenceConfig, InferenceUsage, RequestCost } from "../../../vex-agent/inference/types.js";

/**
 * Cost calculation tests — verify pricing logic without instantiating providers.
 * Tests the pure calculation functions extracted from provider implementations.
 */

// ── Extracted cost logic (mirrors provider.calculateCost) ────────

function calculateOpenRouterCost(usage: InferenceUsage, config: InferenceConfig): RequestCost {
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
  return { totalCost, currency: "USD", breakdown: { promptCost, completionCost, cachedSavings, reasoningCost } };
}

// ── OpenRouter cost tests ────────────────────────────────────────

describe("OpenRouter cost calculation", () => {
  const baseConfig: InferenceConfig = {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
    contextLimit: 128_000,
    maxOutputTokens: 16384,
    inputPricePerM: 3.0,       // $3/M input
    outputPricePerM: 15.0,     // $15/M output
    priceCurrency: "USD",
    cachePricePerM: 0.3,       // $0.30/M cached (90% cheaper)
    reasoningPricePerM: 15.0,  // same as output for this model
  };

  it("calculates basic prompt + completion cost", () => {
    const usage: InferenceUsage = {
      promptTokens: 10_000,
      completionTokens: 2_000,
      totalTokens: 12_000,
    };
    const cost = calculateOpenRouterCost(usage, baseConfig);

    expect(cost.breakdown.promptCost).toBeCloseTo(0.03);     // 10K * $3/M
    expect(cost.breakdown.completionCost).toBeCloseTo(0.03);  // 2K * $15/M
    expect(cost.totalCost).toBeCloseTo(0.06);
    expect(cost.currency).toBe("USD");
  });

  it("accounts for cached token savings", () => {
    const usage: InferenceUsage = {
      promptTokens: 10_000,
      completionTokens: 1_000,
      totalTokens: 11_000,
      cachedTokens: 5_000,  // half of prompt was cached
    };
    const cost = calculateOpenRouterCost(usage, baseConfig);

    // Savings: 5K tokens * ($3 - $0.30) / 1M = 5K * $2.70 / 1M = $0.0135
    expect(cost.breakdown.cachedSavings).toBeCloseTo(0.0135);
    // Total: promptCost + completionCost - savings
    const expectedTotal = 0.03 + 0.015 - 0.0135;
    expect(cost.totalCost).toBeCloseTo(expectedTotal);
  });

  it("accounts for reasoning token surcharge", () => {
    const configWithExpensiveReasoning: InferenceConfig = {
      ...baseConfig,
      reasoningPricePerM: 60.0, // $60/M reasoning (4x output)
    };
    const usage: InferenceUsage = {
      promptTokens: 5_000,
      completionTokens: 3_000,
      totalTokens: 8_000,
      reasoningTokens: 1_000,
    };
    const cost = calculateOpenRouterCost(usage, configWithExpensiveReasoning);

    // Reasoning surcharge: 1K * ($60 - $15) / 1M = $0.045
    expect(cost.breakdown.reasoningCost).toBeCloseTo(0.045);
    expect(cost.totalCost).toBeGreaterThan(cost.breakdown.promptCost + cost.breakdown.completionCost);
  });

  it("handles zero usage", () => {
    const usage: InferenceUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const cost = calculateOpenRouterCost(usage, baseConfig);
    expect(cost.totalCost).toBe(0);
  });

  it("handles null cache/reasoning prices (no adjustment)", () => {
    const configNoPricing: InferenceConfig = {
      ...baseConfig,
      cachePricePerM: null,
      reasoningPricePerM: null,
    };
    const usage: InferenceUsage = {
      promptTokens: 10_000,
      completionTokens: 2_000,
      totalTokens: 12_000,
      cachedTokens: 5_000,
      reasoningTokens: 500,
    };
    const cost = calculateOpenRouterCost(usage, configNoPricing);

    expect(cost.breakdown.cachedSavings).toBe(0);
    expect(cost.breakdown.reasoningCost).toBe(0);
    expect(cost.totalCost).toBeCloseTo(0.06);
  });
});
