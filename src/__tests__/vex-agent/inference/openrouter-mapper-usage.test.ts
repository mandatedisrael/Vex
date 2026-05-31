import { describe, it, expect } from "vitest";
import { extractUsage } from "../../../vex-agent/inference/openrouter/mappers.js";

/**
 * extractUsage — maps the SDK `ChatUsage` (or undefined) to the internal
 * `InferenceUsage`, now including the authoritative `usage.cost`.
 */
describe("extractUsage", () => {
  it("reads the authoritative cost + cached/reasoning detail from the SDK usage", () => {
    const usage = extractUsage({
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      cost: 0.0021,
      promptTokensDetails: { cachedTokens: 30 },
      completionTokensDetails: { reasoningTokens: 12 },
    });
    expect(usage).toEqual({
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      cachedTokens: 30,
      reasoningTokens: 12,
      cost: 0.0021,
    });
  });

  it("leaves cost (and detail fields) undefined when the provider omits them", () => {
    const usage = extractUsage({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(usage.cost).toBeUndefined();
    expect(usage.cachedTokens).toBeUndefined();
    expect(usage.reasoningTokens).toBeUndefined();
  });

  it("coerces an explicit null cost to undefined (unknown, not $0)", () => {
    const usage = extractUsage({
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      cost: null,
    });
    expect(usage.cost).toBeUndefined();
  });

  it("keeps a reported cost of 0 (free model)", () => {
    const usage = extractUsage({
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      cost: 0,
    });
    expect(usage.cost).toBe(0);
  });

  it("defaults all counts to 0 for an absent usage object", () => {
    const usage = extractUsage(undefined);
    expect(usage.promptTokens).toBe(0);
    expect(usage.completionTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
    expect(usage.cost).toBeUndefined();
  });
});
