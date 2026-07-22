/**
 * S6/D6 — reasoning param gating in `buildOpenRouterParams`.
 *
 * BEHAVIOR CHANGE (by decree, D6): the engine no longer injects a forced
 * "medium" default for reasoning-capable models. Codex's live-catalog
 * evidence (`moonshotai/kimi-k3` advertises only max/high/low) showed an
 * unconditional default risked sending an UNADVERTISED effort. The new
 * contract, pinned below:
 *
 *   - `reasoning.effort` is sent ONLY when BOTH an explicit per-turn
 *     `config.reasoningEffort` is present AND `config.supportsReasoningEffort`
 *     is true (from the catalog's `reasoning_effort` parameter tag) —
 *     independent of `reasoningPricePerM` (pricing-only now).
 *   - No explicit effort → NO reasoning param at all, regardless of
 *     capability — the provider's own model default applies.
 *   - An explicit effort on a model that does NOT advertise
 *     `reasoning_effort` is dropped, never sent.
 *   - An explicit `"none"` is sent VERBATIM (not treated as omission).
 *   - `"max"` (absent from the installed SDK's 6-value `ChatRequestEffort`)
 *     maps through `toChatRequestEffort` via the SDK's public
 *     `unrecognized()` OpenEnum escape hatch.
 */

import { describe, it, expect } from "vitest";
import {
  buildOpenRouterParams,
  toChatRequestEffort,
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
    supportsReasoningEffort: false,
    ...overrides,
  };
}

const MESSAGES: ProviderMessage[] = [
  { role: "system", content: "STATIC", cacheHint: "static_prefix" },
  { role: "user", content: "hello" },
];

describe("toChatRequestEffort (D2 SDK adapter)", () => {
  it("passes the 6 SDK-native values through verbatim", () => {
    for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh"] as const) {
      expect(toChatRequestEffort(effort)).toBe(effort);
    }
  });

  it('maps "max" via the SDK\'s public unrecognized() OpenEnum escape hatch', () => {
    // `unrecognized()` returns the same string value at runtime (branded
    // only at the type level) — assert the wire value is still "max".
    expect(toChatRequestEffort("max")).toBe("max");
  });
});

describe("buildOpenRouterParams — reasoning gating (S6/D6)", () => {
  it("sends NO reasoning param when the model supports it but no explicit effort was chosen", () => {
    const params = buildOpenRouterParams(
      MESSAGES,
      [],
      makeConfig({ supportsReasoningEffort: true, reasoningPricePerM: 15 }),
      false,
    );
    expect("reasoning" in params).toBe(false);
  });

  it("sends NO reasoning param for an explicit effort when the model does NOT advertise reasoning_effort", () => {
    const params = buildOpenRouterParams(
      MESSAGES,
      [],
      makeConfig({ supportsReasoningEffort: false, reasoningEffort: "high" }),
      false,
    );
    expect("reasoning" in params).toBe(false);
  });

  it("sends the explicit effort verbatim when the model advertises reasoning_effort", () => {
    for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
      const params = buildOpenRouterParams(
        MESSAGES,
        [],
        makeConfig({ supportsReasoningEffort: true, reasoningEffort: effort }),
        true,
      );
      expect(params.reasoning).toEqual({ effort: toChatRequestEffort(effort) });
    }
  });

  it('sends explicit "none" verbatim rather than omitting the param', () => {
    const params = buildOpenRouterParams(
      MESSAGES,
      [],
      makeConfig({ supportsReasoningEffort: true, reasoningEffort: "none" }),
      false,
    );
    expect(params.reasoning).toEqual({ effort: "none" });
  });

  it("reasoningPricePerM does not gate the param at all — capability-present/pricing-null still sends", () => {
    const params = buildOpenRouterParams(
      MESSAGES,
      [],
      makeConfig({
        supportsReasoningEffort: true,
        reasoningEffort: "high",
        reasoningPricePerM: null,
      }),
      false,
    );
    expect(params.reasoning).toEqual({ effort: "high" });
  });

  it("reasoningPricePerM being non-null does not send a param on its own (no explicit effort)", () => {
    const params = buildOpenRouterParams(
      MESSAGES,
      [],
      makeConfig({ supportsReasoningEffort: true, reasoningPricePerM: 15 }),
      false,
    );
    expect("reasoning" in params).toBe(false);
  });

  it("omits reasoning for a non-advertising model even with a stale per-turn effort set", () => {
    // A stale per-turn effort (e.g. model switched between turns) must not
    // change a non-advertising model's request shape.
    const params = buildOpenRouterParams(
      MESSAGES,
      [],
      makeConfig({ supportsReasoningEffort: false, reasoningEffort: "high" }),
      true,
    );
    expect("reasoning" in params).toBe(false);
  });

  it("keeps reasoning gating independent of streaming mode", () => {
    const streaming = buildOpenRouterParams(
      MESSAGES,
      [],
      makeConfig({ supportsReasoningEffort: true, reasoningEffort: "high" }),
      true,
    );
    expect(streaming.reasoning).toEqual({ effort: "high" });
    expect(streaming.stream).toBe(true);
  });
});
