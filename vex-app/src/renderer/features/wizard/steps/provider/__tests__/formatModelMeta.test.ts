import { describe, expect, it } from "vitest";
import type { ProviderModelOption } from "@shared/schemas/provider.js";
import { formatModelMeta, formatPrice } from "../formatModelMeta.js";

describe("model metadata formatting", () => {
  it.each([
    [0, "$0"],
    [0.0004, "$0.0004"],
    [0.005, "$0.005"],
    [0.01, "$0.01"],
    [3, "$3"],
    [15, "$15"],
  ])("formats %s per million as %s", (value, expected) => {
    expect(formatPrice(value)).toBe(expected);
  });

  it("shows context and whichever price sides are available", () => {
    const model: ProviderModelOption = {
      modelId: "vendor/model",
      displayName: "Model",
      providerId: "vendor",
      contextLength: 200_000,
      pricingInputPerMillion: 3,
      pricingOutputPerMillion: null,
    };
    expect(formatModelMeta(model)).toBe("200k ctx · $3 in per 1M");
    expect(
      formatModelMeta({
        ...model,
        pricingInputPerMillion: null,
        pricingOutputPerMillion: 15,
      }),
    ).toBe("200k ctx · $15 out per 1M");
  });
});
