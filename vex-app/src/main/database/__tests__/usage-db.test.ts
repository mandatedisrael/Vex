/**
 * usage-db tests — numeric coercion + zero-row fallback.
 *
 * `pg` returns NUMERIC columns as strings to preserve precision; the
 * mapper coerces to finite JS numbers and falls back to `null` when
 * the value is unparseable or non-finite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryFn = (
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;

const mocks = vi.hoisted(() => ({
  query: vi.fn() as QueryFn,
  connect: vi.fn(),
  end: vi.fn(),
  buildPoolConfig: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("pg", () => {
  function MockClient() {
    return {
      connect: mocks.connect,
      end: mocks.end,
      query: mocks.query,
    };
  }
  return { Client: MockClient };
});

vi.mock("../db-config.js", () => ({
  buildPoolConfig: mocks.buildPoolConfig,
}));

vi.mock("../../logger/index.js", () => ({ log: mocks.log }));

const { getContextWindow, getLastTurn, getSessionTotals } = await import(
  "../usage-db.js"
);

const SESSION = "00000000-0000-4000-8000-00000000dddd";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildPoolConfig.mockResolvedValue({
    host: "127.0.0.1",
    port: 5777,
    database: "vex",
    user: "vex",
    password: "secret",
  });
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("usage-db mapper", () => {
  it("returns all-zero totals when no usage_log rows for session", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          total_prompt: "0",
          total_completion: "0",
          total_total: "0",
          total_cost: null,
          request_count: "0",
          last_request_at: null,
        },
      ],
    });
    const result = await getSessionTotals(SESSION, "USD");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      sessionId: SESSION,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCost: null,
      currency: "USD",
      requestCount: 0,
      lastRequestAt: null,
    });
  });

  it("coerces NUMERIC strings to JS numbers", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          total_prompt: "1500",
          total_completion: "750",
          total_total: "2250",
          total_cost: "0.0023",
          request_count: "5",
          last_request_at: "2026-05-21T10:00:00.000Z",
        },
      ],
    });
    const result = await getSessionTotals(SESSION, "USD");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalPromptTokens).toBe(1500);
    expect(result.data.totalCompletionTokens).toBe(750);
    expect(result.data.totalCost).toBeCloseTo(0.0023, 6);
    expect(result.data.requestCount).toBe(5);
  });

  it("collapses unparseable NUMERIC strings to null cost", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          total_prompt: "10",
          total_completion: "5",
          total_total: "15",
          total_cost: "not-a-number",
          request_count: "1",
          last_request_at: "2026-05-21T10:00:00.000Z",
        },
      ],
    });
    const result = await getSessionTotals(SESSION, "USD");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalCost).toBeNull();
  });

  it("getLastTurn returns null for empty session, never an error", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const result = await getLastTurn(SESSION, "USD");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("getLastTurn maps a row with mixed string/number fields", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          session_id: SESSION,
          prompt_tokens: "100",
          completion_tokens: 50,
          total_tokens: "150",
          cached_tokens: null,
          reasoning_tokens: "5",
          cost: "0.001",
          provider: "openrouter",
          model: "anthropic/claude-opus-4.7",
          currency: "USD",
          created_at: "2026-05-21T10:00:00.000Z",
        },
      ],
    });
    const result = await getLastTurn(SESSION, "USD");
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.promptTokens).toBe(100);
    expect(result.data.completionTokens).toBe(50);
    expect(result.data.totalTokens).toBe(150);
    expect(result.data.cachedTokens).toBe(0);
    expect(result.data.reasoningTokens).toBe(5);
    expect(result.data.cost).toBeCloseTo(0.001, 6);
  });

  it("getContextWindow returns null when the session row is missing/deleted/out-of-scope", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const result = await getContextWindow(SESSION, 128_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("getContextWindow maps token_count and passes the limit through", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ token_count: "4096" }] });
    const result = await getContextWindow(SESSION, 128_000);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data).toEqual({
      sessionId: SESSION,
      tokensUsed: 4096,
      contextLimit: 128_000,
    });
  });

  it("getContextWindow carries a null limit through (invalid config)", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ token_count: 0 }] });
    const result = await getContextWindow(SESSION, null);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.contextLimit).toBeNull();
    expect(result.data.tokensUsed).toBe(0);
  });
});
