import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────

const mockClaimAllPending = vi.fn().mockResolvedValue([]);
const mockClaimPendingRun = vi.fn().mockResolvedValue(null);
const mockGetJob = vi.fn().mockResolvedValue(null);
const mockCompleteRun = vi.fn().mockResolvedValue(undefined);
const mockFailRun = vi.fn().mockResolvedValue(undefined);

vi.mock("@echo-agent/db/repos/sync.js", () => ({
  claimAllPending: () => mockClaimAllPending(),
  claimPendingRun: () => mockClaimPendingRun(),
  getJob: (...args: unknown[]) => mockGetJob(...args),
  completeRun: (...args: unknown[]) => mockCompleteRun(...args),
  failRun: (...args: unknown[]) => mockFailRun(...args),
  enqueueRun: vi.fn().mockResolvedValue(1),
  getAllJobs: vi.fn().mockResolvedValue([]),
  getLastCompletedRun: vi.fn().mockResolvedValue(null),
  getJobsForNamespace: vi.fn().mockResolvedValue([]),
}));

const mockGetById = vi.fn().mockResolvedValue(null);
vi.mock("@echo-agent/db/repos/executions.js", () => ({
  getById: (...args: unknown[]) => mockGetById(...args),
  recordExecution: vi.fn().mockResolvedValue(1),
}));

const mockSelectiveSync = vi.fn().mockResolvedValue({ walletFamily: "eip155", walletAddress: "0x", tokensUpdated: 5, chainsUpdated: 1, totalUsd: 100 });
vi.mock("../../../echo-agent/sync/balance-sync.js", () => ({
  selectiveBalanceSync: (...args: unknown[]) => mockSelectiveSync(...args),
  fullBalanceSync: vi.fn().mockResolvedValue({ wallets: [], totalUsd: 0, snapshotId: 1, pnlVsPrev: null }),
}));

vi.mock("../../../echo-agent/sync/chains.js", () => ({
  resolveChainHint: vi.fn().mockResolvedValue({ family: "eip155", chainIds: [1] }),
}));

const { drainPendingRuns, processNextRun } = await import("../../../echo-agent/sync/worker.js");

describe("sync worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── drainPendingRuns ──────────────────────────────────────────

  describe("drainPendingRuns", () => {
    it("returns zeros when no pending runs", async () => {
      const result = await drainPendingRuns();
      expect(result).toEqual({ processed: 0, deduped: 0, errors: 0 });
    });

    it("deduplicates multiple balance runs", async () => {
      mockClaimAllPending.mockResolvedValueOnce([
        { id: 1, syncJobId: 10, executionId: 100, status: "running", startedAt: "", endedAt: null, error: null, rowsAffected: 0 },
        { id: 2, syncJobId: 10, executionId: 101, status: "running", startedAt: "", endedAt: null, error: null, rowsAffected: 0 },
        { id: 3, syncJobId: 11, executionId: 102, status: "running", startedAt: "", endedAt: null, error: null, rowsAffected: 0 },
      ]);
      mockGetJob.mockResolvedValue({ id: 10, syncType: "balances", namespace: "solana", strategy: "post_mutation" });

      // Executions have chain hints
      mockGetById
        .mockResolvedValueOnce({ tradeCapture: { chain: "solana" } })
        .mockResolvedValueOnce({ tradeCapture: { chain: "solana" } })
        .mockResolvedValueOnce({ tradeCapture: { chain: "solana" } });

      const result = await drainPendingRuns();

      expect(result.processed).toBe(3);
      expect(result.deduped).toBe(2); // 3 runs but 1 execution batch
      expect(mockCompleteRun).toHaveBeenCalledTimes(3);
    });

    it("derives chain hint from execution trade_capture", async () => {
      mockClaimAllPending.mockResolvedValueOnce([
        { id: 1, syncJobId: 10, executionId: 100, status: "running", startedAt: "", endedAt: null, error: null, rowsAffected: 0 },
      ]);
      mockGetJob.mockResolvedValue({ id: 10, syncType: "balances", namespace: "solana", strategy: "post_mutation" });
      mockGetById.mockResolvedValueOnce({ tradeCapture: { chain: "solana" } });

      await drainPendingRuns();

      // Should have called selectiveBalanceSync with resolved chain
      expect(mockSelectiveSync).toHaveBeenCalled();
    });

    it("falls back to both families when no chain info", async () => {
      mockClaimAllPending.mockResolvedValueOnce([
        { id: 1, syncJobId: 10, executionId: null, status: "running", startedAt: "", endedAt: null, error: null, rowsAffected: 0 },
      ]);
      mockGetJob.mockResolvedValue({ id: 10, syncType: "balances", namespace: "khalani", strategy: "post_mutation" });

      await drainPendingRuns();

      // Should call selective for both eip155 and solana
      expect(mockSelectiveSync).toHaveBeenCalledTimes(2);
      expect(mockSelectiveSync).toHaveBeenCalledWith("eip155");
      expect(mockSelectiveSync).toHaveBeenCalledWith("solana");
    });

    it("marks all runs as failed on error", async () => {
      mockClaimAllPending.mockResolvedValueOnce([
        { id: 1, syncJobId: 10, executionId: null, status: "running", startedAt: "", endedAt: null, error: null, rowsAffected: 0 },
      ]);
      mockGetJob.mockResolvedValue({ id: 10, syncType: "balances", namespace: "solana", strategy: "post_mutation" });
      mockSelectiveSync.mockRejectedValueOnce(new Error("Khalani down"));

      const result = await drainPendingRuns();

      expect(result.errors).toBe(1);
      expect(mockFailRun).toHaveBeenCalledTimes(1);
    });
  });

  // ── processNextRun ────────────────────────────────────────────

  describe("processNextRun", () => {
    it("returns false when no pending runs", async () => {
      expect(await processNextRun()).toBe(false);
    });

    it("derives chain from execution_id", async () => {
      mockClaimPendingRun.mockResolvedValueOnce({
        id: 1, syncJobId: 10, executionId: 100, status: "running", startedAt: "", endedAt: null, error: null, rowsAffected: 0,
      });
      mockGetJob.mockResolvedValueOnce({ id: 10, syncType: "balances", namespace: "solana", strategy: "post_mutation" });
      mockGetById.mockResolvedValueOnce({ tradeCapture: { chain: "polygon" } });

      await processNextRun();

      expect(mockSelectiveSync).toHaveBeenCalledWith("polygon");
      expect(mockCompleteRun).toHaveBeenCalled();
    });

    it("falls back to eip155 when no execution", async () => {
      mockClaimPendingRun.mockResolvedValueOnce({
        id: 1, syncJobId: 10, executionId: null, status: "running", startedAt: "", endedAt: null, error: null, rowsAffected: 0,
      });
      mockGetJob.mockResolvedValueOnce({ id: 10, syncType: "balances", namespace: "khalani", strategy: "post_mutation" });

      await processNextRun();

      expect(mockSelectiveSync).toHaveBeenCalledWith("eip155");
    });
  });
});
