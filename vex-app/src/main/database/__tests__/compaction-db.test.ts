/**
 * compaction-db tests — app-scope isolation + schema-readiness probe.
 *
 * `pg.Client` and `buildPoolConfig` are mocked so this runs without a live
 * Postgres. The point is to pin the contract: the status read is scoped to
 * app-scope, non-deleted sessions (a foreign/unknown id → `null`), and the
 * probe reflects `to_regclass`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn();
const queryMock = vi.fn();
const endMock = vi.fn();

vi.mock("pg", () => ({
  Client: class {
    connect = connectMock;
    query = queryMock;
    end = endMock;
  },
}));

vi.mock("../db-config.js", () => ({
  buildPoolConfig: vi.fn(async () => ({
    host: "localhost",
    port: 5432,
    database: "vex",
    user: "vex",
    password: "pw",
  })),
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { getCompactionStatus, probeCompactJobsReady } = await import(
  "../compaction-db.js"
);
const { VEX_APP_SESSION_SCOPE } = await import("@shared/schemas/sessions.js");

const SESSION = "00000000-0000-4000-8000-00000000aa01";
const ISO = "2026-05-21T10:00:00.000Z";

afterEach(() => {
  connectMock.mockReset();
  queryMock.mockReset();
  endMock.mockReset();
});

describe("getCompactionStatus (app-scoped)", () => {
  it("returns null for an unknown/foreign-scope session and scopes the query", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({ rows: [] });
    endMock.mockResolvedValue(undefined);

    const res = await getCompactionStatus(SESSION);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();

    const call = queryMock.mock.calls[0];
    expect(call).toBeDefined();
    const [sql, params] = call as [string, unknown[]];
    expect(sql).toContain("s.scope = $2");
    expect(sql).toContain("s.deleted_at IS NULL");
    expect(params).toEqual([SESSION, VEX_APP_SESSION_SCOPE]);
  });

  it("maps a present app-scope session with a running job", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          latest_status: "running",
          checkpoint_generation: 3,
          updated_at: ISO,
          active_count: "1",
        },
      ],
    });
    endMock.mockResolvedValue(undefined);

    const res = await getCompactionStatus(SESSION);
    expect(res.ok).toBe(true);
    if (!res.ok || res.data === null) throw new Error("expected non-null data");
    expect(res.data.latest).toEqual({
      status: "running",
      checkpointGeneration: 3,
      updatedAt: ISO,
    });
    expect(res.data.activeCount).toBe(1);
  });

  it("returns a present session with no jobs (latest null, zero active)", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          latest_status: null,
          checkpoint_generation: null,
          updated_at: null,
          active_count: 0,
        },
      ],
    });
    endMock.mockResolvedValue(undefined);

    const res = await getCompactionStatus(SESSION);
    expect(res.ok).toBe(true);
    if (!res.ok || res.data === null) throw new Error("expected non-null data");
    expect(res.data.latest).toBeNull();
    expect(res.data.activeCount).toBe(0);
  });

  it("maps a query failure to internal.unexpected on the compaction domain", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockRejectedValueOnce(new Error("boom"));
    endMock.mockResolvedValue(undefined);

    const res = await getCompactionStatus(SESSION);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("internal.unexpected");
      expect(res.error.domain).toBe("compaction");
    }
  });

  it("returns a DB-unavailable error when connect fails", async () => {
    connectMock.mockRejectedValueOnce(new Error("no db"));

    const res = await getCompactionStatus(SESSION);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.domain).toBe("compaction");
  });
});

describe("probeCompactJobsReady", () => {
  it("is true when to_regclass resolves the table", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({ rows: [{ reg: "compact_jobs" }] });
    endMock.mockResolvedValue(undefined);
    expect(await probeCompactJobsReady()).toBe(true);
  });

  it("is false when the table is absent (migrations not yet run)", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({ rows: [{ reg: null }] });
    endMock.mockResolvedValue(undefined);
    expect(await probeCompactJobsReady()).toBe(false);
  });

  it("is false when Postgres is unreachable", async () => {
    connectMock.mockRejectedValueOnce(new Error("no db"));
    expect(await probeCompactJobsReady()).toBe(false);
  });
});
