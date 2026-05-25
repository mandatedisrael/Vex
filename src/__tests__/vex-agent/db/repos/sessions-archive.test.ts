/**
 * Unit tests for the archive-path SQL in `sessions` repo — structural only.
 *
 * Why structural? The transactional helpers (`archivePrefix`, `archiveSuffix`,
 * `forkToolMessageToArchive`) run against a real pool with a `BEGIN/COMMIT`
 * shape that is painful to simulate end-to-end without a live database. What
 * we can still catch here — and what actually matters for the giant-tool /
 * prefix-archive interaction — is that both helpers keep
 * `ON CONFLICT (id) DO NOTHING` on the archive inserts. Without that, a
 * forked placeholder row colliding with a later prefix archive crashes the
 * pool on a unique-index violation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const clientQuery = vi.fn();
const clientRelease = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(),
  executeWith: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOneWith: vi.fn().mockResolvedValue(null),
  queryOne: vi.fn().mockResolvedValue(null),
  getPool: () => ({
    connect: async () => ({
      query: (...args: unknown[]) => clientQuery(...args),
      release: () => clientRelease(),
    }),
  }),
}));

const { archivePrefix, archiveSuffix, forkToolMessageToArchive } = await import(
  "../../../../vex-agent/db/repos/sessions.js"
);

beforeEach(() => {
  clientQuery.mockReset();
  clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  clientRelease.mockReset();
});

describe("archivePrefix SQL", () => {
  it("uses ON CONFLICT (id) DO NOTHING when moving the prefix into archive", async () => {
    await archivePrefix("session-1", 42, 5);

    const sqlCalls = clientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    const archiveInsert = sqlCalls.find((s) => s.includes("INSERT INTO messages_archive"));
    expect(archiveInsert).toBeTruthy();
    expect(archiveInsert).toMatch(/ON CONFLICT\s*\(\s*id\s*\)\s*DO NOTHING/i);
  });

  it("wraps archive + message_count update in BEGIN / COMMIT", async () => {
    await archivePrefix("session-1", 42, 5);
    const sqlCalls = clientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(sqlCalls).toContain("BEGIN");
    expect(sqlCalls).toContain("COMMIT");
  });

  it("uses an explicit column list (no SELECT *) and stamps rewind_checkpoint_id NULL", async () => {
    // Puzzle 04 phase 5 invariant — compaction archive must never
    // resurrect under `/restore`. The archive INSERT lists every
    // messages column explicitly and supplies NULL for
    // `rewind_checkpoint_id` so the partial index on
    // `messages_archive(rewind_checkpoint_id)` skips these rows.
    await archivePrefix("session-1", 42, 5);
    const sqlCalls = clientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    const archiveInsert = sqlCalls.find((s) => s.includes("INSERT INTO messages_archive"));
    expect(archiveInsert).toBeTruthy();
    // Explicit column list — every messages column appears in the
    // INSERT target column tuple. Spot-check key names; the constant
    // is the source of truth and a missing column there would also
    // fail this assertion.
    expect(archiveInsert).toMatch(/INSERT INTO messages_archive\s*\(/);
    expect(archiveInsert).toContain("session_id");
    expect(archiveInsert).toContain("metadata");
    expect(archiveInsert).toContain("rewind_checkpoint_id");
    // The SELECT projection includes a literal NULL for the stamp.
    expect(archiveInsert).toMatch(/SELECT[^;]*?,\s*NULL\s+FROM\s+moved/i);
    // No `SELECT \*` anywhere — would silently drop the new column
    // count mismatch on a future migration.
    expect(archiveInsert).not.toMatch(/SELECT\s*\*/);
  });
});

