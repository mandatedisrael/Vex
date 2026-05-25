import { describe, expect, it } from "vitest";
import {
  modelOptionDtoSchema,
  modelsListAvailableInputSchema,
  modelsListAvailableResultSchema,
  modelsListSourceSchema,
} from "../models.js";

describe("models schemas", () => {
  it("modelsListSourceSchema accepts env-derived and unconfigured sources", () => {
    expect(modelsListSourceSchema.safeParse("global_default").success).toBe(true);
    expect(modelsListSourceSchema.safeParse("unconfigured").success).toBe(true);
  });

  it("modelsListSourceSchema rejects direct OpenRouter catalogue source", () => {
    expect(modelsListSourceSchema.safeParse("openrouter").success).toBe(false);
  });

  it("modelOptionDtoSchema allows nullable pricing and context metadata", () => {
    const parsed = modelOptionDtoSchema.safeParse({
      providerId: "openrouter",
      modelId: "anthropic/claude-opus-4.7",
      displayName: "Claude Opus 4.7",
      brand: "openrouter",
      contextLength: null,
      pricingInputPerMillion: null,
      pricingOutputPerMillion: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("modelsListAvailableInputSchema accepts an empty object", () => {
    expect(modelsListAvailableInputSchema.safeParse({}).success).toBe(true);
  });

  it("modelsListAvailableResultSchema accepts unconfigured shape", () => {
    expect(
      modelsListAvailableResultSchema.safeParse({
        source: "unconfigured",
        models: [],
        fetchedAt: null,
      }).success,
    ).toBe(true);
  });

  it("modelsListAvailableResultSchema accepts a single env-derived option", () => {
    expect(
      modelsListAvailableResultSchema.safeParse({
        source: "global_default",
        models: [
          {
            providerId: "openrouter",
            modelId: "anthropic/claude-opus-4.7",
            displayName: "anthropic/claude-opus-4.7",
            brand: "openrouter",
            contextLength: null,
            pricingInputPerMillion: null,
            pricingOutputPerMillion: null,
          },
        ],
        fetchedAt: null,
      }).success,
    ).toBe(true);
  });
});
