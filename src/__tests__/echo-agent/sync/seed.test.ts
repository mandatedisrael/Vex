import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn().mockResolvedValue(1);

vi.mock("@echo-agent/db/client.js", () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  getPool: vi.fn(),
}));

const { seedSyncJobs } = await import("../../../echo-agent/sync/seed.js");

describe("seedSyncJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts 7 sync jobs (1 global + 6 per-namespace)", async () => {
    await seedSyncJobs();
    expect(mockExecute).toHaveBeenCalledTimes(7);
  });

  it("uses ON CONFLICT DO NOTHING (idempotent)", async () => {
    await seedSyncJobs();
    for (const call of mockExecute.mock.calls) {
      expect(call[0]).toContain("ON CONFLICT");
      expect(call[0]).toContain("DO NOTHING");
    }
  });

  it("seeds _global periodic job with 300s interval", async () => {
    await seedSyncJobs();
    const globalCall = mockExecute.mock.calls.find(
      (call: unknown[]) => (call[1] as unknown[])[0] === "_global",
    );
    expect(globalCall).toBeDefined();
    expect((globalCall![1] as unknown[])[3]).toBe("periodic");
    expect((globalCall![1] as unknown[])[4]).toBe(300);
  });

  it("seeds per-namespace post_mutation jobs without interval", async () => {
    await seedSyncJobs();
    const postMutationCalls = mockExecute.mock.calls.filter(
      (call: unknown[]) => (call[1] as unknown[])[3] === "post_mutation",
    );
    expect(postMutationCalls).toHaveLength(6); // khalani, solana, kyberswap, polymarket, jaine, slop
    for (const call of postMutationCalls) {
      expect((call[1] as unknown[])[4]).toBeNull(); // no interval
    }
  });

  it("all jobs reference khalani.tokens.balances as readToolId", async () => {
    await seedSyncJobs();
    for (const call of mockExecute.mock.calls) {
      expect((call[1] as unknown[])[2]).toBe("khalani.tokens.balances");
    }
  });
});
