import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateMessagesTokens,
  calculateBudget,
  calculateHybridBudget,
  parseCompactionResult,
} from "../../agent/context.js";
import type { Message } from "../../agent/types.js";
import { mockMessage } from "./_fixtures.js";

// ── estimateTokens ──────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for null-ish input", () => {
    expect(estimateTokens(null as unknown as string)).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it("returns at least 1 for a single word", () => {
    expect(estimateTokens("hello")).toBeGreaterThanOrEqual(1);
  });

  it("scales with word count for prose", () => {
    const short = estimateTokens("hello world");
    const long = estimateTokens("the quick brown fox jumps over the lazy dog repeatedly");
    expect(long).toBeGreaterThan(short);
  });

  it("uses char-based estimate for code-heavy text", () => {
    // Code with many special chars but few whitespace-separated words
    const code = "const x=a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y.z;";
    const tokens = estimateTokens(code);
    // char-based should dominate: length / 3.5
    expect(tokens).toBeGreaterThanOrEqual(Math.ceil(code.length / 3.5));
  });

  it("handles whitespace-only input", () => {
    // split(/\s+/).filter(Boolean) produces no words, but charCount / 3.5 > 0
    const tokens = estimateTokens("   \t\n  ");
    expect(tokens).toBeGreaterThanOrEqual(1);
  });
});

// ── estimateMessagesTokens ──────────────────────────────────────────

