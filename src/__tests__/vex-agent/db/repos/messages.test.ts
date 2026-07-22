import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn().mockResolvedValue(0);
const mockQuery = vi.fn().mockResolvedValue([]);
// Pool-backed executor stub — every `*With` helper that gets `undefined`
// for the `exec` arg routes through `getPool()` which we stub to a fake
// client that records `.query()` calls per SQL.
const poolQuery = vi.fn();
const fakePool = { query: poolQuery };

vi.mock("@vex-agent/db/client.js", () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  queryOneWith: async (exec: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }, sql: string, params: unknown[]) => {
    const result = await exec.query(sql, params);
    return result.rows[0] ?? null;
  },
  executeWith: async (exec: { query: (sql: string, params: unknown[]) => Promise<{ rowCount?: number }> }, sql: string, params: unknown[]) => {
    const result = await exec.query(sql, params);
    return result.rowCount ?? 0;
  },
  queryWith: async (exec: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }, sql: string, params: unknown[]) => {
    const result = await exec.query(sql, params);
    return result.rows;
  },
  getPool: () => fakePool,
}));

const { getLiveMessages, addMessageReturningId, addMessage, addEngineMessage } =
  await import("../../../../vex-agent/db/repos/messages.js");

describe("messages repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolQuery.mockReset();
  });

  it("normalizes database Date timestamps to ISO strings", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 1,
        role: "tool",
        content: "ok",
        tool_call_id: "call-1",
        tool_calls: null,
        created_at: new Date("2026-05-02T15:44:20.269Z"),
        source: null,
        message_type: null,
        visibility: null,
        origin_session_id: null,
        metadata: { success: true },
      },
    ]);

    const messages = await getLiveMessages("session-1");

    expect(messages[0]?.timestamp).toBe("2026-05-02T15:44:20.269Z");
  });

  describe("addMessageReturningId", () => {
    it("returns id + DB-canonical timestamp from RETURNING clause", async () => {
      poolQuery
        .mockResolvedValueOnce({
          rows: [{ id: 99, created_at: new Date("2026-05-21T10:00:00.000Z") }],
        })
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await addMessageReturningId(
        "session-1",
        { role: "assistant", content: "hi", timestamp: "ignored-in-memory" },
        { messageType: "chat", source: "assistant" },
      );

      expect(result.id).toBe(99);
      expect(result.timestamp).toBe("2026-05-21T10:00:00.000Z");
      expect(result.role).toBe("assistant");
      expect(result.metadata).toEqual({ messageType: "chat", source: "assistant" });
      // First call is the INSERT...RETURNING, second is the UPDATE.
      expect(poolQuery).toHaveBeenCalledTimes(2);
      expect(poolQuery.mock.calls[0]?.[0]).toContain("INSERT INTO messages");
      expect(poolQuery.mock.calls[0]?.[0]).toContain("RETURNING id, created_at");
      expect(poolQuery.mock.calls[1]?.[0]).toContain("UPDATE sessions SET message_count");
    });

    it("uses the passed executor (tx-aware path) instead of the pool", async () => {
      const txClient = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [{ id: 7, created_at: "2026-05-21T11:00:00.000Z" }],
          })
          .mockResolvedValueOnce({ rowCount: 1 }),
      };

      const result = await addMessageReturningId(
        "session-1",
        { role: "user", content: "yo", timestamp: "x" },
        undefined,
        txClient as never,
      );

      expect(result.id).toBe(7);
      expect(txClient.query).toHaveBeenCalledTimes(2);
      // Pool MUST NOT have been touched when a client was passed in.
      expect(poolQuery).not.toHaveBeenCalled();
    });

    it("throws when INSERT...RETURNING comes back empty", async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        addMessageReturningId(
          "session-1",
          { role: "user", content: "x", timestamp: "x" },
        ),
      ).rejects.toThrow(/INSERT\.\.\.RETURNING returned no row/);
    });
  });

  describe("addMessage / addEngineMessage void delegates", () => {
    it("addMessage returns void and still drives the INSERT + UPDATE", async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ id: 1, created_at: "2026-05-21T10:00:00.000Z" }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await addMessage(
        "session-1",
        { role: "user", content: "x", timestamp: "x" },
      );
      expect(result).toBeUndefined();
      expect(poolQuery).toHaveBeenCalledTimes(2);
    });

    it("addEngineMessage defaults role to 'system'", async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ id: 2, created_at: "2026-05-21T10:00:00.000Z" }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      await addEngineMessage("session-1", "[engine]", { source: "engine", messageType: "continue", visibility: "internal" });

      const insertParams = poolQuery.mock.calls[0]?.[1] as unknown[];
      // Position 1 in the INSERT params is `msg.role`.
      expect(insertParams[1]).toBe("system");
    });
  });
});
