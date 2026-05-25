/**
 * Phase-7 renewable-source resolver tests for `/mission-renew`
 * (puzzle 04 phase 7 codex review #3 + §Q3 — DB-level coverage).
 *
 * Latest-run semantics: a mission is renewable iff
 *   (a) its acceptance four-tuple is complete, AND
 *   (b) its NEWEST `mission_runs` row sits in a terminal status
 *       (`completed`, `failed`, `stopped`, `cancelled`).
 *
 * Older terminal runs underneath a newer active/paused run do NOT
 * qualify. Acceptance-without-any-run also does NOT qualify — the
 * resolver intentionally excludes accepted-never-run missions so the
 * UI copy "No completed mission to renew" matches reality.
 *
 * The tests mock `pg.Client` query at the boundary and assert SQL
 * shape + bound parameters + result mapping. SQL whitespace is
 * normalised so layout edits don't break the suite.
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

const { getRenewableSourceForSession } = await import("../missions-db.js");

const SESSION = "00000000-0000-4000-8000-000000000aaa";

function normaliseSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

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

describe("getRenewableSourceForSession", () => {
  it("returns missionId when latest run terminal AND acceptance four-tuple complete", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ mission_id: "mission-finished" }],
    });
    const result = await getRenewableSourceForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ missionId: "mission-finished" });
  });

  it("returns null when query returns no rows (no renewable mission exists)", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const result = await getRenewableSourceForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("binds the sessionId as the only query parameter", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await getRenewableSourceForSession(SESSION);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const args = mocks.query.mock.calls[0];
    expect(args?.[1]).toEqual([SESSION]);
  });

  it("uses latest-run semantics (JOIN LATERAL with ORDER BY started_at DESC LIMIT 1)", async () => {
    // The CRITICAL SQL property is: pick latest run per mission, then
    // gate on THAT run's status — not ANY terminal run for the mission.
    // Codex phase 7 §Q1 specifically rejected an EXISTS-based query.
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await getRenewableSourceForSession(SESSION);
    const sql = normaliseSql(mocks.query.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain("JOIN LATERAL");
    expect(sql).toContain("ORDER BY r.started_at DESC");
    expect(sql).toContain("LIMIT 1");
    // Outer query also limits to one mission.
    expect(sql.match(/LIMIT 1/g)).toHaveLength(2);
  });

  it("gates on all four acceptance columns + terminal latest status", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await getRenewableSourceForSession(SESSION);
    const sql = normaliseSql(mocks.query.mock.calls[0]?.[0] ?? "");
    // All four acceptance columns must be NOT NULL.
    expect(sql).toContain("m.accepted_contract_hash IS NOT NULL");
    expect(sql).toContain("m.accepted_contract_at IS NOT NULL");
    expect(sql).toContain("m.accepted_contract_by IS NOT NULL");
    expect(sql).toContain("m.contract_hash_version IS NOT NULL");
    // Latest run status gated to terminal four.
    expect(sql).toContain(
      "latest.status IN ('completed', 'failed', 'stopped', 'cancelled')",
    );
  });

  it("orders results by latest run's end-or-start time (newest first)", async () => {
    // Tie-break still flips to mission updated_at when run timestamps
    // collide. The outer SQL must preserve "newest finished first" so
    // a recently completed mission wins over an older one.
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await getRenewableSourceForSession(SESSION);
    const sql = normaliseSql(mocks.query.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain(
      "ORDER BY COALESCE(latest.ended_at, latest.started_at) DESC",
    );
    expect(sql).toContain("m.updated_at DESC");
  });

  it("returns error result when query throws (DB connection lost mid-call)", async () => {
    mocks.query.mockRejectedValueOnce(new Error("connection terminated"));
    const result = await getRenewableSourceForSession(SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("internal.unexpected");
    expect(result.error.domain).toBe("mission");
    expect(result.error.retryable).toBe(true);
    expect(result.error.redacted).toBe(true);
    expect(mocks.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("getRenewableSourceForSession failed"),
      expect.any(Error),
    );
  });

  it("returns DB-unavailable when buildPoolConfig returns null (no local services)", async () => {
    mocks.buildPoolConfig.mockResolvedValueOnce(null);
    const result = await getRenewableSourceForSession(SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("internal.unexpected");
    expect(result.error.domain).toBe("mission");
    expect(result.error.retryable).toBe(true);
    // Query was never attempted — no client created.
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
