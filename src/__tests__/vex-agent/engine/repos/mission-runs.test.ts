import { describe, it, expect, vi, beforeEach } from "vitest";
import { expectSqlPlaceholdersContiguous } from "./_sql-helpers.js";

const mockExecute = vi.fn().mockResolvedValue(0);
const mockQueryOne = vi.fn().mockResolvedValue(null);
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  query: vi.fn().mockResolvedValue([]),
  getPool: () => ({
    connect: async () => ({
      query: (...args: unknown[]) => mockClientQuery(...args),
      release: () => mockClientRelease(),
    }),
  }),
}));

const {
  createRun, updateStatus, setLastCheckpoint, incrementIterations,
  getActiveRun, getRun, getRunBySession, casFlipToRunning,
} = await import("../../../../vex-agent/db/repos/mission-runs.js");

describe("mission-runs repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ── createRun ───────────────────────────────────────────────

  describe("createRun", () => {
    it("inserts run with correct params", async () => {
      await createRun("run-1", "mission-1", "session-1", "restricted");
      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("INSERT INTO mission_runs");
      expect(params).toEqual(["run-1", "mission-1", "session-1", "restricted", null, null]);
    });
  });

  // ── updateStatus ────────────────────────────────────────────

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

    it("updates status without ending for paused_approval", async () => {
      await updateStatus("run-1", "paused_approval", "approval_required");
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("ended_at = ended_at");
      expect(params[0]).toBe("paused_approval");
      expect(params[1]).toBe("approval_required");
      expect(params).toHaveLength(5);
      expectSqlPlaceholdersContiguous(sql, params);
    });

    it("sets ended_at for completed", async () => {
      await updateStatus("run-1", "completed", "goal_reached");
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("ended_at = NOW()");
      expect(params[0]).toBe("completed");
      expect(params[1]).toBe("goal_reached");
      expect(params).toHaveLength(5);
      expectSqlPlaceholdersContiguous(sql, params);
    });

    it("sets ended_at for failed", async () => {
      await updateStatus("run-1", "failed", "system_error");
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain("ended_at = NOW()");
    });

    it("sets ended_at for stopped", async () => {
      await updateStatus("run-1", "stopped", "user_stopped");
      const [sql] = mockExecute.mock.calls[0];
      expect(sql).toContain("ended_at = NOW()");
    });
  });

  // ── setLastCheckpoint ───────────────────────────────────────

  describe("setLastCheckpoint", () => {
    it("updates last_checkpoint_at", async () => {
      await setLastCheckpoint("run-1");
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("last_checkpoint_at = NOW()");
      expect(params).toEqual(["run-1"]);
    });
  });

  // ── incrementIterations ─────────────────────────────────────

  describe("incrementIterations", () => {
    it("increments and returns new count", async () => {
      mockQueryOne.mockResolvedValueOnce({ iteration_count: 5 });
      const count = await incrementIterations("run-1");
      expect(count).toBe(5);
      const [sql] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("iteration_count + 1");
      expect(sql).toContain("RETURNING iteration_count");
    });

    it("returns 0 if no row", async () => {
      const count = await incrementIterations("nonexistent");
      expect(count).toBe(0);
    });
  });

  // ── getActiveRun ────────────────────────────────────────────

  describe("getActiveRun", () => {
    it("queries active statuses", async () => {
      await getActiveRun("mission-1");
      const [sql] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("running");
      expect(sql).toContain("paused_approval");
      expect(sql).toContain("paused_error");
      expect(sql).not.toContain("paused_checkpoint");
    });

    it("returns null when no active run", async () => {
      const result = await getActiveRun("mission-1");
      expect(result).toBeNull();
    });

    it("maps row correctly", async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: "run-1", mission_id: "mission-1", session_id: "session-1",
        status: "running", loop_mode: "restricted",
        started_at: new Date("2026-03-28"), ended_at: null,
        last_checkpoint_at: null, stop_reason: null, iteration_count: 7,
      });
      const run = await getActiveRun("mission-1");
      expect(run!.id).toBe("run-1");
      expect(run!.missionId).toBe("mission-1");
      expect(run!.loopMode).toBe("restricted");
      expect(run!.iterationCount).toBe(7);
      expect(run!.endedAt).toBeNull();
    });

    it("throws on unknown DB status instead of defaulting to failed", async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: "run-1", mission_id: "mission-1", session_id: "session-1",
        status: "mystery", loop_mode: "restricted",
        started_at: new Date("2026-03-28"), ended_at: null,
        last_checkpoint_at: null, stop_reason: null, iteration_count: 0,
      });

      await expect(getActiveRun("mission-1")).rejects.toThrow(
        "Unknown mission run status for run-1: mystery",
      );
    });
  });

  describe("casFlipToRunning", () => {
    it("locks, flips matching paused status to running, and returns previous status", async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT status")) {
          return { rows: [{ status: "paused_wake" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      });

      const previous = await casFlipToRunning("run-1", ["paused_wake"]);

      expect(previous).toBe("paused_wake");
      expect(mockClientQuery).toHaveBeenCalledWith("BEGIN");
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining("stop_reason = NULL"),
        ["run-1"],
      );
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining("stop_summary = NULL"),
        ["run-1"],
      );
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining("stop_evidence_json = NULL"),
        ["run-1"],
      );
      expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");
    });

    it("rolls back and returns null when the locked status is not allowed", async () => {
      mockClientQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT status")) {
          return { rows: [{ status: "running" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      });

      const previous = await casFlipToRunning("run-1", ["paused_wake"]);

      expect(previous).toBeNull();
      expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
      expect(
        mockClientQuery.mock.calls.some((call) => String(call[0]).startsWith("UPDATE mission_runs")),
      ).toBe(false);
    });
  });

  // ── getRun ──────────────────────────────────────────────────

  describe("getRun", () => {
    it("queries by id", async () => {
      await getRun("run-1");
      const [, params] = mockQueryOne.mock.calls[0];
      expect(params).toEqual(["run-1"]);
    });
  });

  // ── getRunBySession ─────────────────────────────────────────

  describe("getRunBySession", () => {
    it("queries by session_id", async () => {
      await getRunBySession("session-1");
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("session_id = $1");
      expect(params).toEqual(["session-1"]);
    });
  });
});
