import { describe, it, expect, vi, beforeEach } from "vitest";
import { expectSqlPlaceholdersContiguous } from "./_sql-helpers.js";

const mockExecute = vi.fn().mockResolvedValue(0);
const mockQueryOne = vi.fn().mockResolvedValue(null);

vi.mock("@vex-agent/db/client.js", () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: vi.fn().mockResolvedValue([]),
  getPool: () => ({
    connect: async () => ({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
  }),
}));

const { updateStatus } = await import(
  "../../../../vex-agent/db/repos/full-autonomous-runs.js"
);

describe("full-autonomous-runs repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateStatus", () => {
    it("clears stop fields and passes only id for running (no orphan placeholders)", async () => {
      await updateStatus("run-1", "running");
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("status = 'running'");
      expect(sql).toContain("stop_reason = NULL");
      expect(sql).toContain("stop_summary = NULL");
      expect(sql).toContain("stop_evidence_json = NULL");
      expect(sql).toContain("ended_at = NULL");
      expect(params).toEqual(["run-1"]);
      expectSqlPlaceholdersContiguous(sql, params);
    });

    it("non-running branch keeps placeholders contiguous with 5 params", async () => {
      await updateStatus("run-1", "paused_wake", "waiting_for_wake");
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("ended_at = ended_at");
      expect(params).toHaveLength(5);
      expectSqlPlaceholdersContiguous(sql, params);
    });

    it("sets ended_at for stopped (terminal)", async () => {
      await updateStatus("run-1", "stopped", "user_stopped");
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("ended_at = NOW()");
      expect(params).toHaveLength(5);
      expectSqlPlaceholdersContiguous(sql, params);
    });
  });
});
