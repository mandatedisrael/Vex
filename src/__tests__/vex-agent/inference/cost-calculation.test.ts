import { describe, it, expect } from "vitest";
import type { InferenceConfig, InferenceUsage } from "../../../vex-agent/inference/types.js";
import { computeRequestCost } from "../../../vex-agent/inference/openrouter/cost.js";

/**
 * Cost calculation tests — exercise the REAL `computeRequestCost` pure function
 * (previously a local mirror, which gave false confidence). Covers the local
 * price-table math plus the authoritative-cost preference (OpenRouter
 * `usage.cost`).
 */

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
    const cost = computeRequestCost(usage, baseConfig);

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
    const cost = computeRequestCost(usage, baseConfig);

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
    const cost = computeRequestCost(usage, configWithExpensiveReasoning);

    // Reasoning surcharge: 1K * ($60 - $15) / 1M = $0.045
    expect(cost.breakdown.reasoningCost).toBeCloseTo(0.045);
    expect(cost.totalCost).toBeGreaterThan(cost.breakdown.promptCost + cost.breakdown.completionCost);
  });

  it("handles zero usage", () => {
    const usage: InferenceUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const cost = computeRequestCost(usage, baseConfig);
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
    const cost = computeRequestCost(usage, configNoPricing);

    expect(cost.breakdown.cachedSavings).toBe(0);
    expect(cost.breakdown.reasoningCost).toBe(0);
    expect(cost.totalCost).toBeCloseTo(0.06);
  });
});

describe("computeRequestCost — authoritative SDK cost preference", () => {
  const config: InferenceConfig = {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
    contextLimit: 128_000,
    maxOutputTokens: 16384,
    inputPricePerM: 3.0,
    outputPricePerM: 15.0,
    priceCurrency: "USD",
    cachePricePerM: 0.3,
    reasoningPricePerM: 15.0,
  };
  // Local estimate for this usage = promptCost 0.03 + completionCost 0.03 = 0.06.
  const baseUsage: InferenceUsage = {
    promptTokens: 10_000,
    completionTokens: 2_000,
    totalTokens: 12_000,
  };

  it("prefers the provider's authoritative cost when finite and non-negative", () => {
    const cost = computeRequestCost({ ...baseUsage, cost: 0.123 }, config);
    expect(cost.totalCost).toBe(0.123);
    // Breakdown stays the local estimate (informational only).
    expect(cost.breakdown.promptCost).toBeCloseTo(0.03);
  });

  it("uses a reported cost of 0 (free model), not the local estimate", () => {
    expect(computeRequestCost({ ...baseUsage, cost: 0 }, config).totalCost).toBe(0);
  });

  it("falls back to the local estimate when cost is null/undefined/absent", () => {
    expect(
      computeRequestCost({ ...baseUsage, cost: null }, config).totalCost,
    ).toBeCloseTo(0.06);
    expect(
      computeRequestCost({ ...baseUsage, cost: undefined }, config).totalCost,
    ).toBeCloseTo(0.06);
    expect(computeRequestCost(baseUsage, config).totalCost).toBeCloseTo(0.06);
  });

  it("falls back to the local estimate for negative or non-finite cost", () => {
    expect(
      computeRequestCost({ ...baseUsage, cost: -1 }, config).totalCost,
    ).toBeCloseTo(0.06);
    expect(
      computeRequestCost({ ...baseUsage, cost: Number.NaN }, config).totalCost,
    ).toBeCloseTo(0.06);
    expect(
      computeRequestCost(
        { ...baseUsage, cost: Number.POSITIVE_INFINITY },
        config,
      ).totalCost,
    ).toBeCloseTo(0.06);
  });
});
