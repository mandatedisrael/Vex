/**
 * long-memory-db tests — sanitization + status filter + bounded list
 * (memory-system S9 rewire).
 *
 * `pg.Client` + `buildPoolConfig` are mocked. The critical assertion is the
 * SANITIZATION contract: the SELECT must never reference `content_md`,
 * `source_refs`, `content_hash`, or any embedding column, so those never
 * leave the main process.
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

const { listLongMemory } = await import("../long-memory-db.js");

const FORBIDDEN_COLUMNS = [
  "content_md",
  "source_refs",
  "content_hash",
  "embedding",
];
const ISO = "2026-05-21T10:00:00.000Z";

afterEach(() => {
  connectMock.mockReset();
  queryMock.mockReset();
  endMock.mockReset();
});

describe("listLongMemory", () => {
  it("never SELECTs a sanitized column and maps a row", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          kind: "risk_rule",
          title: "Avoid X",
          summary: "Short summary",
          tags: ["risk"],
          confidence: 0.8,
          status: "active",
          source: "observed",
          maturity_state: "established",
          pinned: false,
          created_at: ISO,
          updated_at: ISO,
        },
      ],
    });
    endMock.mockResolvedValue(undefined);

    const res = await listLongMemory({ limit: 100 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0]).toEqual({
        id: 1,
        kind: "risk_rule",
        title: "Avoid X",
        summary: "Short summary",
        tags: ["risk"],
        confidence: 0.8,
        status: "active",
        source: "observed",
        maturityState: "established",
        pinned: false,
        createdAt: ISO,
        updatedAt: ISO,
      });
    }

    const call = queryMock.mock.calls[0];
    expect(call).toBeDefined();
    const [sql] = call as [string, unknown[]];
    for (const col of FORBIDDEN_COLUMNS) {
      expect(sql).not.toContain(col);
    }
    expect(sql).toContain("FROM knowledge_entries");
  });

  it("applies the status filter as a bound parameter", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({ rows: [] });
    endMock.mockResolvedValue(undefined);

    await listLongMemory({ status: "archived", limit: 50 });
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE status = $1");
    expect(params).toEqual(["archived", 50]);
  });

  it("coerces unknown source/maturity values to null and defaults null tags to []", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          kind: "k",
          title: "t",
          summary: "s",
          tags: null,
          confidence: null,
          status: "active",
          source: "weird_legacy_value",
          maturity_state: "weird_legacy_state",
          pinned: true,
          created_at: ISO,
          updated_at: ISO,
        },
      ],
    });
    endMock.mockResolvedValue(undefined);

    const res = await listLongMemory({ limit: 10 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0]?.source).toBeNull();
      expect(res.data[0]?.maturityState).toBeNull();
      expect(res.data[0]?.tags).toEqual([]);
      expect(res.data[0]?.confidence).toBeNull();
    }
  });

  it("maps a query failure to internal.unexpected on the memory domain", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockRejectedValueOnce(new Error("boom"));
    endMock.mockResolvedValue(undefined);

    const res = await listLongMemory({ limit: 10 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("internal.unexpected");
      expect(res.error.domain).toBe("memory");
    }
  });
});
