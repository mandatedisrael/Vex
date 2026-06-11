/**
 * S6 — reasoning param gating in `buildOpenRouterParams`.
 *
 * Contract under pin:
 *   - reasoning-capable model (catalog reports `internalReasoning` pricing →
 *     `reasoningPricePerM !== null`) → every request carries
 *     `reasoning: { effort }`, defaulting to "medium";
 *   - an explicit per-turn `config.reasoningEffort` is honoured;
 *   - a model WITHOUT reasoning pricing NEVER gets a `reasoning` key — even
 *     when a (stale) `reasoningEffort` is set — so the request shape and the
 *     cost of non-reasoning models is byte-identical to before S6.
 */

import { describe, it, expect } from "vitest";
import {
  buildOpenRouterParams,
  DEFAULT_REASONING_EFFORT,
} from "../../../vex-agent/inference/openrouter/params.js";
import type {
  InferenceConfig,
  ProviderMessage,
} from "../../../vex-agent/inference/types.js";

function makeConfig(overrides: Partial<InferenceConfig> = {}): InferenceConfig {
  return {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
    contextLimit: 128_000,
    maxOutputTokens: 4096,
    inputPricePerM: 3,
    outputPricePerM: 15,
    priceCurrency: "USD",
    cachePricePerM: null,
    cacheWritePricePerM: null,
    reasoningPricePerM: null,
    ...overrides,
  };
}

const MESSAGES: ProviderMessage[] = [
  { role: "system", content: "STATIC", cacheHint: "static_prefix" },
  { role: "user", content: "hello" },
];

describe("buildOpenRouterParams — reasoning gating (S6)", () => {
  it("includes reasoning at the default effort when the model supports it", () => {
    const params = buildOpenRouterParams(
      MESSAGES,
      [],
      makeConfig({ reasoningPricePerM: 15 }),
      false,
    );
    expect(params.reasoning).toEqual({ effort: "medium" });
    expect(DEFAULT_REASONING_EFFORT).toBe("medium");
  });

  it("honours an explicit per-turn effort on a supported model", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      const params = buildOpenRouterParams(
        MESSAGES,
        [],
        makeConfig({ reasoningPricePerM: 15, reasoningEffort: effort }),
        true,
      );
      expect(params.reasoning).toEqual({ effort });
    }
  });

  it("omits the reasoning key entirely when the model lacks reasoning pricing", () => {
    const params = buildOpenRouterParams(MESSAGES, [], makeConfig(), false);
    expect("reasoning" in params).toBe(false);
  });

  it("omits reasoning for unsupported models even when an effort is set", () => {
    // A stale per-turn effort (e.g. model switched between turns) must not
    // change a non-reasoning model's request shape.
    const params = buildOpenRouterParams(
      MESSAGES,
      [],
      makeConfig({ reasoningPricePerM: null, reasoningEffort: "high" }),
      true,
    );
    expect("reasoning" in params).toBe(false);
  });

  it("keeps reasoning independent of streaming mode", () => {
    const streaming = buildOpenRouterParams(
      MESSAGES,
      [],
      makeConfig({ reasoningPricePerM: 15 }),
      true,
    );
    expect(streaming.reasoning).toEqual({ effort: "medium" });
    expect(streaming.stream).toBe(true);
  });
});