describe("archiveSuffix SQL", () => {
  it("returns the moved/deleted row count, not the inserted archive row count", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("id >= $2")) {
        // inserted_count must equal archived_count on the happy
        // path — the restorability invariant in puzzle 04 phase 5.
        return {
          rows: [{ archived_count: "3", inserted_count: "3", remaining_count: "7" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await archiveSuffix("session-1", 42, "chk-1");

    expect(result).toEqual({ archivedCount: 3, remainingCount: 7 });
    const sqlCalls = clientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    const suffixArchive = sqlCalls.find((s) => s.includes("id >= $2"));
    expect(suffixArchive).toMatch(/SELECT COUNT\(\*\)::text FROM moved/i);
  });

  it("stamps every archived row with the supplied rewind_checkpoint_id ($3)", async () => {
    // Puzzle 04 phase 5: rewind's archive writes must be discoverable
    // by `/restore`'s `WHERE rewind_checkpoint_id = $checkpointId`
    // lookup. The INSERT projection takes the checkpoint id as $3
    // and inserts it on every row.
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("id >= $2")) {
        return {
          rows: [{ archived_count: "2", inserted_count: "2", remaining_count: "3" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    await archiveSuffix("session-1", 42, "chk-abc");

    const archiveCall = clientQuery.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("INSERT INTO messages_archive"),
    );
    expect(archiveCall).toBeTruthy();
    const [sql, params] = archiveCall as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO messages_archive\s*\([^)]*rewind_checkpoint_id\)/);
    expect(sql).toMatch(/SELECT[^;]*?,\s*\$3\s+FROM\s+moved/);
    expect(sql).not.toMatch(/SELECT\s*\*/);
    expect(params).toEqual(["session-1", 42, "chk-abc"]);
  });

  it("accepts a null rewindCheckpointId for non-restorable archive writes", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("id >= $2")) {
        return {
          rows: [{ archived_count: "0", inserted_count: "0", remaining_count: "0" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    await archiveSuffix("session-1", 42, null);
    const archiveCall = clientQuery.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("INSERT INTO messages_archive"),
    );
    const [, params] = archiveCall as [string, unknown[]];
    expect(params[2]).toBeNull();
  });
});

describe("forkToolMessageToArchive SQL", () => {
  it("uses ON CONFLICT (id) DO NOTHING on the archive copy", async () => {
    await forkToolMessageToArchive("session-1", 99, "[placeholder]");

    const sqlCalls = clientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    const archiveInsert = sqlCalls.find((s) => s.includes("INSERT INTO messages_archive"));
    expect(archiveInsert).toBeTruthy();
    expect(archiveInsert).toMatch(/ON CONFLICT\s*\(\s*id\s*\)\s*DO NOTHING/i);
  });

  it("stamps rewind_checkpoint_id NULL on the giant-tool archive copy", async () => {
    // Puzzle 04 phase 5 invariant — giant-tool overflow rows must
    // never resurrect via `/restore`. Stamp NULL like compaction.
    await forkToolMessageToArchive("session-1", 99, "[placeholder]");
    const sqlCalls = clientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    const archiveInsert = sqlCalls.find((s) => s.includes("INSERT INTO messages_archive"));
    expect(archiveInsert).toBeTruthy();
    expect(archiveInsert).toMatch(/INSERT INTO messages_archive\s*\([^)]*rewind_checkpoint_id\)/);
    expect(archiveInsert).toMatch(/SELECT[^;]*?,\s*NULL\s+FROM\s+messages/i);
    expect(archiveInsert).not.toMatch(/SELECT\s*\*/);
  });

  it("issues the live UPDATE with the placeholder content and the same id", async () => {
    await forkToolMessageToArchive("session-1", 99, "[placeholder]");
    const updateCall = clientQuery.mock.calls.find((c: unknown[]) =>
      String(c[0]).toUpperCase().includes("UPDATE MESSAGES"),
    );
    expect(updateCall).toBeTruthy();
    const [, params] = updateCall as [string, unknown[]];
    // session_id is constrained in both the archive SELECT and the
    // live UPDATE so a wrong sessionId arg cannot lock one session
    // and mutate another's message.
    expect(params).toEqual([99, "session-1", "[placeholder]"]);
  });

  it("constrains both archive SELECT and live UPDATE by session_id (cross-session safety)", async () => {
    // Codex defensive fix — the lock takes `sessionId`, but the
    // mutation must also restrict by `session_id` so a wrong
    // sessionId arg is a no-op rather than a cross-session write.
    await forkToolMessageToArchive("session-1", 99, "[placeholder]");
    const sqlCalls = clientQuery.mock.calls.map((c) => c as [string, unknown[]]);
    const archiveCall = sqlCalls.find(([sql]) => String(sql).includes("INSERT INTO messages_archive"));
    expect(archiveCall).toBeTruthy();
    const [archiveSql, archiveParams] = archiveCall as [string, unknown[]];
    expect(archiveSql).toMatch(/FROM messages\s+WHERE id = \$1 AND session_id = \$2/);
    expect(archiveParams).toEqual([99, "session-1"]);

    const updateCall = sqlCalls.find(([sql]) => String(sql).toUpperCase().includes("UPDATE MESSAGES"));
    expect(updateCall).toBeTruthy();
    const [updateSql] = updateCall as [string, unknown[]];
    expect(updateSql).toMatch(/WHERE id = \$1 AND session_id = \$2/);
  });
});

// ── Puzzle 04 phase 5 — session row lock first ────────────────
// Codex required: `archivePrefix`, `archiveSuffix`, and
// `forkToolMessageToArchive` must SELECT FOR UPDATE on the sessions
// row BEFORE touching messages, symmetric with
// `restoreLatestCheckpoint`. This block pins the ordering on the
// no-client (helper-owned tx) paths.

describe("session row lock ordering", () => {
  it("archivePrefix locks the sessions row before the DELETE FROM messages", async () => {
    await archivePrefix("session-1", 42, 5);
    const sqlCalls = clientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    const lockIdx = sqlCalls.findIndex((s) => /SELECT id FROM sessions WHERE id = \$1 FOR UPDATE/i.test(s));
    const deleteIdx = sqlCalls.findIndex((s) => s.includes("DELETE FROM messages"));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(lockIdx);
  });

  it("archiveSuffix locks the sessions row before the DELETE FROM messages", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("id >= $2")) {
        return { rows: [{ archived_count: "1", inserted_count: "1", remaining_count: "0" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await archiveSuffix("session-1", 42, "chk-lock");
    const sqlCalls = clientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    const lockIdx = sqlCalls.findIndex((s) => /SELECT id FROM sessions WHERE id = \$1 FOR UPDATE/i.test(s));
    const deleteIdx = sqlCalls.findIndex((s) => s.includes("DELETE FROM messages"));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(lockIdx);
  });

  it("forkToolMessageToArchive locks the sessions row before touching messages", async () => {
    await forkToolMessageToArchive("session-1", 99, "[placeholder]");
    const sqlCalls = clientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    const lockIdx = sqlCalls.findIndex((s) => /SELECT id FROM sessions WHERE id = \$1 FOR UPDATE/i.test(s));
    const archiveIdx = sqlCalls.findIndex((s) => s.includes("INSERT INTO messages_archive"));
    const updateIdx = sqlCalls.findIndex((s) => s.toUpperCase().includes("UPDATE MESSAGES"));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(archiveIdx).toBeGreaterThan(lockIdx);
    expect(updateIdx).toBeGreaterThan(lockIdx);
  });
});

// ── Puzzle 04 phase 5 — conflict re-stamp + restorability ─────
// Codex pointed out: `forkToolMessageToArchive` writes archive rows
// with `rewind_checkpoint_id = NULL`. A later rewind that archives
// the same id hits ON CONFLICT — previously DO NOTHING would have
// left the row stamped NULL forever, so `/restore` (which looks up
// `WHERE rewind_checkpoint_id = $1`) would silently drop it. The
// fix is DO UPDATE WHERE messages_archive.rewind_checkpoint_id IS
// NULL — re-stamping NULL rows with the current rewind's id while
// refusing to overwrite an already-stamped row.

describe("archiveSuffix conflict re-stamp invariant", () => {
  it("uses ON CONFLICT DO UPDATE re-stamping NULL → checkpoint id", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("id >= $2")) {
        return { rows: [{ archived_count: "2", inserted_count: "2", remaining_count: "1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await archiveSuffix("session-1", 42, "chk-restamp");
    const archiveCall = clientQuery.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("INSERT INTO messages_archive"),
    );
    const [sql] = archiveCall as [string, unknown[]];
    expect(sql).toMatch(/ON CONFLICT\s*\(\s*id\s*\)\s*DO UPDATE/i);
    expect(sql).toMatch(/SET\s+rewind_checkpoint_id\s*=\s*EXCLUDED\.rewind_checkpoint_id/i);
    expect(sql).toMatch(/WHERE\s+messages_archive\.rewind_checkpoint_id\s+IS\s+NULL/i);
  });

  it("throws when inserted_count != archived_count for a non-null checkpoint (partial stamp)", async () => {
    // Simulated edge: 2 archived rows, only 1 actually got the
    // stamp (the other already had a different non-NULL stamp). The
    // helper must reject so the caller's tx rolls back — never ship
    // a partial archive that `/restore` cannot fully replay.
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("id >= $2")) {
        return { rows: [{ archived_count: "2", inserted_count: "1", remaining_count: "0" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(archiveSuffix("session-1", 42, "chk-partial")).rejects.toThrow(
      /already carried a different rewind_checkpoint_id/,
    );
  });

  it("does NOT throw on inserted_count < archived_count when checkpointId is null", async () => {
    // Non-restorable archive writes are permitted to have conflicts
    // — the rewind-restamp invariant only applies when the caller
    // promised restorability via a non-null checkpoint id.
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("id >= $2")) {
        return { rows: [{ archived_count: "2", inserted_count: "1", remaining_count: "0" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(archiveSuffix("session-1", 42, null)).resolves.toEqual({
      archivedCount: 2,
      remainingCount: 0,
    });
  });
});
