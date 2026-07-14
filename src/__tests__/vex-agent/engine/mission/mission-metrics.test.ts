/**
 * Per-mission trade count — successful fills recorded in proj_activity,
 * bounded to the run by its session and time window. (A mission run maps
 * 1:1 to a session; proj_activity links to a session via
 * protocol_executions.)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

let mockQueryOne: Mock;

vi.mock("@vex-agent/db/client.js", () => ({
  query: vi.fn(),
  queryOne: (sql: string, p?: unknown[]) => mockQueryOne(sql, p),
  execute: vi.fn(),
  queryWith: vi.fn(),
  queryOneWith: vi.fn(),
  executeWith: vi.fn(),
  withTransaction: vi.fn(),
}));

const { countMissionTrades } = await import(
  "@vex-agent/engine/mission/mission-metrics.js"
);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

beforeEach(() => {
  mockQueryOne = vi.fn(async () => ({ trades: 4 }));
});

describe("countMissionTrades", () => {
  it("counts fills for the session within the run window (joined via protocol_executions)", async () => {
    const n = await countMissionTrades("sess-1", "2026-07-12T18:00:00Z", "2026-07-12T19:00:00Z");
    expect(n).toBe(4);
    const [sql, params] = mockQueryOne.mock.calls[0]!;
    const s = norm(sql);
    expect(s).toContain("FROM proj_activity");
    expect(s).toContain("JOIN protocol_executions");
    expect(s).toContain("session_id =");
    expect(s).toContain("created_at BETWEEN");
    expect(s.toLowerCase()).toContain("count(");
    expect(params).toEqual(["sess-1", "2026-07-12T18:00:00Z", "2026-07-12T19:00:00Z"]);
  });

  it("is fail-soft — a query error yields 0, never throws (finalize must not break)", async () => {
    mockQueryOne = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(countMissionTrades("s", "a", "b")).resolves.toBe(0);
  });

  it("returns 0 when the query yields no row", async () => {
    mockQueryOne = vi.fn(async () => null);
    await expect(countMissionTrades("s", "a", "b")).resolves.toBe(0);
  });
});
