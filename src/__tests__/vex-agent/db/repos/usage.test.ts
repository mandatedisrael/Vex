/**
 * usage repo — logUsage column wiring. Pins the two cache-savings columns
 * added by migration 032 (`cached_savings`, `cache_write_tokens`): values
 * flow through when provided (negative savings included — recorded
 * truthfully) and default to 0 when absent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  execute: (...a: unknown[]) => mockExecute(...a),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const { logUsage } = await import("@vex-agent/db/repos/usage.js");

describe("usage repo — logUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
  });

  it("inserts cached_savings + cache_write_tokens with provided values (negative savings preserved)", async () => {
    await logUsage("session-1", {
      promptTokens: 1000,
      completionTokens: 200,
      cost: 0.001,
      cachedTokens: 600,
      cachedSavings: -0.0033,
      cacheWriteTokens: 8000,
      reasoningTokens: 0,
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
      currency: "USD",
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("cached_savings");
    expect(sql).toContain("cache_write_tokens");
    // Positional params: [..., currency, cached_savings, cache_write_tokens]
    expect(params).toEqual([
      "session-1", 1000, 200, 1200, 600, 0, 0.001,
      "openrouter", "anthropic/claude-sonnet-4", "USD",
      -0.0033, 8000,
    ]);
  });

  it("defaults cachedSavings and cacheWriteTokens to 0 when omitted", async () => {
    await logUsage("session-1", {
      promptTokens: 10,
      completionTokens: 5,
      cost: 0,
    });

    const [, params] = mockExecute.mock.calls[0] as [string, unknown[]];
    expect(params[10]).toBe(0); // cached_savings
    expect(params[11]).toBe(0); // cache_write_tokens
  });
});
