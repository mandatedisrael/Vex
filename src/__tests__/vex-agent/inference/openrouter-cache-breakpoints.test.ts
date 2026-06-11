/**
 * D-CACHE — cache breakpoint placement (params.ts gating + mappers.ts
 * mechanics). The mapper is purely mechanical: breakpoints land ONLY where
 * the engine's cacheHints say so (A on `static_prefix`, B on
 * `history_tail`), and ONLY for explicit-cache model families with cache
 * pricing. Everything else must produce today's exact request shape
 * (plain string contents — byte-stable for auto-prefix providers).
 */

import { describe, it, expect } from "vitest";
import {
  buildOpenRouterParams,
  isExplicitCacheModel,
  MERGE_TURN_STATE_FALLBACK_ENABLED,
} from "../../../vex-agent/inference/openrouter/params.js";
import { mapMessages } from "../../../vex-agent/inference/openrouter/mappers.js";
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
    cachePricePerM: 0.3,
    cacheWritePricePerM: 3.75,
    reasoningPricePerM: null,
    ...overrides,
  };
}

function tape(historyTailRole: "user" | "assistant" | "tool" | "system" = "user"): ProviderMessage[] {
  const history: ProviderMessage[] = [
    { role: "user", content: "first question" },
    { role: "assistant", content: "first answer" },
  ];
  if (historyTailRole === "user") {
    history.push({ role: "user", content: "tail content", cacheHint: "history_tail" });
  } else if (historyTailRole === "assistant") {
    history.push({ role: "assistant", content: "tail content", cacheHint: "history_tail" });
  } else if (historyTailRole === "tool") {
    history.push({
      role: "assistant",
      content: "",
      toolCalls: [{ id: "c1", command: "noop", args: {} }],
    });
    history.push({ role: "tool", content: "tail content", toolCallId: "c1", cacheHint: "history_tail" });
  } else {
    history.push({ role: "system", content: "[Engine: continue]", cacheHint: "history_tail" });
  }
  return [
    { role: "system", content: "STATIC PREFIX", cacheHint: "static_prefix" },
    { role: "system", content: "[Previous conversation summary]\nsum", cacheHint: "summary" },
    ...history,
    { role: "system", content: "TURN STATE", cacheHint: "turn_state" },
  ];
}

interface TextPart {
  type: string;
  text: string;
  cacheControl?: { type: string };
}

function asParts(content: unknown): TextPart[] {
  expect(Array.isArray(content)).toBe(true);
  return content as TextPart[];
}

function collectCacheControlledIndices(messages: ReadonlyArray<{ content?: unknown }>): number[] {
  const indices: number[] = [];
  messages.forEach((m, i) => {
    if (!Array.isArray(m.content)) return;
    const marked = (m.content as TextPart[]).some((p) => p.cacheControl !== undefined);
    if (marked) indices.push(i);
  });
  return indices;
}

describe("isExplicitCacheModel — closed prefix list", () => {
  it("matches anthropic/ and qwen/ only", () => {
    expect(isExplicitCacheModel("anthropic/claude-sonnet-4")).toBe(true);
    expect(isExplicitCacheModel("qwen/qwen3-coder")).toBe(true);
    expect(isExplicitCacheModel("openai/gpt-5")).toBe(false);
    expect(isExplicitCacheModel("deepseek/deepseek-chat")).toBe(false);
    // google/ deliberately excluded — implicit caching on 2.5, nothing older.
    expect(isExplicitCacheModel("google/gemini-2.5-pro")).toBe(false);
  });
});