describe("estimateMessagesTokens", () => {
  it("returns 0 for empty array", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it("includes 4-token overhead per message", () => {
    const emptyMsg = mockMessage("user", "");
    // Empty content → 0 content tokens + 4 overhead
    // But estimateTokens("") = 0, so total should be 4
    expect(estimateMessagesTokens([emptyMsg])).toBe(4);
  });

  it("sums content tokens plus overhead for multiple messages", () => {
    const msgs = [
      mockMessage("user", "hello"),
      mockMessage("assistant", "world"),
    ];
    const total = estimateMessagesTokens(msgs);
    // 2 messages × 4 overhead = 8, plus content tokens
    expect(total).toBeGreaterThanOrEqual(8);
  });

  it("handles messages with large content", () => {
    const bigContent = "x ".repeat(10_000);
    const msgs = [mockMessage("user", bigContent)];
    const total = estimateMessagesTokens(msgs);
    expect(total).toBeGreaterThan(10_000);
  });
});

// ── calculateBudget ─────────────────────────────────────────────────

describe("calculateBudget", () => {
  const systemPrompt = "You are an assistant.";

  it("shouldCompact is false when well below threshold", () => {
    const budget = calculateBudget(systemPrompt, [], 65_000);
    expect(budget.shouldCompact).toBe(false);
    expect(budget.remainingTokens).toBeGreaterThan(0);
    expect(budget.contextLimit).toBe(65_000);
  });

  it("shouldCompact is true when at threshold", () => {
    // Create enough messages to push past 75% of 100 token limit
    const msgs: Message[] = [];
    for (let i = 0; i < 50; i++) {
      msgs.push(mockMessage("user", "word ".repeat(20)));
    }
    const budget = calculateBudget("", msgs, 100);
    expect(budget.shouldCompact).toBe(true);
  });

  it("usageFraction equals totalTokens / contextLimit", () => {
    const budget = calculateBudget(systemPrompt, [], 1000);
    expect(budget.usageFraction).toBeCloseTo(budget.totalTokens / 1000);
  });

  it("remainingTokens is never negative", () => {
    const msgs = Array.from({ length: 100 }, (_, i) =>
      mockMessage("user", "word ".repeat(100)),
    );
    const budget = calculateBudget(systemPrompt, msgs, 100);
    expect(budget.remainingTokens).toBeGreaterThanOrEqual(0);
  });

  it("systemTokens and messageTokens sum to totalTokens", () => {
    const msgs = [mockMessage("user", "hello world")];
    const budget = calculateBudget(systemPrompt, msgs, 65_000);
    expect(budget.totalTokens).toBe(budget.systemTokens + budget.messageTokens);
  });

  it("uses default context limit when not specified", () => {
    const budget = calculateBudget(systemPrompt, []);
    expect(budget.contextLimit).toBeGreaterThan(0);
  });
});

// ── calculateHybridBudget ───────────────────────────────────────────

describe("calculateHybridBudget", () => {
  const systemPrompt = "System prompt.";

  it("falls back to full heuristic when no snapshot (undefined)", () => {
    const msgs = [mockMessage("user", "hello")];
    const hybrid = calculateHybridBudget(undefined, systemPrompt, msgs, 0, 65_000);
    const heuristic = calculateBudget(systemPrompt, msgs, 65_000);
    expect(hybrid.totalTokens).toBe(heuristic.totalTokens);
  });

  it("falls back to full heuristic when snapshot is 0", () => {
    const msgs = [mockMessage("user", "hello")];
    const hybrid = calculateHybridBudget(0, systemPrompt, msgs, 0, 65_000);
    const heuristic = calculateBudget(systemPrompt, msgs, 65_000);
    expect(hybrid.totalTokens).toBe(heuristic.totalTokens);
  });

  it("uses snapshot + delta when snapshot is positive", () => {
    const msgs = [
      mockMessage("user", "first message"),
      mockMessage("assistant", "response"),
      mockMessage("user", "new message"),
    ];
    const hybrid = calculateHybridBudget(5000, systemPrompt, msgs, 1, 65_000);
    // Total should be 5000 + estimate of last 1 message
    expect(hybrid.totalTokens).toBeGreaterThan(5000);
    expect(hybrid.totalTokens).toBeLessThan(5100);
  });

  it("clamps newMessagesSinceSnapshot to messages.length", () => {
    const msgs = [mockMessage("user", "only one")];
    // Asking for 100 new messages but only 1 exists — should not crash
    const hybrid = calculateHybridBudget(5000, systemPrompt, msgs, 100, 65_000);
    expect(hybrid.totalTokens).toBeGreaterThanOrEqual(5000);
  });

  it("with zero new messages since snapshot, total equals snapshot", () => {
    const msgs = [mockMessage("user", "old")];
    const hybrid = calculateHybridBudget(5000, systemPrompt, msgs, 0, 65_000);
    expect(hybrid.totalTokens).toBe(5000);
  });

  it("sets systemTokens to 0 in hybrid mode", () => {
    const hybrid = calculateHybridBudget(5000, systemPrompt, [], 0, 65_000);
    expect(hybrid.systemTokens).toBe(0);
  });
});

// ── parseCompactionResult ───────────────────────────────────────────

describe("parseCompactionResult", () => {
  it("extracts Session Summary section", () => {
    const response = `## Session Summary
The user asked about wallets.

## Key Insights
User prefers SOL.`;
    const { summary, insights } = parseCompactionResult(response);
    expect(summary).toBe("The user asked about wallets.");
    expect(insights).toBe("User prefers SOL.");
  });

  it("falls back to first 1000 chars when no summary section", () => {
    const response = "No sections here, just plain text.";
    const { summary } = parseCompactionResult(response);
    expect(summary).toBe("No sections here, just plain text.");
  });

  it("returns empty insights when no insights section", () => {
    const response = `## Session Summary
Some summary here.`;
    const { insights } = parseCompactionResult(response);
    expect(insights).toBe("");
  });

  it("handles case-insensitive section headers", () => {
    const response = `## session summary
Lower case summary.

## key insights
Lower case insights.`;
    const { summary, insights } = parseCompactionResult(response);
    expect(summary).toBe("Lower case summary.");
    expect(insights).toBe("Lower case insights.");
  });

  it("truncates fallback to 1000 chars", () => {
    const longText = "x".repeat(2000);
    const { summary } = parseCompactionResult(longText);
    expect(summary.length).toBeLessThanOrEqual(1000);
  });
});
