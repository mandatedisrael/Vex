/**
 * Unit tests for the archive-path SQL in `sessions` repo — structural only.
 *
 * Why structural? The transactional helpers (`archivePrefix`,
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

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  getPool: () => ({
    connect: async () => ({
      query: (...args: unknown[]) => clientQuery(...args),
      release: () => clientRelease(),
    }),
  }),
}));

const { archivePrefix, forkToolMessageToArchive } = await import(
  "../../../../echo-agent/db/repos/sessions.js"
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
});

describe("forkToolMessageToArchive SQL", () => {
  it("uses ON CONFLICT (id) DO NOTHING on the archive copy", async () => {
    await forkToolMessageToArchive(99, "[placeholder]");

    const sqlCalls = clientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    const archiveInsert = sqlCalls.find((s) => s.includes("INSERT INTO messages_archive"));
    expect(archiveInsert).toBeTruthy();
    expect(archiveInsert).toMatch(/ON CONFLICT\s*\(\s*id\s*\)\s*DO NOTHING/i);
  });

  it("issues the live UPDATE with the placeholder content and the same id", async () => {
    await forkToolMessageToArchive(99, "[placeholder]");
    const updateCall = clientQuery.mock.calls.find((c: unknown[]) =>
      String(c[0]).toUpperCase().includes("UPDATE MESSAGES"),
    );
    expect(updateCall).toBeTruthy();
    const [, params] = updateCall as [string, unknown[]];
    expect(params).toEqual([99, "[placeholder]"]);
  });
});
