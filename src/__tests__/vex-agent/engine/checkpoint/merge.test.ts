/**
 * Prompt assertions for the rolling-summary merge step.
 *
 * Post-PR2 (migration 008) the summarizer output language is conditional on
 * the session's persisted `memory_language_code`:
 *   - null / "und" → picks dominant language of the archived conversation
 *   - "en" / "pl" / ... → pinned to that language
 *
 * The pre-PR2 English-only invariant is gone. Session memory (summary +
 * episodes) is multilingual; knowledge entries stay English-only and
 * translation happens at promotion (PR4), not per-turn.
 */

import { describe, it, expect } from "vitest";

import { summarizePrefix } from "@vex-agent/engine/checkpoint/merge.js";
import type { MessageWithId } from "@vex-agent/db/repos/messages.js";
import type {
  InferenceConfig,
  InferenceProvider,
  InferenceUsage,
  ProviderMessage,
  RequestCost,
} from "@vex-agent/inference/types.js";

const TEST_CONFIG: InferenceConfig = {
  provider: "test",
  model: "test-model",
  contextLimit: 1000,
  maxOutputTokens: 256,
  inputPricePerM: 0,
  outputPricePerM: 0,
  priceCurrency: "USD",
  cachePricePerM: null,
  reasoningPricePerM: null,
};

const ZERO_USAGE: InferenceUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

const ZERO_COST: RequestCost = {
  totalCost: 0,
  currency: "USD",
  breakdown: {
    promptCost: 0,
    completionCost: 0,
    cachedSavings: 0,
    reasoningCost: 0,
  },
};

function msg(id: number, role: MessageWithId["role"], content: string): MessageWithId {
  return {
    id,
    role,
    content,
    timestamp: `2026-04-17T00:00:${String(id).padStart(2, "0")}Z`,
  };
}

function makeSimpleProvider(contents: readonly string[]): {
  provider: InferenceProvider;
  seen: ProviderMessage[][];
} {
  let callIndex = 0;
  const seen: ProviderMessage[][] = [];

  return {
    seen,
    provider: {
      id: "test",
      displayName: "Test provider",
      async loadConfig() {
        return TEST_CONFIG;
      },
      async chatCompletion() {
        return { content: null, toolCalls: null, usage: ZERO_USAGE };
      },
      async chatCompletionSimple(messages: ProviderMessage[]) {
        seen.push(messages);
        const content = contents[callIndex] ?? contents[contents.length - 1] ?? "";
        callIndex++;
        return { content, usage: ZERO_USAGE };
      },
      async *chatCompletionStream() {
        return;
      },
      async getBalance() {
        return null;
      },
      calculateCost() {
        return ZERO_COST;
      },
    },
  };
}

async function captureSummarizePrompt(currentCode: string | null): Promise<string> {
  const { provider, seen } = makeSimpleProvider(["summary"]);
  await summarizePrefix(
    [msg(1, "user", "cześć"), msg(2, "assistant", "hi")],
    null,
    provider,
    TEST_CONFIG,
    currentCode,
  );
  expect(seen).toHaveLength(1);
  expect(seen[0]).toHaveLength(1);
  expect(seen[0][0].role).toBe("system");
  return seen[0][0].content;
}

describe("summarizePrefix prompt", () => {
  it("null currentCode: picks dominant language of the archived conversation", async () => {
    const prompt = await captureSummarizePrompt(null);
    expect(prompt).not.toMatch(/output in english/i);
    expect(prompt).toMatch(/dominant language of the archived conversation/i);
  });

  it("explicit en code: pins output to English", async () => {
    const prompt = await captureSummarizePrompt("en");
    expect(prompt).toMatch(/Output in English/);
    expect(prompt).toMatch(/do not translate out of English/i);
  });

  it("explicit pl code: pins output to Polish", async () => {
    const prompt = await captureSummarizePrompt("pl");
    expect(prompt).toMatch(/Output in Polish/);
    expect(prompt).toMatch(/do not translate out of Polish/i);
  });

  it("und code: picks dominant language per checkpoint (same path as null)", async () => {
    const prompt = await captureSummarizePrompt("und");
    expect(prompt).toMatch(/dominant language of the archived conversation/i);
  });

  it("unknown code: falls back to referencing the raw code", async () => {
    const prompt = await captureSummarizePrompt("xx");
    expect(prompt).toMatch(/"xx"/);
  });

  it("retries once when provider returns an empty summary", async () => {
    const { provider, seen } = makeSimpleProvider(["   ", "retry summary"]);

    const summary = await summarizePrefix(
      [msg(1, "user", "alpha")],
      null,
      provider,
      TEST_CONFIG,
      "en",
    );

    expect(summary).toBe("retry summary");
    expect(seen).toHaveLength(2);
    expect(seen[1][0].content).toMatch(/previous summarizer call returned an empty response/i);
  });

  it("falls back deterministically when retry also returns empty", async () => {
    const { provider } = makeSimpleProvider(["", "   "]);

    const summary = await summarizePrefix(
      [msg(1, "user", "alpha"), msg(2, "assistant", "beta")],
      "old summary",
      provider,
      TEST_CONFIG,
      "en",
      "must keep X",
    );

    expect(summary).toContain("Deterministic fallback summary for compacted messages 1-2.");
    expect(summary).toContain("Pre-compact handoff: must keep X");
    expect(summary).toContain("Previous rolling summary to carry forward: old summary");
    expect(summary).toContain("[user#1]: alpha");
    expect(summary).toContain("[assistant#2]: beta");
  });
});
