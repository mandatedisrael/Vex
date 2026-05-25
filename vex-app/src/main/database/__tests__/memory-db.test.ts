/**
 * memory-db tests — app-scope isolation + sanitization + counts-only.
 *
 * `pg.Client` + `buildPoolConfig` are mocked. Critical contracts:
 *  - session-scoped reads return `null` for an unknown/foreign/deleted
 *    session (the app-scope guard query returns no row);
 *  - the list SELECT never references narrative/embedding columns, and the
 *    DTO carries outstanding COUNTS only (no raw `outstanding_items`).
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

const { listSessionMemories, getMemoryStats } = await import("../memory-db.js");
const { VEX_APP_SESSION_SCOPE } = await import("@shared/schemas/sessions.js");

const SESSION = "00000000-0000-4000-8000-00000000bb01";
const ISO = "2026-05-21T10:00:00.000Z";
// Narrative + embedding columns that must NEVER appear in the list SELECT.
// (`outstanding_items` is referenced ONLY inside COUNT subqueries — its raw
// value is never returned — so it is intentionally excluded from this list.)
const FORBIDDEN_COLUMNS = [
  "body_md",
  "happened_md",
  "did_md",
  "tried_md",
  "embedding",
  "content_hash",
];

afterEach(() => {
  connectMock.mockReset();
  queryMock.mockReset();
  endMock.mockReset();
});

describe("listSessionMemories (app-scoped)", () => {
  it("returns null for an unknown/foreign session and scopes the guard", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({ rows: [] }); // sessionInAppScope → absent
    endMock.mockResolvedValue(undefined);

    const res = await listSessionMemories(SESSION, 50);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();

    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("scope = $2");
    expect(sql).toContain("deleted_at IS NULL");
    expect(params).toEqual([SESSION, VEX_APP_SESSION_SCOPE]);
    // No list query issued when the session is out of scope.
    expect(queryMock.mock.calls).toHaveLength(1);
  });

  it("maps an in-scope session's memory with counts and no narrative SELECT", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] }) // in scope
      .mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            theme: "kyber_timeout_fix",
            theme_source: "chunker",
            entities: ["KyberSwap"],
            protocols: ["kyber"],
            error_classes: ["timeout"],
            chains: ["arbitrum"],
            tasks: ["rebalance"],
            importance: 7,
            confidence: 0.9,
            status: "active",
            checkpoint_generation: 3,
            source_start_message_id: 10,
            source_end_message_id: 40,
            outstanding_open: "2",
            outstanding_resolved: "1",
            created_at: ISO,
          },
        ],
      });
    endMock.mockResolvedValue(undefined);

    const res = await listSessionMemories(SESSION, 50);
    expect(res.ok).toBe(true);
    if (!res.ok || res.data === null) throw new Error("expected memories");
    const m = res.data[0];
    expect(m).toEqual({
      id: 7,
      theme: "kyber_timeout_fix",
      themeSource: "chunker",
      entities: ["KyberSwap"],
      protocols: ["kyber"],
      errorClasses: ["timeout"],
      chains: ["arbitrum"],
      tasks: ["rebalance"],
      importance: 7,
      confidence: 0.9,
      status: "active",
      checkpointGeneration: 3,
      sourceStartMessageId: 10,
      sourceEndMessageId: 40,
      outstandingOpenCount: 2,
      outstandingResolvedCount: 1,
      createdAt: ISO,
    });

    const [listSql] = queryMock.mock.calls[1] as [string, unknown[]];
    for (const col of FORBIDDEN_COLUMNS) {
      expect(listSql).not.toContain(col);
    }
  });
});

describe("getMemoryStats (app-scoped)", () => {
  it("returns null for an unknown/foreign session", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({ rows: [] }); // session not in scope
    endMock.mockResolvedValue(undefined);

    const res = await getMemoryStats(SESSION);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toBeNull();
    expect(queryMock.mock.calls).toHaveLength(1);
  });

  it("reads compactCount from the session row and maps aggregates", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock
      .mockResolvedValueOnce({ rows: [{ checkpoint_generation: 5 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            active_count: "2",
            unresolved_outstanding: "1",
            recent_themes: ["t1", "t2"],
          },
        ],
      });
    endMock.mockResolvedValue(undefined);

    const res = await getMemoryStats(SESSION);
    expect(res.ok).toBe(true);
    if (!res.ok || res.data === null) throw new Error("expected stats");
    expect(res.data).toEqual({
      activeCount: 2,
      compactCount: 5,
      unresolvedOutstandingCount: 1,
      recentThemes: ["t1", "t2"],
    });
  });
});