describe("buildOpenRouterParams — breakpoint placement (explicit-cache + price)", () => {
  it("anthropic + cache price ⇒ A on static (content parts) + B on the user history_tail, nothing else", () => {
    const params = buildOpenRouterParams(tape("user"), [], makeConfig(), false);

    // A: static system message becomes [{type:'text', text, cacheControl}].
    const staticParts = asParts(params.messages[0].content);
    expect(staticParts).toEqual([
      { type: "text", text: "STATIC PREFIX", cacheControl: { type: "ephemeral" } },
    ]);

    // B: history tail (user) becomes text parts with cacheControl on the last.
    const tailIdx = params.messages.findIndex(
      (m) => Array.isArray(m.content) && (m.content as TextPart[]).some((p) => p.text === "tail content"),
    );
    expect(params.messages[tailIdx].role).toBe("user");
    const tailParts = asParts(params.messages[tailIdx].content);
    expect(tailParts[tailParts.length - 1].cacheControl).toEqual({ type: "ephemeral" });

    // EXACTLY two breakpoint carriers — summary, mid-history and turn_state
    // stay plain strings.
    expect(collectCacheControlledIndices(params.messages)).toEqual([0, tailIdx]);
    expect(typeof params.messages[1].content).toBe("string"); // summary
    expect(typeof params.messages[params.messages.length - 1].content).toBe("string"); // turn state
  });

  it.each(["assistant", "tool", "system"] as const)(
    "B carrier is role-agnostic: %s history_tail gets the breakpoint",
    (role) => {
      const params = buildOpenRouterParams(tape(role), [], makeConfig(), false);
      const marked = collectCacheControlledIndices(params.messages);
      expect(marked).toHaveLength(2); // A + B
      const tail = params.messages[marked[1]];
      expect(tail.role).toBe(role);
      const parts = asParts(tail.content);
      expect(parts[parts.length - 1].cacheControl).toEqual({ type: "ephemeral" });
    },
  );

  it("assistant history_tail WITH toolCalls keeps toolCalls intact and converts only non-empty content", () => {
    const messages: ProviderMessage[] = [
      { role: "system", content: "STATIC", cacheHint: "static_prefix" },
      {
        role: "assistant",
        content: "calling tools now",
        toolCalls: [{ id: "c9", command: "lookup", args: { q: "x" } }],
        cacheHint: "history_tail",
      },
      { role: "tool", content: "result", toolCallId: "c9" },
      { role: "system", content: "TURN STATE", cacheHint: "turn_state" },
    ];
    const params = buildOpenRouterParams(messages, [], makeConfig(), false);
    const assistant = params.messages[1];
    expect(assistant.role).toBe("assistant");
    if (assistant.role !== "assistant") return;
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls?.[0].function.name).toBe("lookup");
    const parts = asParts(assistant.content);
    expect(parts[parts.length - 1].cacheControl).toEqual({ type: "ephemeral" });
  });

  it("turn_state and summary hints NEVER get cacheControl", () => {
    const params = buildOpenRouterParams(tape("user"), [], makeConfig(), false);
    expect(params.messages[1].content).toBe("[Previous conversation summary]\nsum");
    expect(params.messages[params.messages.length - 1].content).toBe("TURN STATE");
  });

  it("no history_tail hint (empty history) ⇒ only A, no B", () => {
    const messages: ProviderMessage[] = [
      { role: "system", content: "STATIC", cacheHint: "static_prefix" },
      { role: "system", content: "TURN STATE", cacheHint: "turn_state" },
    ];
    const params = buildOpenRouterParams(messages, [], makeConfig(), false);
    expect(collectCacheControlledIndices(params.messages)).toEqual([0]);
  });

  it("auto-provider model ⇒ zero markup: every content is today's plain string", () => {
    const params = buildOpenRouterParams(
      tape("user"), [], makeConfig({ model: "deepseek/deepseek-chat" }), false,
    );
    for (const m of params.messages) {
      expect(typeof m.content === "string" || m.content === undefined).toBe(true);
    }
  });

  it("anthropic but cachePricePerM null (no cache pricing) ⇒ zero markup", () => {
    const params = buildOpenRouterParams(
      tape("user"), [], makeConfig({ cachePricePerM: null }), false,
    );
    for (const m of params.messages) {
      expect(typeof m.content === "string" || m.content === undefined).toBe(true);
    }
  });

  it("history_tail marked AFTER repair: tail on a synthesized-placeholder-shaped tool row works", () => {
    // Engine-side semantics: with an unanswered tool call the engine repairs
    // first and then marks the placeholder tool row. The mapper must accept
    // a tool-row carrier (covered role-agnostically above) AND must not move
    // B when the safety belt finds nothing to synthesize.
    const messages: ProviderMessage[] = [
      { role: "system", content: "STATIC", cacheHint: "static_prefix" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", command: "noop", args: {} }],
      },
      {
        role: "tool",
        content: "[Engine: tool execution did not complete — placeholder]",
        toolCallId: "c1",
        cacheHint: "history_tail",
      },
      { role: "system", content: "TURN STATE", cacheHint: "turn_state" },
    ];
    const params = buildOpenRouterParams(messages, [], makeConfig(), false);
    const marked = collectCacheControlledIndices(params.messages);
    expect(marked).toEqual([0, 2]);
    expect(params.messages[2].role).toBe("tool");
  });
});

describe("fallback-merge shape (flag-gated, currently OFF)", () => {
  it("the activation flag ships disabled", () => {
    expect(MERGE_TURN_STATE_FALLBACK_ENABLED).toBe(false);
  });

  it("merged shape: [static(+cc), turn-state] as two parts, turn_state message dropped, B on history_tail RETAINED", () => {
    const mapped = mapMessages(tape("user"), {
      applyBreakpoints: true,
      mergeTurnStateIntoStaticPrefix: true,
    });

    // Static message: part 1 = static WITH cacheControl, part 2 = turn-state WITHOUT.
    const staticParts = asParts(mapped[0].content);
    expect(staticParts).toEqual([
      { type: "text", text: "STATIC PREFIX", cacheControl: { type: "ephemeral" } },
      { type: "text", text: "TURN STATE" },
    ]);

    // The trailing turn-state message is gone — history ends the array.
    const last = mapped[mapped.length - 1];
    expect(Array.isArray(last.content) && (last.content as TextPart[])[0]?.text === "TURN STATE").toBe(false);
    expect(mapped).toHaveLength(tape("user").length - 1);

    // Breakpoint B survives the merge (Codex gate R2).
    const marked = collectCacheControlledIndices(mapped);
    expect(marked).toHaveLength(2);
    const tail = mapped[marked[1]];
    const tailParts = asParts(tail.content);
    expect(tailParts[tailParts.length - 1].text).toBe("tail content");
    expect(tailParts[tailParts.length - 1].cacheControl).toEqual({ type: "ephemeral" });
  });

  it("merge is a no-op without breakpoints enabled", () => {
    const mapped = mapMessages(tape("user"), {
      applyBreakpoints: false,
      mergeTurnStateIntoStaticPrefix: true,
    });
    expect(typeof mapped[0].content).toBe("string");
    expect(mapped).toHaveLength(tape("user").length);
  });
});
